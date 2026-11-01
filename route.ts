import { errMsg } from "@/lib/engine/util";
import type { JobType } from "@/lib/engine/mapreduce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [{ db }, { mrJobs }, { desc: orderByDesc }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);
    const rows = await db.select().from(mrJobs).orderBy(orderByDesc(mrJobs.id)).limit(12);
    return Response.json(rows);
  } catch (e) {
    return Response.json({ ok: false, error: errMsg(e) }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const [{ ensureCluster, liveNodes, log }, { rrNext }, { runMapReduce }] = await Promise.all([
      import("@/lib/engine/cluster"),
      import("@/lib/engine/balancer"),
      import("@/lib/engine/mapreduce"),
    ]);
    const [{ db }, { mrJobs }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await ensureCluster();
    const b = (await req.json()) as {
      job: JobType;
      text: string;
      inputName?: string;
      mappers?: number;
      reducers?: number;
      combiner?: boolean;
      failWorker?: string;
      pattern?: string;
    };
    const live = liveNodes();
    // rotate the starting worker with the shared Round Robin pointer
    const first = rrNext();
    const ordered = first ? [...live.slice(live.findIndex((n) => n.id === first.id)), ...live.slice(0, live.findIndex((n) => n.id === first.id))] : live;
    const result = runMapReduce({
      job: b.job,
      text: b.text ?? "",
      mappers: b.mappers ?? 6,
      reducers: b.reducers ?? 3,
      combiner: !!b.combiner,
      workers: (ordered.length ? ordered : live).map((n) => ({ id: n.id, name: n.name })),
      failWorker: b.failWorker || undefined,
      pattern: b.pattern,
    });
    const [row] = await db
      .insert(mrJobs)
      .values({
        job: b.job,
        inputName: b.inputName || "inline text",
        inputBytes: result.totals.inputBytes,
        mappers: result.tasks.filter((t) => t.type === "map" && t.status === "done").length,
        reducers: result.tasks.filter((t) => t.type === "reduce").length,
        combiner: !!b.combiner,
        durationMs: result.durationMs,
        summary: { ...result.totals, workers: live.length },
      })
      .returning();
    log(
      "mapreduce",
      "ok",
      `${b.job} on ${live.length} worker(s): ${result.totals.mapRecords} map records → ${result.totals.shuffled} shuffled → ${result.totals.keys} keys in ${result.durationMs}ms (simulated)` +
        (result.totals.retries ? `; ${result.totals.retries} task(s) failed and were re-executed` : ""),
    );
    return Response.json({ ok: true, id: row.id, result });
  } catch (e) {
    return Response.json({ ok: false, error: errMsg(e) }, { status: 400 });
  }
}
