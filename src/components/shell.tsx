"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useCluster } from "./cluster-provider";
import { nodeColor } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", icon: "◎", tag: "Cluster" },
  { href: "/messaging", label: "TCP & UDP", icon: "⇄", tag: "Messaging" },
  { href: "/files", label: "File Sharing", icon: "▤", tag: "Storage" },
  { href: "/balancer", label: "Round Robin", icon: "↻", tag: "Scheduling" },
  { href: "/clocks", label: "Berkeley Clocks", icon: "◷", tag: "Sync" },
  { href: "/mutex", label: "Ricart-Agrawala", icon: "⚿", tag: "Mutex" },
  { href: "/deadlock", label: "Deadlock", icon: "⛓", tag: "Detection" },
  { href: "/mapreduce", label: "MapReduce", icon: "⋔", tag: "Compute" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { snap, online } = useCluster();
  const up = snap?.nodes.filter((n) => n.status === "up").length ?? 0;
  const total = snap?.nodes.length ?? 5;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-black/10 bg-white p-4 md:flex">
        <Link href="/" className="mb-7 flex items-center gap-3 px-2 pt-1">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-black text-lg font-bold text-white">
            ∴
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-black">Nimbus Cluster</div>
            <div className="text-[11px] text-slate-500">distributed systems lab</div>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-black text-white"
                    : "text-slate-400 hover:bg-black/5 hover:text-black"
                }`}
              >
                <span className={`grid h-6 w-6 place-items-center rounded-md text-sm ${active ? "bg-white/15 text-white" : "bg-black/5 text-slate-500 group-hover:text-black"}`}>
                  {n.icon}
                </span>
                <span className="flex-1">{n.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-600">{n.tag}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-slate-400">Cluster health</span>
            <span className={`font-mono ${up === total ? "text-emerald-400" : "text-amber-400"}`}>
              {up}/{total} up
            </span>
          </div>
          <div className="flex gap-1.5">
            {snap?.nodes.map((n) => (
              <div
                key={n.id}
                title={`${n.name} — ${n.status}`}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: n.status === "up" ? nodeColor(n.id) : "#334155" }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-rose-500"}`} />
            {online ? "live · polling 600ms" : "server unreachable"}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-black/10 bg-white/95 p-2 backdrop-blur md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs ${
                (n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "bg-black text-white" : "text-slate-400"
              }`}
            >
              {n.icon} {n.label}
            </Link>
          ))}
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {!snap ? <div className="grid h-[60vh] place-items-center text-sm text-slate-500"><span className="blink">Booting cluster nodes…</span></div> : children}
        </main>
      </div>
    </div>
  );
}
