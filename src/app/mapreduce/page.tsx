"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Btn, Card, Empty, EventLog, Field, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster } from "@/components/cluster-provider";
import { fmtBytes, nodeColor } from "@/lib/format";
import type { MRResult } from "@/lib/engine/mapreduce";

const SAMPLE = `Distributed systems are collections of independent computers that appear to users as a single system
The map function processes a key value pair to generate a set of intermediate key value pairs
The reduce function merges all intermediate values associated with the same intermediate key
Programs written in this functional style are automatically parallelized and executed on a large cluster
The run time system takes care of partitioning the input data and scheduling the program across machines
It also handles machine failures by re executing the tasks of the failed machines
A distributed system should hide the complexity of the network from the user
Round robin scheduling gives every node a fair turn and the cluster keeps working when a node fails
The Berkeley algorithm averages the clocks of the cluster and the cluster agrees on the time
Mutual exclusion in a distributed system needs messages and the cluster must avoid deadlock`;

const JOBS = [
  { id: "wordcount", name: "Word count", d: "map: word → 1 · reduce: sum" },
  { id: "charfreq", name: "Letter frequency", d: "map: letter → 1 · reduce: sum" },
  { id: "invertedindex", name: "Inverted index", d: "map: word → line · reduce: posting list" },
  { id: "grep", name: "Distributed grep", d: "map: emit matching lines · reduce: identity" },
  { id: "avglen", name: "Avg word length", d: "map: letter → len · reduce: mean" },
];

interface Hist {
  id: number;
  job: string;
  inputName: string;
  inputBytes: number;
  mappers: number;
  reducers: number;
  combiner: boolean;
  durationMs: number;
  createdAt: string;
}

export default function MapReducePage() {
  const { snap, toast, refresh } = useCluster();
  const [text, setText] = useState(SAMPLE);
  const [inputName, setInputName] = useState("inline sample");
  const [job, setJob] = useState("wordcount");
  const [mappers, setMappers] = useState(6);
  const [reducers, setReducers] = useState(3);
  const [combiner, setCombiner] = useState(true);
  const [failWorker, setFailWorker] = useState("");
  const [pattern, setPattern] = useState("cluster|failure");
  const [files, setFiles] = useState<{ id: number; name: string }[]>([]);
  const [result, setResult] = useState<MRResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<Hist[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHist = useCallback(async () => {
    try {
      const r = await fetch("/api/mapreduce", { cache: "no-store" });
      if (!r.ok) throw new Error(`MapReduce history unavailable (${r.status})`);
      setHist((await r.json()) as Hist[]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "MapReduce history unavailable", "error");
    }
  }, [toast]);

  const loadFile = useCallback(async (id: string) => {
    const r = await fetch(`/api/files/${id}?text=1`);
    const j = (await r.json()) as { ok: boolean; text?: string; name?: string; error?: string };
    if (j.ok && j.text !== undefined) {
      setText(j.text);
      setInputName(j.name ?? "file");
      toast(`Loaded ${j.name} from the cluster file store`, "ok");
    } else toast(j.error ?? "could not load file", "error");
  }, [toast]);

  useEffect(() => {
    const initial = setTimeout(() => {
      void loadHist();
      void fetch("/api/files")
        .then((r) => {
          if (!r.ok) throw new Error(`File store unavailable (${r.status})`);
          return r.json();
        })
        .then((f: { id: number; name: string }[]) => setFiles(f))
        .catch((e: unknown) => toast(e instanceof Error ? e.message : "File store unavailable", "error"));
      const q = new URLSearchParams(window.location.search).get("file");
      if (q) void loadFile(q);
    }, 0);
    return () => clearTimeout(initial);
  }, [loadHist, loadFile, toast]);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function play(total: number) {
    if (timer.current) clearInterval(timer.current);
    const step = Math.max(10, total / 120);
    setProgress(0);
    let p = 0;
    timer.current = setInterval(() => {
      p += step;
      setProgress(Math.min(total, p));
      if (p >= total && timer.current) clearInterval(timer.current);
    }, 30);
  }

  async function run() {
    setBusy(true);
    const r = await fetch("/api/mapreduce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, text, inputName, mappers, reducers, combiner, failWorker, pattern }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string; result?: MRResult };
    setBusy(false);
    if (!j.ok || !j.result) {
      toast(j.error ?? "job failed", "error");
      return;
    }
    setResult(j.result);
    play(j.result.durationMs);
    void loadHist();
    void refresh();
  }

  if (!snap) return null;
  const workers = [...new Set(result?.tasks.map((t) => t.worker) ?? [])].sort();
  const total = result?.durationMs ?? 1;
  const maxVal = result && (result.job === "wordcount" || result.job === "charfreq") ? Math.max(1, ...result.output.map((o) => Number(o[1]))) : 0;
  const phaseNow = result ? result.phases.filter((p) => progress >= p.start && p.end > p.start && progress < p.end)[0]?.name : undefined;
  const maxShuffle = result ? Math.max(1, ...result.shuffle.flat()) : 1;

  return (
    <>
      <PageHeader
        icon="⋔"
        eyebrow="Parallel data processing"
        title="MapReduce"
        desc="The input is split into chunks; map tasks are handed to live nodes in round-robin order, their intermediate pairs are partitioned by hash(key) mod R, shuffled to reducers and merged. The computation is real — only task timing is simulated. Crash a worker mid-map and its tasks are re-executed elsewhere. Feed it a file from the cluster file store."
        chips={["input splits", "round-robin task assignment", "combiner", "hash partitioner", "shuffle & sort", "fault re-execution"]}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Input" subtitle={`${inputName} · ${fmtBytes(new Blob([text]).size)} · ${text.split("\n").length} lines`}>
            <Field label="Load from cluster file store">
              <select className={inputCls} value="" onChange={(e) => e.target.value && loadFile(e.target.value)}>
                <option value="">— choose a shared file —</option>
                {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <textarea className={`${inputCls} mt-3 h-44 font-mono text-xs`} value={text} onChange={(e) => { setText(e.target.value); setInputName("inline text"); }} />
          </Card>
          <Card title="Job configuration">
            <div className="grid grid-cols-1 gap-1.5">
              {JOBS.map((j) => (
                <button key={j.id} onClick={() => setJob(j.id)} className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-left text-xs transition ${job === j.id ? "border-cyan-400/50 bg-cyan-400/10" : "border-white/10 hover:bg-white/5"}`}>
                  <span className="font-semibold text-slate-100">{j.name}</span><span className="text-slate-500">{j.d}</span>
                </button>
              ))}
            </div>
            {job === "grep" && <Field label="Regex pattern" className="mt-3"><input className={inputCls} value={pattern} onChange={(e) => setPattern(e.target.value)} /></Field>}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={`Map tasks: ${mappers}`}><input type="range" min={1} max={12} value={mappers} onChange={(e) => setMappers(Number(e.target.value))} className="w-full accent-cyan-400" /></Field>
              <Field label={`Reducers: ${reducers}`}><input type="range" min={1} max={6} value={reducers} onChange={(e) => setReducers(Number(e.target.value))} className="w-full accent-cyan-400" /></Field>
            </div>
            <div className="mt-3 grid grid-cols-2 items-end gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={combiner} onChange={(e) => setCombiner(e.target.checked)} className="accent-cyan-400" /> Local combiner</label>
              <Field label="Crash worker mid-map">
                <select className={inputCls} value={failWorker} onChange={(e) => setFailWorker(e.target.value)}>
                  <option value="">none</option>
                  {snap.nodes.filter((n) => n.status === "up").map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </Field>
            </div>
            <Btn variant="primary" className="mt-4 w-full" disabled={busy} onClick={run}>{busy ? "Running…" : `▶ Run on ${snap.nodes.filter((n) => n.status === "up").length} live workers`}</Btn>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-3">
          {!result ? (
            <Card title="Execution timeline"><Empty>Run a job to watch tasks flow through map → shuffle → reduce.</Empty></Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Map records" value={result.totals.mapRecords} tone="text-cyan-300" hint={result.totals.combinerSaved ? `combiner saved ${result.totals.combinerSaved}` : "no combiner"} />
                <Stat label="Shuffled" value={result.totals.shuffled} tone="text-violet-300" />
                <Stat label="Output keys" value={result.totals.keys} tone="text-emerald-300" />
                <Stat label="Sim. runtime" value={`${(result.durationMs / 1000).toFixed(2)}s`} hint={result.totals.retries ? `${result.totals.retries} re-executed` : "no failures"} tone={result.totals.retries ? "text-amber-300" : "text-slate-50"} />
              </div>

              <Card title="Pipeline" right={<Btn size="sm" onClick={() => play(result.durationMs)}>↻ Replay</Btn>}>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  {result.phases.map((p) => {
                    const done = progress >= p.end;
                    const active = phaseNow === p.name;
                    return (
                      <div key={p.name} className={`rounded-xl border p-3 transition ${active ? "border-cyan-400/60 bg-cyan-400/10" : done ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-black/20"}`}>
                        <div className="flex items-center justify-between font-semibold text-slate-100">{p.name}{done ? <span className="text-emerald-400">✓</span> : active ? <span className="blink text-cyan-300">●</span> : null}</div>
                        <div className="mt-1 font-mono text-slate-500">{p.end - p.start} ms</div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card title="Worker timeline" subtitle="Blue = map · violet = reduce · red = failed attempt · ▲ = retry">
                <div className="relative space-y-2">
                  {workers.map((w) => (
                    <div key={w} className="flex items-center gap-3">
                      <div className="w-16 text-xs font-semibold" style={{ color: nodeColor(w) }}>{snap.nodes.find((n) => n.id === w)?.name}</div>
                      <div className="relative h-8 flex-1 rounded-lg bg-white/[0.04]">
                        {result.tasks.filter((t) => t.worker === w).map((t) => {
                          const fill = Math.max(0, Math.min(1, (progress - t.start) / Math.max(1, t.end - t.start)));
                          const base = t.status === "failed" ? "#f43f5e" : t.type === "map" ? "#22d3ee" : "#a78bfa";
                          return (
                            <div key={t.id + t.attempt} title={`${t.id} attempt ${t.attempt} · ${t.input}→${t.output} records`} className="absolute top-1 h-6 overflow-hidden rounded-md border text-[9px] leading-6" style={{ left: `${(t.start / total) * 100}%`, width: `${Math.max(1.5, ((t.end - t.start) / total) * 100)}%`, borderColor: base + "99", background: base + "22" }}>
                              <div className="absolute inset-y-0 left-0" style={{ width: `${fill * 100}%`, background: base + "aa" }} />
                              <span className="relative px-1 font-mono text-white/90">{t.id.replace("reduce-", "R").replace("map-", "M")}{t.attempt > 1 ? "▲" : ""}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="pointer-events-none absolute inset-y-0 w-px bg-white/60" style={{ left: `calc(4.75rem + (100% - 4.75rem) * ${progress / total})` }} />
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Shuffle matrix" subtitle="records: map task → reducer partition">
                  <div className="overflow-x-auto">
                    <table className="w-full text-center text-[11px]">
                      <thead><tr><th className="p-1 text-left text-slate-500">map\red</th>{result.shuffle[0].map((_, r) => <th key={r} className="p-1 text-slate-400">R{r}</th>)}</tr></thead>
                      <tbody>
                        {result.shuffle.map((row, i) => (
                          <tr key={i}>
                            <td className="p-1 text-left font-mono text-slate-400">M{i}</td>
                            {row.map((v, r) => <td key={r} className="p-0.5"><div className="rounded-md py-1 font-mono text-white" style={{ background: `rgba(139,92,246,${0.1 + (v / maxShuffle) * 0.8})` }}>{v}</div></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                <Card title="Output" subtitle={`${result.totals.keys} keys${result.output.length < result.totals.keys ? " (first 300 stored)" : ""}`}>
                  <div className="max-h-72 space-y-0.5 overflow-y-auto font-mono text-xs">
                    {result.output.slice(0, 80).map(([k, v]) => (
                      <div key={k} className="relative flex justify-between gap-3 overflow-hidden rounded px-2 py-0.5">
                        {maxVal > 0 && <div className="absolute inset-y-0 left-0 bg-cyan-400/15" style={{ width: `${(Number(v) / maxVal) * 100}%` }} />}
                        <span className="relative max-w-[70%] truncate text-slate-200">{k}</span>
                        <span className="relative truncate text-cyan-300">{v}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Job history (PostgreSQL)">
          {hist.length === 0 ? <Empty>No jobs recorded yet.</Empty> : (
            <div className="space-y-1">
              {hist.map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-1.5 text-xs">
                  <span className="font-mono text-slate-300">#{h.id} {h.job} <span className="text-slate-500">· {h.inputName} · {fmtBytes(h.inputBytes)}</span></span>
                  <span className="flex gap-1.5"><Badge tone="slate">{h.mappers}M/{h.reducers}R</Badge>{h.combiner && <Badge tone="violet">combiner</Badge>}<Badge tone="sky">{h.durationMs} ms</Badge></span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Job log"><EventLog kinds={["mapreduce"]} max={10} height="max-h-56" /></Card>
      </div>
    </>
  );
}
