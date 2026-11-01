"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCluster } from "./cluster-provider";
import { hhmmss, nodeColor } from "@/lib/format";

export const inputCls =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black placeholder:text-slate-500 outline-none transition focus:border-black focus:ring-2 focus:ring-black/10 disabled:opacity-50";

export function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`glass rounded-xl ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={`p-5 ${bodyClass}`}>{children}</div>
    </section>
  );
}

const variants = {
  primary: "bg-black text-white hover:bg-neutral-800",
  ghost: "border border-black/15 bg-white text-black hover:bg-black/5",
  danger: "border border-black/15 bg-white text-black hover:bg-black/5",
  success: "border border-black/15 bg-white text-black hover:bg-black/5",
  warn: "border border-black/15 bg-white text-black hover:bg-black/5",
};

export function Btn({
  variant = "ghost",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: "sm" | "md";
}) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm"
      } ${variants[variant]} ${className}`}
    />
  );
}

const tones = {
  slate: "bg-slate-500/15 text-slate-300 border-slate-500/25",
  sky: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/25",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  violet: "bg-violet-500/15 text-violet-300 border-violet-500/25",
};

export function Badge({ tone = "slate", children, className = "" }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function Stat({ label, value, hint, tone = "text-slate-50" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="glass rounded-xl px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${tone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({
  icon,
  eyebrow,
  title,
  desc,
  chips,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  desc: string;
  chips?: string[];
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-xl">
          {icon}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">{eyebrow}</div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        </div>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-slate-400">{desc}</p>
      {chips && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Badge key={c} tone="sky">
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeDot({ id, size = 10 }: { id: string; size?: number }) {
  return <span className="inline-block rounded-full" style={{ width: size, height: size, background: nodeColor(id) }} />;
}

export function NodeTag({ id }: { id: string }) {
  const { nodeName } = useCluster();
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-slate-200">
      <NodeDot id={id} size={8} />
      {nodeName(id)}
    </span>
  );
}

export function NodeSelect({
  value,
  onChange,
  includeAll,
  onlyUp,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  includeAll?: string;
  onlyUp?: boolean;
  className?: string;
}) {
  const { snap } = useCluster();
  return (
    <select className={`${inputCls} ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeAll && <option value="*">{includeAll}</option>}
      {snap?.nodes
        .filter((n) => !onlyUp || n.status === "up")
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.name} {n.status === "down" ? "(down)" : ""}
          </option>
        ))}
    </select>
  );
}

const levelCls = { info: "text-slate-300", ok: "text-emerald-300", warn: "text-amber-300", error: "text-rose-300" };
const kindCls: Record<string, string> = {
  system: "text-slate-400",
  tcp: "text-sky-400",
  udp: "text-violet-400",
  file: "text-teal-400",
  balancer: "text-lime-400",
  berkeley: "text-pink-400",
  mutex: "text-indigo-400",
  deadlock: "text-rose-400",
  mapreduce: "text-cyan-400",
};

export function EventLog({ kinds, max = 14, height = "max-h-72" }: { kinds?: string[]; max?: number; height?: string }) {
  const { snap } = useCluster();
  const items = (snap?.events ?? [])
    .filter((e) => !kinds || kinds.includes(e.kind))
    .slice(-max)
    .reverse();
  return (
    <div className={`${height} overflow-y-auto rounded-xl border border-white/5 bg-black/30 p-2 font-mono text-[11.5px] leading-relaxed`}>
      {items.length === 0 && <div className="p-3 text-slate-500">No events yet — interact with the cluster.</div>}
      {items.map((e) => (
        <div key={e.id} className="flex gap-2 px-1 py-0.5">
          <span className="shrink-0 text-slate-600">{hhmmss(e.ts)}</span>
          <span className={`w-[68px] shrink-0 uppercase ${kindCls[e.kind]}`}>{e.kind}</span>
          <span className={levelCls[e.level]}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Code({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <pre className={`overflow-auto rounded-xl border border-white/5 bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-slate-300 ${className}`}>
      {children}
    </pre>
  );
}
