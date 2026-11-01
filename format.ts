export const NODE_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185"];

export function nodeColor(id: string): string {
  const i = Number(id.replace(/\D/g, "")) - 1;
  return NODE_COLORS[(i < 0 ? 0 : i) % NODE_COLORS.length];
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtSigned(ms: number): string {
  return `${ms >= 0 ? "+" : "−"}${Math.abs(Math.round(ms)).toLocaleString()} ms`;
}

export function fmtAgo(ms: number): string {
  if (ms < 1500) return "just now";
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

export function hhmmss(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}
