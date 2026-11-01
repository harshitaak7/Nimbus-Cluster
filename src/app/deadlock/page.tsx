"use client";

import { useState } from "react";
import { Badge, Btn, Card, Empty, Field, NodeTag, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster } from "@/components/cluster-provider";
import { nodeColor } from "@/lib/format";

const PRESETS = [
  { id: "classic", name: "Classic 2-process", d: "P1↔P2 hold-and-wait on R1/R2" },
  { id: "ring", name: "4-process ring", d: "Circular wait across four sites" },
  { id: "distributed", name: "Distributed", d: "3-cycle across sites + a victim chain" },
  { id: "safe", name: "Safe chain", d: "Long wait chain, no cycle" },
  { id: "empty", name: "Empty", d: "Blank system" },
];

function Graph() {
  const { snap } = useCluster();
  if (!snap) return null;
  const dl = snap.deadlock;
  const D = new Set(dl.detection?.deadlocked ?? []);
  const redVia = new Set((dl.detection?.edges ?? []).filter((e) => D.has(e.from) && D.has(e.to)).map((e) => e.via));
  const verts: { id: string; kind: "P" | "R"; node: string; status?: string }[] = [];
  const max = Math.max(dl.procs.length, dl.res.length);
  for (let i = 0; i < max; i++) {
    if (dl.procs[i]) verts.push({ id: dl.procs[i].id, kind: "P", node: dl.procs[i].node, status: dl.procs[i].status });
    if (dl.res[i]) verts.push({ id: dl.res[i].id, kind: "R", node: dl.res[i].node });
  }
  const cx = 290;
  const cy = 190;
  const pos = new Map(verts.map((v, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / verts.length;
    return [v.id, { x: cx + 210 * Math.cos(a), y: cy + 145 * Math.sin(a) }];
  }));
  const edges: { from: string; to: string; kind: "assign" | "request"; red: boolean }[] = [];
  for (const r of dl.res) {
    if (r.holder) edges.push({ from: r.id, to: r.holder, kind: "assign", red: redVia.has(r.id) && D.has(r.holder) });
  }
  for (const p of dl.procs) {
    if (p.status === "blocked" && p.waitingFor) edges.push({ from: p.id, to: p.waitingFor, kind: "request", red: D.has(p.id) && redVia.has(p.waitingFor) });
  }
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, kind: string) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // curve request edges slightly the other way so opposite edges don't overlap
    const off = kind === "request" ? 14 : -14;
    const mx = (a.x + b.x) / 2 - uy * off;
    const my = (a.y + b.y) / 2 + ux * off;
    return `M ${a.x + ux * 24} ${a.y + uy * 24} Q ${mx} ${my} ${b.x - ux * 27} ${b.y - uy * 27}`;
  };
  return (
    <svg viewBox="0 0 580 380" className="w-full">
      <defs>
        {[["g", "#34d399"], ["a", "#fbbf24"], ["r", "#f43f5e"]].map(([k, c]) => (
          <marker key={k} id={`m-${k}`} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 z" fill={c} />
          </marker>
        ))}
      </defs>
      {edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const k = e.red ? "r" : e.kind === "assign" ? "g" : "a";
        const col = e.red ? "#f43f5e" : e.kind === "assign" ? "#34d399" : "#fbbf24";
        return <path key={i} d={line(a, b, e.kind)} fill="none" stroke={col} strokeWidth={e.red ? 3 : 2} strokeDasharray={e.kind === "request" ? "6 4" : undefined} markerEnd={`url(#m-${k})`} className={e.red ? "blink" : ""} />;
      })}
      {verts.map((v) => {
        const p = pos.get(v.id)!;
        const dead = D.has(v.id);
        const aborted = v.status === "aborted";
        const stroke = dead ? "#f43f5e" : aborted ? "#475569" : nodeColor(v.node);
        return (
          <g key={v.id} opacity={aborted ? 0.45 : 1}>
            {v.kind === "P" ? <circle cx={p.x} cy={p.y} r="23" fill="#0b1020" stroke={stroke} strokeWidth="3" /> : <rect x={p.x - 21} y={p.y - 21} width="42" height="42" rx="8" fill="#0b1020" stroke={stroke} strokeWidth="3" />}
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={dead ? "#fda4af" : "#e2e8f0"}>{v.id}</text>
            <text x={p.x} y={p.y + 39} textAnchor="middle" fontSize="8.5" fill="#64748b">{snap.nodes.find((n) => n.id === v.node)?.name}{v.status === "blocked" ? " · blocked" : v.status === "aborted" ? " · aborted" : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function DeadlockPage() {
  const { snap, act } = useCluster();
  const [pid, setPid] = useState("P1");
  const [rid, setRid] = useState("R1");
  const [strategy, setStrategy] = useState("youngest");
  if (!snap) return null;
  const dl = snap.deadlock;
  const det = dl.detection;
  const deadlocked = det?.deadlocked ?? [];
  const probesBy = new Map<string, NonNullable<typeof det>["probes"]>();
  det?.probes.forEach((p) => probesBy.set(p.init, [...(probesBy.get(p.init) ?? []), p]));

  return (
    <>
      <PageHeader
        icon="⛓"
        eyebrow="Deadlock detection"
        title="Wait-for graphs & edge chasing"
        desc="Processes on different sites hold and request single-instance resources. The system builds a wait-for graph (P → Q when P waits for something Q holds) and searches it for cycles. In parallel it runs the Chandy–Misra–Haas edge-chasing algorithm: each blocked process sends probes along wait edges, and a probe that returns to its initiator proves a deadlock — no global graph required."
        chips={["resource allocation graph", "wait-for graph", "cycle detection", "Chandy-Misra-Haas probes", "victim selection"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status" value={deadlocked.length ? "DEADLOCK" : "SAFE"} tone={deadlocked.length ? "text-rose-400" : "text-emerald-300"} hint={deadlocked.length ? `${deadlocked.join(", ")} stuck` : "no cycles"} />
        <Stat label="Blocked procs" value={dl.procs.filter((p) => p.status === "blocked").length} tone="text-amber-300" />
        <Stat label="Wait-for edges" value={det?.edges.length ?? 0} />
        <Stat label="Probes sent" value={det?.probes.length ?? 0} hint={`${det?.probes.filter((p) => p.cross).length ?? 0} cross-site`} tone="text-sky-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card
          title="Resource allocation graph"
          subtitle="○ process · □ resource · green: held-by · amber dashed: waits-for · red: deadlock cycle"
          className="lg:col-span-3"
          bodyClass="grid-bg rounded-b-2xl"
          right={deadlocked.length ? <Badge tone="red"><span className="blink">● deadlock</span></Badge> : <Badge tone="green">healthy</Badge>}
        >
          <Graph />
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Scenarios">
            <div className="grid grid-cols-1 gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => act("dl.preset", { name: p.id })} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-xs transition hover:border-rose-400/40 hover:bg-white/5">
                  <span className="font-semibold text-slate-100">{p.name}</span>
                  <span className="text-slate-500">{p.d}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Manual control">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Process"><select className={inputCls} value={pid} onChange={(e) => setPid(e.target.value)}>{dl.procs.map((p) => <option key={p.id}>{p.id}</option>)}</select></Field>
              <Field label="Resource"><select className={inputCls} value={rid} onChange={(e) => setRid(e.target.value)}>{dl.res.map((r) => <option key={r.id}>{r.id}</option>)}</select></Field>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Btn variant="primary" onClick={() => act("dl.request", { pid, rid })}>Request</Btn>
              <Btn onClick={() => act("dl.release", { pid, rid })}>Release</Btn>
              <Btn size="sm" onClick={() => act("dl.add", { kind: "process" })}>+ process</Btn>
              <Btn size="sm" onClick={() => act("dl.add", { kind: "resource" })}>+ resource</Btn>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={dl.auto} onChange={(e) => act("dl.auto", { on: e.target.checked }, { silent: true })} className="accent-rose-400" />
              Run detection automatically after every operation
            </label>
          </Card>
          <Card title="Detect & recover">
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={() => act("dl.detect")}>🔍 Run detection</Btn>
            </div>
            <div className="mt-2 flex gap-2">
              <select className={inputCls} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                <option value="youngest">Abort youngest</option>
                <option value="lowest-priority">Abort lowest priority</option>
                <option value="fewest-resources">Abort fewest resources</option>
              </select>
              <Btn variant="danger" disabled={!deadlocked.length} onClick={() => act("dl.resolve", { strategy })}>Resolve</Btn>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Processes & resources" className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.03] text-slate-500">
                <tr>{["Process", "Site", "Prio", "Status", "Holds", "Waiting for", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {dl.procs.map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-1.5 font-mono font-semibold text-slate-100">{p.id}</td>
                    <td className="px-3 py-1.5"><NodeTag id={p.node} /></td>
                    <td className="px-3 py-1.5 font-mono">{p.priority}</td>
                    <td className="px-3 py-1.5"><Badge tone={deadlocked.includes(p.id) ? "red" : p.status === "blocked" ? "amber" : p.status === "aborted" ? "slate" : "green"}>{deadlocked.includes(p.id) ? "deadlocked" : p.status}</Badge></td>
                    <td className="px-3 py-1.5 font-mono">{dl.res.filter((r) => r.holder === p.id).map((r) => r.id).join(", ") || "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{p.waitingFor ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">{p.status === "aborted" && <Btn size="sm" variant="success" onClick={() => act("dl.restart", { pid: p.id })}>restart</Btn>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {dl.res.map((r) => (
              <div key={r.id} className="rounded-xl border border-white/5 bg-black/25 px-3 py-2 text-xs">
                <div className="flex justify-between"><span className="font-mono font-semibold text-slate-100">{r.id}</span><span className="text-slate-500">{r.nodeName}</span></div>
                <div className="mt-0.5 text-slate-400">held by <span className="font-mono text-emerald-300">{r.holder ?? "∅"}</span></div>
                <div className="text-slate-500">queue: {r.queue.join(" → ") || "empty"}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Edge-chasing probes" subtitle="probe(initiator, sender, receiver)">
            {!det || det.probes.length === 0 ? <Empty>No blocked processes — no probes.</Empty> : (
              <div className="max-h-64 space-y-2 overflow-y-auto text-xs">
                {[...probesBy.entries()].map(([init, ps]) => (
                  <div key={init} className="rounded-lg bg-black/25 p-2">
                    <div className="mb-1 font-semibold text-slate-300">Initiator {init}</div>
                    <div className="flex flex-wrap items-center gap-1 font-mono">
                      {ps.map((p, i) => (
                        <span key={i} className={`rounded px-1.5 py-0.5 ${p.found ? "bg-rose-500/25 text-rose-200" : "bg-white/5 text-slate-300"}`} title={p.cross ? "inter-site message" : "local"}>
                          ({p.init},{p.from},{p.to}){p.cross ? "✱" : ""}{p.found ? " ⟲ DEADLOCK" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {det?.cycles.length ? <div className="mt-2 text-xs text-rose-300">Cycles: {det.cycles.map((c) => [...c, c[0]].join(" → ")).join(" | ")}</div> : null}
            <div className="mt-1 text-[10.5px] text-slate-500">✱ = probe crossed sites (network message)</div>
          </Card>
          <Card title="Detector log">
            <div className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
              {dl.log.length === 0 && <Empty>Nothing yet.</Empty>}
              {dl.log.map((l) => (
                <div key={l.id} className={`rounded-md px-2 py-1 ${l.level === "ok" ? "bg-emerald-500/10 text-emerald-300" : l.level === "warn" ? "bg-amber-500/10 text-amber-300" : "bg-white/[0.03] text-slate-300"}`}>{l.text}</div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
