"use client";

import { Badge, Btn, Card, Empty, Field, NodeTag, PageHeader, Stat } from "@/components/ui";
import { useCluster, useTicker } from "@/components/cluster-provider";
import { nodeColor } from "@/lib/format";

const STATE_COL = { RELEASED: "#64748b", WANTED: "#fbbf24", HELD: "#34d399" } as const;

function Arena() {
  const { snap, serverNow } = useCluster();
  useTicker(50);
  if (!snap) return null;
  const m = snap.mutex;
  const n = snap.nodes.length;
  const cx = 280;
  const cy = 190;
  const pos = (i: number) => ({ x: cx + 175 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n), y: cy + 135 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n) });
  const idx = (id: string) => snap.nodes.findIndex((x) => x.id === id);
  const holder = m.nodes.find((x) => x.state === "HELD");
  const now = serverNow();
  return (
    <svg viewBox="0 0 560 380" className="w-full">
      {snap.nodes.map((a, i) =>
        snap.nodes.slice(i + 1).map((b, j) => (
          <line key={a.id + b.id} x1={pos(i).x} y1={pos(i).y} x2={pos(i + 1 + j).x} y2={pos(i + 1 + j).y} stroke="#334155" strokeOpacity=".4" />
        )),
      )}
      {/* critical resource */}
      <g>
        <rect x={cx - 52} y={cy - 28} width="104" height="56" rx="14" fill="#0b1020" stroke={holder ? "#34d399" : "#334155"} strokeWidth="2" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="10" fill="#94a3b8" fontWeight="600">CRITICAL SECTION</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="13" fontWeight="700" fill={holder ? "#34d399" : "#64748b"}>
          {holder ? `🔒 ${snap.nodes[idx(holder.id)].name}` : "🔓 free"}
        </text>
      </g>
      {holder && <line x1={cx} y1={cy} x2={pos(idx(holder.id)).x} y2={pos(idx(holder.id)).y} stroke="#34d399" strokeWidth="2" className="flow-line" />}
      {snap.nodes.map((nd, i) => {
        const p = pos(i);
        const rn = m.nodes.find((x) => x.id === nd.id);
        const up = nd.status === "up";
        const col = up ? STATE_COL[rn?.state ?? "RELEASED"] : "#334155";
        return (
          <g key={nd.id}>
            {rn?.state === "WANTED" && up && <circle cx={p.x} cy={p.y} r="34" fill="none" stroke="#fbbf24" strokeWidth="2" className="blink" />}
            {rn?.state === "HELD" && <circle cx={p.x} cy={p.y} r="36" fill="#34d399" opacity=".15" />}
            <circle cx={p.x} cy={p.y} r="28" fill="#0b1020" stroke={col} strokeWidth="3" />
            <text x={p.x} y={p.y - 2} textAnchor="middle" fontSize="12" fontWeight="700" fill={nodeColor(nd.id)}>{up ? nd.name : "✕"}</text>
            <text x={p.x} y={p.y + 11} textAnchor="middle" fontSize="8" fill={col} fontWeight="600">{up ? rn?.state : "DOWN"}</text>
            <text x={p.x} y={p.y + (p.y > cy ? 46 : -38)} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="monospace">L={rn?.clock ?? 0}{rn?.reqTs ? ` · req@${rn.reqTs}` : ""}</text>
          </g>
        );
      })}
      {m.inflight.map((msg) => {
        const a = pos(idx(msg.from));
        const b = pos(idx(msg.to));
        const t = Math.max(0, Math.min(1, (now - msg.sentAt) / Math.max(1, msg.deliverAt - msg.sentAt)));
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const col = msg.type === "REQUEST" ? "#fbbf24" : "#34d399";
        return (
          <g key={msg.id}>
            <circle cx={x} cy={y} r="9" fill={col} opacity=".25" />
            <circle cx={x} cy={y} r="5" fill={col} />
            <text x={x} y={y - 10} textAnchor="middle" fontSize="8" fill={col} fontWeight="700">{msg.type === "REQUEST" ? `REQ ${msg.ts}` : "OK"}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function MutexPage() {
  const { snap, act } = useCluster();
  if (!snap) return null;
  const m = snap.mutex;
  const live = snap.nodes.filter((n) => n.status === "up").length;
  const expected = m.entries * 2 * (live - 1);

  return (
    <>
      <PageHeader
        icon="⚿"
        eyebrow="Distributed mutual exclusion"
        title="Ricart–Agrawala"
        desc="No coordinator, no token: a node that wants the critical section multicasts a timestamped REQUEST to everyone and enters only after every peer has replied. Peers reply immediately unless they hold the section or have an earlier request — in which case the reply is deferred until they exit. Lamport clocks (ties broken by node id) give a total priority order."
        chips={["2(N−1) messages / entry", "Lamport timestamps", "deferred replies", "safety check", "crash handling"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="CS entries" value={m.entries} tone="text-indigo-300" />
        <Stat label="Messages sent" value={m.messages} hint={`theory ≈ ${expected} (2(N−1) per entry)`} tone="text-sky-300" />
        <Stat label="Safety violations" value={m.violations} tone={m.violations ? "text-rose-400" : "text-emerald-300"} hint="must always be 0" />
        <Stat label="In flight" value={m.inflight.length} tone="text-amber-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Protocol arena" subtitle="Amber = REQUEST · green = REPLY" className="lg:col-span-3" bodyClass="grid-bg rounded-b-2xl">
          <Arena />
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Request the critical section">
            <div className="grid grid-cols-2 gap-2">
              {snap.nodes.map((n) => {
                const rn = m.nodes.find((x) => x.id === n.id);
                return (
                  <Btn key={n.id} disabled={n.status === "down" || rn?.state !== "RELEASED"} onClick={() => act("ra.request", { node: n.id })} className="justify-between">
                    <span style={{ color: nodeColor(n.id) }}>{n.name}</span>
                    <span className="text-[10px] uppercase text-slate-500">{n.status === "down" ? "down" : rn?.state}</span>
                  </Btn>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn variant="warn" className="flex-1" onClick={() => act("ra.stress")}>⚡ Everyone at once</Btn>
              <Btn variant="danger" onClick={() => act("ra.reset")}>Reset</Btn>
            </div>
          </Card>
          <Card title="Network & workload">
            <Field label={`Message latency: ${m.latency} ms`}>
              <input type="range" min={150} max={2500} step={50} value={m.latency} onChange={(e) => act("ra.config", { latency: Number(e.target.value), cs: m.csMs }, { silent: true })} className="w-full accent-indigo-400" />
            </Field>
            <Field label={`Time in critical section: ${m.csMs} ms`} className="mt-3">
              <input type="range" min={500} max={8000} step={100} value={m.csMs} onChange={(e) => act("ra.config", { latency: m.latency, cs: Number(e.target.value) }, { silent: true })} className="w-full accent-indigo-400" />
            </Field>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Node state tables" className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="w-full text-xs">
              <thead className="bg-white/[0.03] text-slate-500">
                <tr>{["Node", "State", "Lamport", "Req ts", "Replies", "Deferred queue", "Entries"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {m.nodes.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="px-3 py-1.5"><NodeTag id={r.id} /></td>
                    <td className="px-3 py-1.5"><Badge tone={r.state === "HELD" ? "green" : r.state === "WANTED" ? "amber" : "slate"}>{r.state}</Badge></td>
                    <td className="px-3 py-1.5 font-mono">{r.clock}</td>
                    <td className="px-3 py-1.5 font-mono">{r.reqTs ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono">{r.state === "WANTED" ? `${r.replies.length}/${r.peers.length}` : "—"}</td>
                    <td className="px-3 py-1.5">{r.deferred.length ? r.deferred.map((d) => <NodeTag key={d} id={d} />) : <span className="text-slate-600">∅</span>}</td>
                    <td className="px-3 py-1.5 font-mono">{r.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">Critical-section history</div>
          {m.history.length === 0 ? <Empty>No entries yet.</Empty> : (
            <div className="space-y-1">
              {m.history.slice(0, 6).map((h) => (
                <div key={h.id} className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-1.5 text-xs">
                  <NodeTag id={h.node} />
                  <span className="font-mono text-slate-500">req ts {h.reqTs} · waited {h.waitMs} ms</span>
                  <Badge tone={h.exitAt ? "slate" : "green"}>{h.exitAt ? `held ${h.exitAt - h.enterAt} ms` : "inside now"}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Protocol trace">
          <div className="max-h-[26rem] space-y-1 overflow-y-auto font-mono text-[11px]">
            {m.log.length === 0 && <Empty>Request the critical section to start.</Empty>}
            {m.log.map((l) => (
              <div key={l.id} className={`rounded-md px-2 py-1 ${l.level === "ok" ? "bg-emerald-500/10 text-emerald-300" : l.level === "warn" ? "bg-amber-500/10 text-amber-300" : "bg-white/[0.03] text-slate-300"}`}>{l.text}</div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
