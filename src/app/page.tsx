"use client";

import Link from "next/link";
import { Badge, Btn, Card, EventLog, PageHeader, Stat } from "@/components/ui";
import { useCluster, useTicker } from "@/components/cluster-provider";
import { fmtAgo, fmtBytes, fmtClock, fmtSigned, nodeColor } from "@/lib/format";

const CONCEPTS = [
  { href: "/messaging", icon: "⇄", t: "TCP messaging", d: "Reliable, ordered request/ack delivery over real loopback sockets." },
  { href: "/messaging", icon: "✉", t: "UDP notifications", d: "Fire-and-forget topic datagrams with tunable packet loss." },
  { href: "/files", icon: "▤", t: "File sharing", d: "Chunked, replicated storage backed by PostgreSQL." },
  { href: "/balancer", icon: "↻", t: "Round Robin", d: "Plain, weighted and least-connection dispatch." },
  { href: "/clocks", icon: "◷", t: "Berkeley sync", d: "Time-daemon averaging with outlier rejection." },
  { href: "/mutex", icon: "⚿", t: "Ricart-Agrawala", d: "Lamport-ordered distributed mutual exclusion." },
  { href: "/deadlock", icon: "⛓", t: "Deadlock detection", d: "Wait-for graphs and Chandy-Misra-Haas probes." },
  { href: "/mapreduce", icon: "⋔", t: "MapReduce", d: "Split, map, shuffle, reduce — with failure re-execution." },
];

function Topology() {
  const { snap } = useCluster();
  const now = useTicker(250);
  if (!snap) return null;
  const cx = 260;
  const cy = 165;
  const R = 118;
  const pts = snap.nodes.map((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / snap.nodes.length;
    return { n, x: cx + R * Math.cos(a) * 1.35, y: cy + R * Math.sin(a) };
  });
  const t = now / 1000;
  return (
    <svg viewBox="0 0 520 330" className="w-full">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="70" fill="url(#core)" />
      {pts.map((a, i) =>
        pts.slice(i + 1).map((b) => {
          const live = a.n.status === "up" && b.n.status === "up";
          return (
            <line
              key={a.n.id + b.n.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={live ? "#6366f1" : "#334155"}
              strokeOpacity={live ? 0.35 : 0.2}
              strokeWidth="1"
              className={live ? "flow-line" : ""}
            />
          );
        }),
      )}
      {pts.map((a, i) => {
        const b = pts[(i + 2) % pts.length];
        if (a.n.status !== "up" || b.n.status !== "up") return null;
        const p = (t * 0.45 + i * 0.2) % 1;
        return <circle key={"hb" + i} cx={a.x + (b.x - a.x) * p} cy={a.y + (b.y - a.y) * p} r="2.6" fill="#a78bfa" />;
      })}
      {pts.map(({ n, x, y }) => {
        const up = n.status === "up";
        const col = up ? nodeColor(n.id) : "#475569";
        return (
          <g key={n.id}>
            {up && <circle cx={x} cy={y} r={26 + Math.sin(t * 2 + x) * 2} fill={col} opacity="0.12" />}
            <circle cx={x} cy={y} r="21" fill="#0b1020" stroke={col} strokeWidth="2.5" />
            <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={col}>
              {up ? n.name[0] : "✕"}
            </text>
            <text x={x} y={y + 40} textAnchor="middle" fontSize="11" fontWeight="600" fill="#e2e8f0">
              {n.name}
            </text>
            <text x={x} y={y + 53} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="monospace">
              :{n.tcpPort}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Overview() {
  const { snap, act } = useCluster();
  useTicker(100);
  if (!snap) return null;
  const s = snap.stats;
  const up = snap.nodes.filter((n) => n.status === "up").length;

  return (
    <>
      <PageHeader
        icon="◎"
        eyebrow="Mission control"
        title="Distributed cluster overview"
        desc="A five-node virtual cluster running inside this server. Nodes talk over real TCP and UDP sockets on loopback, share files through PostgreSQL, synchronise clocks, take distributed locks and crunch MapReduce jobs. Crash a node and watch every subsystem react."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Nodes up" value={`${up}/${snap.nodes.length}`} tone={up === snap.nodes.length ? "text-emerald-300" : "text-amber-300"} />
        <Stat label="TCP messages" value={s.tcpMessages} hint={fmtBytes(s.tcpBytes)} tone="text-sky-300" />
        <Stat label="UDP datagrams" value={s.udpSent} hint={`${s.udpDropped} dropped`} tone="text-violet-300" />
        <Stat label="Files stored" value={s.filesStored} hint={`${s.filesServed} downloads`} tone="text-teal-300" />
        <Stat label="CS entries" value={snap.mutex.entries} hint={`${snap.mutex.violations} violations`} tone="text-indigo-300" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-5">
        <Card title="Cluster topology" subtitle="Full mesh · purple dots are UDP heartbeats" className="lg:col-span-2" bodyClass="grid-bg rounded-b-2xl">
          <Topology />
        </Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          {snap.nodes.map((n) => {
            const up = n.status === "up";
            const load = snap.balancer.load[n.id];
            return (
              <div key={n.id} className={`glass relative overflow-hidden rounded-2xl p-4 ${up ? "" : "opacity-70"}`}>
                <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: up ? nodeColor(n.id) : "#334155" }} />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ color: up ? "#34d399" : "#f43f5e", background: "currentColor" }}>
                      {up && <span className="pulse-ring" />}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-white">{n.name}</div>
                      <div className="font-mono text-[10.5px] text-slate-500">
                        tcp:{n.tcpPort} · udp:{n.udpPort}
                      </div>
                    </div>
                  </div>
                  {up ? (
                    <Btn size="sm" variant="danger" onClick={() => act("node.fail", { node: n.id })}>
                      Crash
                    </Btn>
                  ) : (
                    <Btn size="sm" variant="success" onClick={() => act("node.recover", { node: n.id })}>
                      Recover
                    </Btn>
                  )}
                </div>
                <div className="mt-3 font-mono text-lg tabular-nums text-slate-100">{fmtClock(n.clock + 0)}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={Math.abs(n.offset) > 1000 ? "amber" : "green"}>skew {fmtSigned(n.offset)}</Badge>
                  <Badge tone="slate">w={n.weight}</Badge>
                  <Badge tone="sky">
                    queue {load.queued + load.running}
                  </Badge>
                  <Badge tone={up && n.lastSeenAgo < 5000 ? "green" : "red"}>♥ {up ? fmtAgo(n.lastSeenAgo) : "silent"}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Concepts, all live</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CONCEPTS.map((c) => (
          <Link key={c.t} href={c.href} className="glass group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:border-sky-400/40">
            <div className="mb-2 grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-base text-sky-300 transition group-hover:bg-sky-400/20">{c.icon}</div>
            <div className="text-sm font-semibold text-white">{c.t}</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{c.d}</p>
          </Link>
        ))}
      </div>

      <Card title="Cluster event stream" subtitle="Everything every subsystem does, in order" bodyClass="">
        <EventLog max={40} height="max-h-96" />
      </Card>
    </>
  );
}
