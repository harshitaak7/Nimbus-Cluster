import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dcFiles } from "@/db/schema";
import {
  ensureCluster,
  getCluster,
  getNode,
  liveNodes,
  log,
  registerHandler,
  tcpRequest,
} from "./cluster";
import { rrNext } from "./balancer";
import { errMsg, singleton } from "./util";

export const MAX_FILE_BYTES = 1_500_000;
const CHUNK = 48 * 1024;

/** Each node keeps a tiny in-memory chunk ledger for transfers it receives. */
const ledger = () => singleton("__dc_ledger", () => new Map<string, number>());

registerHandler("file-chunk", (node, msg) => {
  const key = `${node.id}:${msg.fileId}`;
  ledger().set(key, (ledger().get(key) ?? 0) + Number(msg.size));
  return { stored: true, index: msg.index, total: msg.total, by: node.name };
});

/** Stream a file to a target node as TCP chunks (real socket traffic). */
async function transfer(from: string, to: string, name: string, fileId: number, buf: Buffer) {
  const total = Math.max(1, Math.ceil(buf.length / CHUNK));
  const t0 = Date.now();
  for (let i = 0; i < total; i += 6) {
    await Promise.all(
      Array.from({ length: Math.min(6, total - i) }, (_, k) => {
        const idx = i + k;
        const part = buf.subarray(idx * CHUNK, (idx + 1) * CHUNK);
        return tcpRequest(from, to, {
          type: "file-chunk",
          fileId,
          name,
          index: idx,
          total,
          size: part.length,
          data: part.toString("base64"),
        });
      }),
    );
  }
  log("file", "ok", `${name}: ${total} chunk(s), ${buf.length}B ${getNode(from).name} → ${getNode(to).name} in ${Date.now() - t0}ms`);
}

/** Primary chosen by Round Robin; replicas are the next live nodes on the ring. */
function placement(copies: number, exclude: string[] = []): string[] {
  const out: string[] = [];
  const first = rrNext();
  if (!first) throw new Error("no live nodes to store the file");
  const nodes = getCluster().nodes;
  const start = nodes.findIndex((n) => n.id === first.id);
  for (let i = 0; i < nodes.length && out.length < copies; i++) {
    const n = nodes[(start + i) % nodes.length];
    if (n.status === "up" && !exclude.includes(n.id)) out.push(n.id);
  }
  return out;
}

export async function storeFile(opts: {
  name: string;
  mime: string;
  data: Buffer;
  copies: number;
  replaceId?: number;
}) {
  await ensureCluster();
  if (opts.data.length > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} bytes`);
  const checksum = createHash("sha256").update(opts.data).digest("hex");
  const copies = Math.max(1, Math.min(5, Math.round(opts.copies)));
  const nodes = placement(copies);
  const [primary, ...rest] = nodes;
  const [row] = await db
    .insert(dcFiles)
    .values({
      name: opts.name,
      mime: opts.mime,
      size: opts.data.length,
      checksum,
      content: opts.data.toString("base64"),
      primaryNode: primary,
      replicas: nodes,
      targetReplicas: copies,
    })
    .returning();
  log("file", "info", `${opts.name} (${opts.data.length}B) stored on primary ${getNode(primary).name}; replicating to ${rest.map((r) => getNode(r).name).join(", ") || "nobody"}`);
  try {
    for (const r of rest) await transfer(primary, r, opts.name, row.id, opts.data);
  } catch (e) {
    log("file", "error", `replication failed: ${errMsg(e)}`);
  }
  getCluster().stats.filesStored++;
  return row;
}

/** Pick a live replica using round robin per file. */
const cursor = () => singleton("__dc_file_cursor", () => new Map<number, number>());

export async function fetchFile(id: number) {
  await ensureCluster();
  const [f] = await db.select().from(dcFiles).where(eq(dcFiles.id, id));
  if (!f) return null;
  const live = f.replicas.filter((r) => getNode(r).status === "up");
  if (live.length === 0) return { file: f, servedBy: null as string | null };
  const k = (cursor().get(id) ?? -1) + 1;
  cursor().set(id, k);
  const servedBy = live[k % live.length];
  await db.update(dcFiles).set({ downloads: f.downloads + 1 }).where(eq(dcFiles.id, id));
  getCluster().stats.filesServed++;
  log("file", "ok", `${f.name} served by ${getNode(servedBy).name} (round-robin over ${live.length} live replica(s))`);
  return { file: f, servedBy };
}

export async function deleteFile(id: number) {
  const [f] = await db.delete(dcFiles).where(eq(dcFiles.id, id)).returning();
  if (f) log("file", "warn", `${f.name} deleted from all replicas`);
  return !!f;
}

/** Re-replicate under-replicated files onto healthy nodes. */
export async function repairFiles() {
  await ensureCluster();
  const files = await db.select().from(dcFiles);
  let repaired = 0;
  for (const f of files) {
    const live = f.replicas.filter((r) => getNode(r).status === "up");
    if (live.length === 0) continue;
    const dead = f.replicas.filter((r) => getNode(r).status !== "up");
    const missing = f.targetReplicas - live.length;
    if (missing <= 0 && dead.length === 0) continue;
    const candidates = liveNodes().filter((n) => !live.includes(n.id));
    const add = candidates.slice(0, Math.max(0, missing)).map((n) => n.id);
    const buf = Buffer.from(f.content, "base64");
    for (const t of add) {
      try {
        await transfer(live[0], t, f.name, f.id, buf);
      } catch (e) {
        log("file", "error", `repair ${f.name} → ${getNode(t).name} failed: ${errMsg(e)}`);
      }
    }
    const replicas = [...live, ...add];
    await db
      .update(dcFiles)
      .set({ replicas, primaryNode: replicas[0], version: f.version + 1, updatedAt: new Date() })
      .where(eq(dcFiles.id, f.id));
    repaired++;
    log("file", "ok", `${f.name} repaired: replicas now ${replicas.map((r) => getNode(r).name).join(", ")}`);
  }
  return repaired;
}

export async function listFiles() {
  await ensureCluster();
  let rows = await db
    .select({
      id: dcFiles.id,
      name: dcFiles.name,
      mime: dcFiles.mime,
      size: dcFiles.size,
      checksum: dcFiles.checksum,
      version: dcFiles.version,
      primaryNode: dcFiles.primaryNode,
      replicas: dcFiles.replicas,
      targetReplicas: dcFiles.targetReplicas,
      downloads: dcFiles.downloads,
      createdAt: dcFiles.createdAt,
    })
    .from(dcFiles)
    .orderBy(dcFiles.id);
  if (rows.length === 0) {
    const demos = [
      {
        name: "cluster-readme.txt",
        content: "Nimbus Cluster demo files\n=========================\nThis file is replicated across the live cluster nodes.\nDownload it to observe round-robin reads.\n",
      },
      {
        name: "nodes.csv",
        content: "node,status,role\nnode-1,up,coordinator\nnode-2,up,worker\nnode-3,up,worker\nnode-4,up,worker\nnode-5,up,worker\n",
      },
      {
        name: "mapreduce-input.txt",
        content: "distributed systems scale by coordinating independent nodes\nreplication improves availability and durability\nmapreduce divides work before reducing the results\n",
      },
    ];
    for (const demo of demos) {
      await storeFile({
        name: demo.name,
        mime: "text/plain",
        data: Buffer.from(demo.content, "utf8"),
        copies: 3,
      });
    }
    rows = await db
      .select({
        id: dcFiles.id,
        name: dcFiles.name,
        mime: dcFiles.mime,
        size: dcFiles.size,
        checksum: dcFiles.checksum,
        version: dcFiles.version,
        primaryNode: dcFiles.primaryNode,
        replicas: dcFiles.replicas,
        targetReplicas: dcFiles.targetReplicas,
        downloads: dcFiles.downloads,
        createdAt: dcFiles.createdAt,
      })
      .from(dcFiles)
      .orderBy(dcFiles.id);
  }
  return rows;
}
