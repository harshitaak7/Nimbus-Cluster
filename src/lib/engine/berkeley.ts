import {
  getNode,
  liveNodes,
  log,
  nextId,
  nodeNow,
  registerHandler,
  tcpRequest,
  getCluster,
} from "./cluster";
import { singleton, errMsg, rand } from "./util";

export interface BerkeleyRow {
  node: string;
  clock: number;
  rtt: number;
  diff: number; // ms relative to the coordinator
  included: boolean;
  adjustment: number;
  status: "ok" | "outlier" | "unreachable" | "coordinator";
}

export interface BerkeleyRun {
  id: number;
  ts: number;
  master: string;
  threshold: number;
  average: number;
  rows: BerkeleyRow[];
  spreadBefore: number;
  spreadAfter: number;
}

const history = () => singleton("__dc_berkeley", () => [] as BerkeleyRun[]);

registerHandler("time", (node) => ({ time: nodeNow(node) }));
registerHandler("adjust", (node, msg) => {
  node.clockOffset += Number(msg.delta) || 0;
  return { clock: nodeNow(node) };
});

function spread(ids: string[]) {
  const offs = ids.map((id) => getNode(id).clockOffset);
  return offs.length ? Math.round(Math.max(...offs) - Math.min(...offs)) : 0;
}

/**
 * Berkeley algorithm:
 * 1. coordinator polls every node's clock over TCP (compensating for rtt/2),
 * 2. computes a fault-tolerant average (ignores clocks beyond `threshold`),
 * 3. sends each node the *relative* adjustment it must apply.
 */
export async function runBerkeley(masterId: string, threshold: number) {
  const master = getNode(masterId);
  if (master.status !== "up") throw new Error(`${master.name} is down`);
  const peers = liveNodes();
  const ids = peers.map((p) => p.id);
  const spreadBefore = spread(ids);
  log("berkeley", "info", `${master.name} acts as time daemon, polling ${peers.length - 1} node(s)`);

  const rows: BerkeleyRow[] = await Promise.all(
    peers.map(async (p): Promise<BerkeleyRow> => {
      if (p.id === master.id)
        return { node: p.id, clock: nodeNow(p), rtt: 0, diff: 0, included: true, adjustment: 0, status: "coordinator" };
      try {
        const sent = nodeNow(master);
        const r = await tcpRequest<{ time: number }>(master.id, p.id, { type: "time" });
        const recv = nodeNow(master);
        const rtt = recv - sent;
        const diff = Math.round(r.reply.time + rtt / 2 - recv);
        return {
          node: p.id,
          clock: r.reply.time,
          rtt: Math.round(rtt),
          diff,
          included: Math.abs(diff) <= threshold,
          adjustment: 0,
          status: Math.abs(diff) <= threshold ? "ok" : "outlier",
        };
      } catch (e) {
        log("berkeley", "error", `poll ${p.name} failed: ${errMsg(e)}`);
        return { node: p.id, clock: 0, rtt: 0, diff: 0, included: false, adjustment: 0, status: "unreachable" };
      }
    }),
  );

  const used = rows.filter((r) => r.included);
  const average = Math.round(used.reduce((s, r) => s + r.diff, 0) / Math.max(1, used.length));

  await Promise.all(
    rows.map(async (r) => {
      if (r.status === "unreachable") return;
      r.adjustment = average - r.diff;
      if (r.node === master.id) {
        master.clockOffset += r.adjustment;
        return;
      }
      try {
        await tcpRequest(master.id, r.node, { type: "adjust", delta: r.adjustment });
      } catch (e) {
        r.status = "unreachable";
        log("berkeley", "error", `adjust ${getNode(r.node).name} failed: ${errMsg(e)}`);
      }
    }),
  );
  rows.sort((a, b) => a.node.localeCompare(b.node));

  const run: BerkeleyRun = {
    id: nextId(),
    ts: Date.now(),
    master: master.id,
    threshold,
    average,
    rows,
    spreadBefore,
    spreadAfter: spread(ids),
  };
  const h = history();
  h.unshift(run);
  if (h.length > 8) h.pop();
  log(
    "berkeley",
    "ok",
    `Synchronised ${used.length}/${peers.length} clocks: avg Δ=${average}ms, skew ${run.spreadBefore}ms → ${run.spreadAfter}ms`,
  );
  return run;
}

export function randomizeClocks(maxSkew: number) {
  const nodes = getCluster().nodes;
  for (const n of nodes) n.clockOffset = Math.round(rand(-maxSkew, maxSkew));
  log("berkeley", "warn", `Clocks randomised within ±${maxSkew}ms`);
}

export function setOffset(id: string, offset: number) {
  getNode(id).clockOffset = offset;
  log("berkeley", "warn", `${getNode(id).name} clock forced to offset ${offset}ms`);
}

export function berkeleyView() {
  return history();
}
