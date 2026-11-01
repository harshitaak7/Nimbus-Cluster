"use client";

import { useState } from "react";
import { Badge, Btn, Card, Empty, EventLog, Field, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster, useTicker } from "@/components/cluster-provider";
import { nodeColor } from "@/lib/format";

const ALGOS = [
  { id: "round-robin", name: "Round Robin", d: "Each request goes to the next live node on the ring. Fair when nodes are identical." },
  { id: "weighted", name: "Weighted RR", d: "Smooth weighted round robin (nginx): bigger weights receive proportionally more." },
  { id: "least-connections", name: "Least Connections", d: "Sends work to the node with the shortest queue — adapts to slow tasks." },
  { id: "random", name: "Random", d: "Baseline for comparison. Statistically even, but bursty." },
];

function Ring() {
  const { snap } = useCluster();
  useTicker(200);
  if (!snap) return null;
  const b = snap.balancer;
  const n = snap.nodes.length;
  const c = 130;
  const R = 90;
  const pos = (i: number) => ({ x: c + R * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n), y: c + R * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n) });
  const nx = b.nextIndex >= 0 ? pos(b.nextIndex) : null;
  return (
    <svg viewBox="0 0 260 260" className="mx-auto w-full max-w-[300px]">
      <circle cx={c} cy={c} r={R} fill="none" stroke="#334155" strokeDasharray="3 5" />
      {nx && <line x1={c} y1={c} x2={c + (nx.x - c) * 0.72} y2={c + (nx.y - c) * 0.72} stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" markerEnd="url(#arr)" style={{ transition: "all .4s" }} />}
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#38bdf8" />
        </marker>
      </defs>
      <circle cx={c} cy={c} r="22" fill="#0b1020" stroke="#38bdf8" strokeOpacity=".4" />
      <text x={c} y={c + 4} textAnchor="middle" fontSize="10" fill="#7dd3fc" fontWeight="700">NEXT</text>
      {snap.nodes.map((nd, i) => {
        const p = pos(i);
        const up = nd.status === "up";
        const isNext = i === b.nextIndex;
        const col = up ? nodeColor(nd.id) : "#475569";
        return (
          <g key={nd.id}>
            {isNext && <circle cx={p.x} cy={p.y} r="25" fill="none" stroke="#38bdf8" strokeWidth="2" className="blink" />}
            <circle cx={p.x} cy={p.y} r="19" fill="#0b1020" stroke={col} strokeWidth="2.5" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={col}>{up ? nd.name[0] : "✕"}</text>
            <text x={p.x} y={p.y + (p.y > c ? 33 : -26)} textAnchor="middle" fontSize="9" fill="#94a3b8">
              {nd.name} · {(b.load[nd.id].queued + b.load[nd.id].running)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function BalancerPage() {
  const { snap, act } = useCluster();
  const [count, setCount] = useState(10);
  const [min, setMin] = useState(400);
  const [max, setMax] = useState(1400);
  if (!snap) return null;
  const b = snap.balancer;
  const totalAssigned = Object.values(b.assigned).reduce((s, v) => s + v, 0);
  const maxAssigned = Math.max(1, ...Object.values(b.assigned));
  const algo = ALGOS.find((a) => a.id === b.algo);
  const ideal = totalAssigned / Math.max(1, snap.nodes.length);
  const dev = Math.sqrt(snap.nodes.reduce((s, n) => s + ((b.assigned[n.id] ?? 0) - ideal) ** 2, 0) / snap.nodes.length);

  return (
    <>
      <PageHeader
        icon="↻"
        eyebrow="Scheduling & load balancing"
        title="Round Robin dispatcher"
        desc="Requests are spread across the cluster by rotating a pointer around the node ring. Switch policies to compare fairness, give nodes weights, and crash a node mid-burst — its queued work is rescheduled round-robin onto survivors. The same pointer also places file replicas and assigns MapReduce tasks."
        chips={["ring pointer", "skip failed nodes", "smooth weighted RR", "least connections", "task rescheduling"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Dispatched" value={totalAssigned} tone="text-lime-300" />
        <Stat label="Completed" value={Object.values(b.processed).reduce((s, v) => s + v, 0)} tone="text-emerald-300" />
        <Stat label="In flight" value={Object.values(b.load).reduce((s, l) => s + l.queued + l.running, 0)} tone="text-sky-300" />
        <Stat label="Imbalance σ" value={dev.toFixed(2)} hint="0 = perfectly even" tone={dev < 1.5 ? "text-emerald-300" : "text-amber-300"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Policy">
            <div className="grid grid-cols-2 gap-1.5">
              {ALGOS.map((a) => (
                <button key={a.id} onClick={() => act("lb.algo", { algo: a.id })} className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${b.algo === a.id ? "border-lime-400/50 bg-lime-400/10 text-lime-200" : "border-white/10 text-slate-400 hover:text-white"}`}>
                  {a.name}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">{algo?.d}</p>
          </Card>
          <Card title="Send a burst">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Requests"><input type="number" className={inputCls} value={count} min={1} max={60} onChange={(e) => setCount(Number(e.target.value))} /></Field>
              <Field label="Min ms"><input type="number" className={inputCls} value={min} onChange={(e) => setMin(Number(e.target.value))} /></Field>
              <Field label="Max ms"><input type="number" className={inputCls} value={max} onChange={(e) => setMax(Number(e.target.value))} /></Field>
            </div>
            <div className="mt-3 flex gap-2">
              <Btn variant="primary" className="flex-1" onClick={() => act("lb.submit", { count, min, max })}>Dispatch</Btn>
              <Btn onClick={() => act("lb.submit", { count: 1, min, max })}>+1</Btn>
              <Btn variant="danger" onClick={() => act("lb.reset")}>Reset</Btn>
            </div>
          </Card>
          <Card title="The ring"><Ring /></Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Node queues & distribution" subtitle="Weights only matter for Weighted RR">
            <div className="space-y-3">
              {snap.nodes.map((n) => {
                const l = b.load[n.id];
                const col = n.status === "up" ? nodeColor(n.id) : "#475569";
                return (
                  <div key={n.id} className={n.status === "down" ? "opacity-50" : ""}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: col }}>{n.name}</span>
                        {n.status === "down" && <Badge tone="red">down</Badge>}
                        <span className="text-slate-500">queue {l.queued} · running {l.running}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-slate-500">
                          weight
                          <input type="number" min={1} max={9} value={n.weight} onChange={(e) => act("lb.weight", { node: n.id, weight: Number(e.target.value) }, { silent: true })} className="w-12 rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-center text-slate-200" />
                        </label>
                        <span className="w-24 text-right font-mono text-slate-300">{b.assigned[n.id] ?? 0} assigned · {b.processed[n.id] ?? 0} done</span>
                      </div>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${((b.assigned[n.id] ?? 0) / maxAssigned) * 100}%`, background: col }} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {b.tasks.filter((t) => t.node === n.id && t.status !== "done").slice(0, 14).map((t) => (
                        <span key={t.id} className={`h-3.5 w-3.5 rounded-[4px] border ${t.status === "running" ? "blink border-white/60" : "border-white/10"}`} style={{ background: col + (t.status === "running" ? "ff" : "55") }} title={`task ${t.id} · ${t.cost}ms`} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Recent requests">
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {b.tasks.length === 0 && <Empty>Dispatch a burst.</Empty>}
                {b.tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-black/25 px-2.5 py-1 text-xs">
                    <span className="font-mono text-slate-400">#{t.id} · {t.cost}ms</span>
                    <span className="flex items-center gap-1.5">
                      {t.retries > 0 && <Badge tone="amber">rescheduled</Badge>}
                      <span style={{ color: nodeColor(t.node) }}>{snap.nodes.find((n) => n.id === t.node)?.name}</span>
                      <Badge tone={t.status === "done" ? "green" : t.status === "running" ? "sky" : "slate"}>{t.status}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Balancer log"><EventLog kinds={["balancer"]} max={12} height="max-h-64" /></Card>
          </div>
        </div>
      </div>
    </>
  );
}
