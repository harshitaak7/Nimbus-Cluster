"use client";

import { useState } from "react";
import { Badge, Btn, Card, Empty, EventLog, Field, NodeSelect, NodeTag, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster, useTicker } from "@/components/cluster-provider";
import { fmtClock, fmtSigned, nodeColor } from "@/lib/format";

function Analog({ ms, color, down }: { ms: number; color: string; down: boolean }) {
  const d = new Date(ms);
  const s = d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  const m = d.getUTCMinutes() + s / 60;
  const h = (d.getUTCHours() % 12) + m / 60;
  const hand = (deg: number, len: number, w: number, c: string) => (
    <line x1="50" y1="50" x2={50 + len * Math.sin((deg * Math.PI) / 180)} y2={50 - len * Math.cos((deg * Math.PI) / 180)} stroke={c} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <svg viewBox="0 0 100 100" className={`mx-auto h-24 w-24 ${down ? "opacity-30" : ""}`}>
      <circle cx="50" cy="50" r="46" fill="#0b1020" stroke={color} strokeWidth="2" />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1="50" y1="8" x2="50" y2={i % 3 === 0 ? 14 : 11} stroke="#475569" strokeWidth={i % 3 === 0 ? 2 : 1} transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {hand(h * 30, 22, 3, "#e2e8f0")}
      {hand(m * 6, 32, 2, "#cbd5e1")}
      {hand(s * 6, 38, 1, color)}
      <circle cx="50" cy="50" r="2.5" fill={color} />
    </svg>
  );
}

export default function ClocksPage() {
  const { snap, act, receivedAt } = useCluster();
  const [master, setMaster] = useState("node-1");
  const [threshold, setThreshold] = useState(5000);
  const [busy, setBusy] = useState(false);
  const [faulty, setFaulty] = useState("node-4");
  const now = useTicker(60);
  if (!snap) return null;
  const elapsed = now - receivedAt;
  const run = snap.berkeley[0];
  const ups = snap.nodes.filter((n) => n.status === "up");
  const spread = ups.length ? Math.max(...ups.map((n) => n.offset)) - Math.min(...ups.map((n) => n.offset)) : 0;
  const scale = Math.max(3000, ...snap.nodes.map((n) => Math.abs(n.offset))) * 1.1;

  return (
    <>
      <PageHeader
        icon="◷"
        eyebrow="Clock synchronisation"
        title="Berkeley algorithm"
        desc="Every node's oscillator drifts at its own rate. Berkeley needs no UTC source: one node acts as time daemon, polls all clocks over TCP (compensating for round-trip time), averages the differences while ignoring faulty clocks, and tells each node how much to adjust — not an absolute time, so network delay doesn't matter."
        chips={["time daemon", "rtt/2 compensation", "fault-tolerant average", "relative adjustments", "clock drift"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current max skew" value={`${Math.abs(spread).toLocaleString()} ms`} tone={spread > 1000 ? "text-amber-300" : "text-emerald-300"} hint="between live nodes" />
        <Stat label="Sync runs" value={snap.berkeley.length} tone="text-pink-300" />
        <Stat label="Last: before" value={run ? `${run.spreadBefore} ms` : "—"} />
        <Stat label="Last: after" value={run ? `${run.spreadAfter} ms` : "—"} tone="text-emerald-300" />
      </div>

      <Card title="Node clocks" subtitle="Live local time of each node (UTC). Drift keeps them slowly separating." className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {snap.nodes.map((n) => (
            <div key={n.id} className="rounded-xl border border-white/5 bg-black/25 p-3 text-center">
              <div className="text-xs font-semibold" style={{ color: nodeColor(n.id) }}>{n.name}</div>
              <Analog ms={n.clock + elapsed} color={nodeColor(n.id)} down={n.status === "down"} />
              <div className="mt-1 font-mono text-sm tabular-nums text-slate-100">{fmtClock(n.clock + elapsed)}</div>
              <div className="mt-1 flex justify-center gap-1">
                <Badge tone={Math.abs(n.offset) > 1500 ? "amber" : "green"}>{fmtSigned(n.offset)}</Badge>
              </div>
              <div className="mt-1 text-[10.5px] text-slate-500">drift {n.drift > 0 ? "+" : ""}{n.drift} ms/s</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Run synchronisation">
            <Field label="Time daemon (coordinator)"><NodeSelect value={master} onChange={setMaster} onlyUp /></Field>
            <Field label={`Fault tolerance threshold: ±${threshold} ms`} className="mt-3">
              <input type="range" min={500} max={20000} step={500} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-pink-400" />
            </Field>
            <Btn variant="primary" className="mt-3 w-full" disabled={busy} onClick={async () => { setBusy(true); await act("clock.berkeley", { master, threshold }); setBusy(false); }}>
              {busy ? "Polling clocks…" : "Synchronise clocks"}
            </Btn>
          </Card>
          <Card title="Break the clocks">
            <div className="flex gap-2">
              <Btn className="flex-1" onClick={() => act("clock.randomize", { max: 6000 })}>Randomise skew</Btn>
            </div>
            <div className="mt-3 grid grid-cols-5 items-end gap-2">
              <div className="col-span-3"><Field label="Faulty node"><NodeSelect value={faulty} onChange={setFaulty} /></Field></div>
              <Btn className="col-span-2" variant="danger" onClick={() => act("clock.set", { node: faulty, offset: 45000 })}>+45 s</Btn>
            </div>
            <p className="mt-2 text-xs text-slate-500">A faulty clock beyond the threshold is excluded from the average (but still corrected).</p>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Deviation from true time" subtitle="Bars grow left (slow) or right (fast)">
            <div className="space-y-2">
              {snap.nodes.map((n) => {
                const pct = Math.min(50, (Math.abs(n.offset) / scale) * 50);
                return (
                  <div key={n.id} className="flex items-center gap-3 text-xs">
                    <div className="w-16 text-slate-300">{n.name}</div>
                    <div className="relative h-4 flex-1 rounded-full bg-white/5">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-white/30" />
                      <div className="absolute top-0 h-full rounded-full transition-all duration-500" style={{ background: nodeColor(n.id), width: `${pct}%`, left: n.offset >= 0 ? "50%" : `${50 - pct}%`, opacity: n.status === "down" ? 0.3 : 1 }} />
                    </div>
                    <div className="w-24 text-right font-mono text-slate-400">{fmtSigned(n.offset)}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Last synchronisation round" subtitle={run ? `Coordinator ${snap.nodes.find((n) => n.id === run.master)?.name} · threshold ±${run.threshold} ms` : undefined}>
            {!run ? <Empty>Run the algorithm to see each step.</Empty> : (
              <>
                <div className="grid gap-2 text-xs md:grid-cols-3">
                  {[
                    ["1 · Poll", "Coordinator asks each node for its clock via TCP; estimates its time as t + rtt/2."],
                    ["2 · Average", `Differences within ±${run.threshold} ms are averaged (incl. coordinator = 0). Avg Δ = ${fmtSigned(run.average)}.`],
                    ["3 · Adjust", "Each node receives (avg − its own diff) and applies it locally."],
                  ].map(([t, d]) => (
                    <div key={t} className="rounded-xl border border-white/5 bg-black/25 p-3">
                      <div className="font-semibold text-pink-300">{t}</div>
                      <div className="mt-1 text-slate-400">{d}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 overflow-hidden rounded-xl border border-white/5">
                  <table className="w-full text-xs">
                    <thead className="bg-white/[0.03] text-slate-500">
                      <tr>{["Node", "Reported clock", "RTT", "Δ vs coordinator", "Used in avg", "Adjustment"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody className="font-mono">
                      {run.rows.map((r) => (
                        <tr key={r.node} className="border-t border-white/5">
                          <td className="px-3 py-1.5 font-sans"><NodeTag id={r.node} /> {r.status === "coordinator" && <Badge tone="violet">daemon</Badge>}</td>
                          <td className="px-3 py-1.5 text-slate-300">{r.status === "unreachable" ? "—" : fmtClock(r.clock)}</td>
                          <td className="px-3 py-1.5 text-slate-400">{r.rtt} ms</td>
                          <td className="px-3 py-1.5 text-slate-300">{fmtSigned(r.diff)}</td>
                          <td className="px-3 py-1.5">{r.status === "unreachable" ? <Badge tone="red">unreachable</Badge> : r.included ? <Badge tone="green">yes</Badge> : <Badge tone="amber">outlier</Badge>}</td>
                          <td className="px-3 py-1.5 text-pink-300">{fmtSigned(r.adjustment)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-3 text-sm">
                  <Badge tone="amber">skew {run.spreadBefore} ms</Badge> <span className="text-slate-500">→</span> <Badge tone="green">skew {run.spreadAfter} ms</Badge>
                </div>
              </>
            )}
          </Card>
          <Card title="Synchronisation log"><EventLog kinds={["berkeley"]} max={10} height="max-h-48" /></Card>
        </div>
      </div>
    </>
  );
}
