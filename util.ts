/** Process-wide singletons that survive HMR and are shared across route bundles. */
export function singleton<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!(key in g)) g[key] = init();
  return g[key] as T;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type Payload = Record<string, unknown>;

export function str(p: Payload, key: string, def = ""): string {
  const v = p[key];
  return typeof v === "string" ? v : v == null ? def : String(v);
}

export function num(p: Payload, key: string, def = 0): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : def;
}

export function bool(p: Payload, key: string, def = false): boolean {
  const v = p[key];
  return typeof v === "boolean" ? v : def;
}
