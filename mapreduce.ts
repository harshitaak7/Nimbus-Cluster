export type JobType = "wordcount" | "charfreq" | "invertedindex" | "grep" | "avglen";

export interface MRInput {
  job: JobType;
  text: string;
  mappers: number;
  reducers: number;
  combiner: boolean;
  workers: { id: string; name: string }[];
  failWorker?: string;
  pattern?: string;
}

export interface MRTask {
  id: string;
  type: "map" | "reduce";
  worker: string;
  start: number;
  end: number;
  status: "done" | "failed";
  attempt: number;
  input: number;
  output: number;
}

export interface MRResult {
  job: JobType;
  phases: { name: string; start: number; end: number }[];
  tasks: MRTask[];
  shuffle: number[][]; // [map task][reducer]
  output: [string, string][];
  totals: {
    lines: number;
    inputBytes: number;
    mapRecords: number;
    shuffled: number;
    keys: number;
    retries: number;
    combinerSaved: number;
  };
  durationMs: number;
}

type KV = [string, string | number];

const WORD = /[a-z0-9']+/g;

function mapFn(job: JobType, line: string, lineNo: number, pattern?: RegExp): KV[] {
  const lower = line.toLowerCase();
  switch (job) {
    case "wordcount":
      return (lower.match(WORD) ?? []).map((w): KV => [w, 1]);
    case "charfreq":
      return [...lower].filter((ch) => /[a-z]/.test(ch)).map((ch): KV => [ch, 1]);
    case "invertedindex":
      return [...new Set(lower.match(WORD) ?? [])].map((w): KV => [w, lineNo]);
    case "grep":
      return pattern && pattern.test(line) ? [[String(lineNo).padStart(5, "0"), line]] : [];
    case "avglen":
      return (lower.match(WORD) ?? []).map((w): KV => [w[0], w.length]);
  }
}

function reduceFn(job: JobType, key: string, vals: (string | number)[]): string {
  switch (job) {
    case "wordcount":
    case "charfreq":
      return String(vals.reduce<number>((s, v) => s + Number(v), 0));
    case "invertedindex":
      return [...new Set(vals.map(Number))].sort((a, b) => a - b).join(", ");
    case "grep":
      return String(vals[0]);
    case "avglen":
      return (vals.reduce<number>((s, v) => s + Number(v), 0) / vals.length).toFixed(2) + ` (n=${vals.length})`;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function runMapReduce(inp: MRInput): MRResult {
  const lines = inp.text.split(/\r?\n/);
  if (!inp.text.trim()) throw new Error("input is empty");
  if (inp.workers.length === 0) throw new Error("no live workers");
  let pattern: RegExp | undefined;
  if (inp.job === "grep") {
    try {
      pattern = new RegExp(inp.pattern || "the", "i");
    } catch {
      throw new Error("invalid grep pattern");
    }
  }
  const M = Math.max(1, Math.min(inp.mappers, lines.length, 16));
  const R = Math.max(1, Math.min(inp.reducers, 8));
  const chunk = Math.ceil(lines.length / M);
  const splits = Array.from({ length: M }, (_, i) => ({ from: i * chunk, lines: lines.slice(i * chunk, (i + 1) * chunk) })).filter((s) => s.lines.length);

  // ---- real map computation
  const canCombine = inp.combiner && (inp.job === "wordcount" || inp.job === "charfreq");
  let mapRecords = 0;
  let combinerSaved = 0;
  const mapOut: KV[][] = splits.map((sp) => {
    let out: KV[] = sp.lines.flatMap((l, i) => mapFn(inp.job, l, sp.from + i + 1, pattern));
    mapRecords += out.length;
    if (canCombine) {
      const m = new Map<string, number>();
      for (const [k, v] of out) m.set(k, (m.get(k) ?? 0) + Number(v));
      const before = out.length;
      out = [...m.entries()];
      combinerSaved += before - out.length;
    }
    return out;
  });

  // ---- scheduling (round robin onto workers, one slot per worker)
  const workers = inp.workers;
  const free: Record<string, number> = Object.fromEntries(workers.map((w) => [w.id, 0]));
  const tasks: MRTask[] = [];
  const dur = (base: number, n: number, per: number, seed: string) => Math.round(base + n * per + (hash(seed) % 90));
  const failer = inp.failWorker && workers.length > 1 && workers.some((w) => w.id === inp.failWorker) ? inp.failWorker : undefined;
  const healthy = workers.filter((w) => w.id !== failer);

  const assign: string[] = splits.map((_, i) => workers[i % workers.length].id);
  const retryQueue: number[] = [];
  let failAt = 0;
  let failedOnce = false;
  splits.forEach((sp, i) => {
    const w = assign[i];
    const d = dur(260, sp.lines.length, 14, `m${i}`);
    if (failer && w === failer) {
      if (!failedOnce) {
        failedOnce = true;
        const start = free[w];
        failAt = start + Math.round(d * 0.55);
        tasks.push({ id: `map-${i}`, type: "map", worker: w, start, end: failAt, status: "failed", attempt: 1, input: sp.lines.length, output: 0 });
        free[w] = Infinity;
      }
      retryQueue.push(i);
      return;
    }
    const start = free[w];
    free[w] = start + d;
    tasks.push({ id: `map-${i}`, type: "map", worker: w, start, end: start + d, status: "done", attempt: 1, input: sp.lines.length, output: mapOut[i].length });
  });
  retryQueue.forEach((i, k) => {
    const w = healthy[k % healthy.length].id;
    const d = dur(260, splits[i].lines.length, 14, `m${i}`);
    const start = Math.max(free[w], failAt + 350);
    free[w] = start + d;
    assign[i] = w;
    tasks.push({ id: `map-${i}`, type: "map", worker: w, start, end: start + d, status: "done", attempt: 2, input: splits[i].lines.length, output: mapOut[i].length });
  });
  const mapEnd = Math.max(...tasks.map((t) => t.end));

  // ---- shuffle: partition by hash(key) mod R
  const shuffle: number[][] = splits.map(() => Array<number>(R).fill(0));
  const parts: Map<string, (string | number)[]>[] = Array.from({ length: R }, () => new Map());
  mapOut.forEach((out, i) => {
    for (const [k, v] of out) {
      const r = hash(k) % R;
      shuffle[i][r]++;
      const arr = parts[r].get(k);
      if (arr) arr.push(v);
      else parts[r].set(k, [v]);
    }
  });
  const shuffled = shuffle.flat().reduce((a, b) => a + b, 0);
  const shuffleEnd = mapEnd + Math.round(140 + shuffled * 0.9);

  // ---- reduce
  const rfree: Record<string, number> = Object.fromEntries(workers.map((w) => [w.id, shuffleEnd]));
  const output: [string, string][] = [];
  parts.forEach((p, r) => {
    const w = (failer ? healthy : workers)[r % (failer ? healthy : workers).length].id;
    let inRecords = 0;
    for (const [k, vals] of p) {
      inRecords += vals.length;
      output.push([k, reduceFn(inp.job, k, vals)]);
    }
    const d = dur(220, inRecords, 2.2, `r${r}`);
    const start = rfree[w];
    rfree[w] = start + d;
    tasks.push({ id: `reduce-${r}`, type: "reduce", worker: w, start, end: start + d, status: "done", attempt: 1, input: inRecords, output: p.size });
  });
  const end = Math.max(...tasks.map((t) => t.end));

  if (inp.job === "grep") output.sort((a, b) => a[0].localeCompare(b[0]));
  else if (inp.job === "invertedindex" || inp.job === "avglen") output.sort((a, b) => a[0].localeCompare(b[0]));
  else output.sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));

  return {
    job: inp.job,
    phases: [
      { name: "Split", start: 0, end: 0 },
      { name: "Map", start: 0, end: mapEnd },
      { name: "Shuffle & Sort", start: mapEnd, end: shuffleEnd },
      { name: "Reduce", start: shuffleEnd, end },
    ],
    tasks,
    shuffle,
    output: output.slice(0, 300),
    totals: {
      lines: lines.length,
      inputBytes: Buffer.byteLength(inp.text),
      mapRecords,
      shuffled,
      keys: output.length,
      retries: tasks.filter((t) => t.status === "failed").length,
      combinerSaved,
    },
    durationMs: end,
  };
}
