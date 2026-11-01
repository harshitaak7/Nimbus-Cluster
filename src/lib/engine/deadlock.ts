import { getNode, log, nextId } from "./cluster";
import { singleton } from "./util";

export interface Proc {
  id: string;
  node: string;
  priority: number;
  status: "running" | "blocked" | "aborted";
  waitingFor: string | null;
  startedAt: number;
}

export interface Res {
  id: string;
  node: string;
  holder: string | null;
  queue: string[];
}

export interface Probe {
  init: string;
  from: string;
  to: string;
  cross: boolean;
  found: boolean;
}

export interface Detection {
  at: number;
  cycles: string[][];
  deadlocked: string[];
  probes: Probe[];
  edges: { from: string; to: string; via: string }[];
  victims: string[];
}

interface DL {
  procs: Proc[];
  res: Res[];
  detection: Detection | null;
  auto: boolean;
  log: { id: number; ts: number; text: string; level: "info" | "ok" | "warn" }[];
}

function st(): DL {
  return singleton("__dc_dl", () => {
    const s: DL = { procs: [], res: [], detection: null, auto: true, log: [] };
    build(s, 4, 4);
    return s;
  });
}

function build(s: DL, p: number, r: number) {
  s.procs = Array.from({ length: p }, (_, i) => mkProc(i + 1));
  s.res = Array.from({ length: r }, (_, i) => mkRes(i + 1));
  s.detection = null;
}

const mkProc = (i: number): Proc => ({
  id: `P${i}`,
  node: `node-${((i - 1) % 5) + 1}`,
  priority: (i * 7) % 5 + 1,
  status: "running",
  waitingFor: null,
  startedAt: Date.now() + i,
});
const mkRes = (i: number): Res => ({ id: `R${i}`, node: `node-${((i + 1) % 5) + 1}`, holder: null, queue: [] });

function note(s: DL, text: string, level: "info" | "ok" | "warn" = "info") {
  s.log.push({ id: nextId(), ts: Date.now(), text, level });
  if (s.log.length > 60) s.log.shift();
  log("deadlock", level, text);
}

function proc(s: DL, id: string) {
  const p = s.procs.find((x) => x.id === id);
  if (!p) throw new Error(`unknown process ${id}`);
  return p;
}
function res(s: DL, id: string) {
  const r = s.res.find((x) => x.id === id);
  if (!r) throw new Error(`unknown resource ${id}`);
  return r;
}

export function dlRequest(pid: string, rid: string) {
  const s = st();
  const p = proc(s, pid);
  const r = res(s, rid);
  if (p.status === "aborted") throw new Error(`${pid} is aborted`);
  if (p.status === "blocked") throw new Error(`${pid} is blocked waiting for ${p.waitingFor}`);
  if (r.holder === pid) throw new Error(`${pid} already holds ${rid}`);
  if (!r.holder) {
    r.holder = pid;
    note(s, `${pid} acquires ${rid}`);
  } else {
    r.queue.push(pid);
    p.status = "blocked";
    p.waitingFor = rid;
    note(s, `${pid} BLOCKS waiting for ${rid} (held by ${r.holder})`, "warn");
  }
  if (s.auto) detect(s);
}

function grantNext(s: DL, r: Res) {
  const next = r.queue.shift();
  if (next) {
    const p = proc(s, next);
    r.holder = next;
    p.status = "running";
    p.waitingFor = null;
    note(s, `${r.id} granted to waiting ${next}`, "ok");
  } else r.holder = null;
}

export function dlRelease(pid: string, rid: string) {
  const s = st();
  const r = res(s, rid);
  if (r.holder !== pid) throw new Error(`${pid} does not hold ${rid}`);
  note(s, `${pid} releases ${rid}`);
  grantNext(s, r);
  if (s.auto) detect(s);
}

/** Wait-for graph: P → Q when P waits for a resource held by Q. */
function wfg(s: DL) {
  const edges: { from: string; to: string; via: string }[] = [];
  for (const p of s.procs) {
    if (p.status !== "blocked" || !p.waitingFor) continue;
    const h = res(s, p.waitingFor).holder;
    if (h) edges.push({ from: p.id, to: h, via: p.waitingFor });
  }
  return edges;
}

function findCycles(edges: { from: string; to: string }[]) {
  const out = new Map<string, string[]>();
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const dfs = (node: string, path: string[]) => {
    const at = path.indexOf(node);
    if (at >= 0) {
      const cyc = path.slice(at);
      out.set([...cyc].sort().join(","), cyc);
      return;
    }
    for (const nx of adj.get(node) ?? []) dfs(nx, [...path, node]);
  };
  for (const k of adj.keys()) dfs(k, []);
  return [...out.values()];
}

/** Chandy–Misra–Haas edge-chasing: every blocked process launches a probe. */
function probes(s: DL, edges: { from: string; to: string }[]) {
  const out: Probe[] = [];
  const site = (pid: string) => proc(s, pid).node;
  for (const p of s.procs) {
    if (p.status !== "blocked") continue;
    const seen = new Set<string>();
    let cur = p.id;
    for (let hop = 0; hop < 12 && out.length < 90; hop++) {
      const e = edges.find((x) => x.from === cur);
      if (!e) break;
      const found = e.to === p.id;
      out.push({ init: p.id, from: cur, to: e.to, cross: site(cur) !== site(e.to), found });
      if (found || seen.has(e.to)) break;
      seen.add(e.to);
      cur = e.to;
    }
  }
  return out;
}

function detect(s: DL): Detection {
  const edges = wfg(s);
  const cycles = findCycles(edges);
  const d: Detection = {
    at: Date.now(),
    cycles,
    deadlocked: [...new Set(cycles.flat())],
    probes: probes(s, edges),
    edges,
    victims: s.detection?.victims ?? [],
  };
  const had = s.detection?.deadlocked.join() ?? "";
  s.detection = d;
  if (d.deadlocked.length && had !== d.deadlocked.join())
    note(s, `DEADLOCK detected: ${cycles.map((c) => [...c, c[0]].join(" → ")).join(" | ")}`, "warn");
  return d;
}

export function dlDetect() {
  const s = st();
  const d = detect(s);
  if (!d.deadlocked.length) note(s, `Detection run: ${d.edges.length} wait-for edge(s), no cycle — system is deadlock-free`, "ok");
  return d;
}

export function dlResolve(strategy: string) {
  const s = st();
  const victims: string[] = [];
  for (let i = 0; i < 10; i++) {
    const d = detect(s);
    if (!d.deadlocked.length) break;
    const cand = d.deadlocked.map((id) => proc(s, id));
    const held = (p: Proc) => s.res.filter((r) => r.holder === p.id).length;
    cand.sort((a, b) =>
      strategy === "lowest-priority"
        ? a.priority - b.priority
        : strategy === "fewest-resources"
          ? held(a) - held(b)
          : b.startedAt - a.startedAt,
    );
    const v = cand[0];
    note(s, `Resolving: abort ${v.id} (${strategy}) and release its resources`, "warn");
    for (const r of s.res) {
      r.queue = r.queue.filter((q) => q !== v.id);
      if (r.holder === v.id) grantNext(s, r);
    }
    v.status = "aborted";
    v.waitingFor = null;
    victims.push(v.id);
  }
  const d = detect(s);
  d.victims = victims;
  if (victims.length) note(s, `Deadlock resolved by aborting ${victims.join(", ")}`, "ok");
  return victims;
}

export function dlRestart(pid: string) {
  const s = st();
  const p = proc(s, pid);
  p.status = "running";
  p.waitingFor = null;
  p.startedAt = Date.now();
  note(s, `${pid} restarted`);
  detect(s);
}

export function dlAdd(kind: "process" | "resource") {
  const s = st();
  if (kind === "process") {
    if (s.procs.length >= 8) throw new Error("max 8 processes");
    s.procs.push(mkProc(s.procs.length + 1));
  } else {
    if (s.res.length >= 8) throw new Error("max 8 resources");
    s.res.push(mkRes(s.res.length + 1));
  }
}

export function dlAuto(on: boolean) {
  st().auto = on;
}

export function dlPreset(name: string) {
  const s = st();
  const ops: [string, string][] = [];
  switch (name) {
    case "classic":
      build(s, 4, 4);
      ops.push(["P1", "R1"], ["P2", "R2"], ["P1", "R2"], ["P2", "R1"]);
      break;
    case "ring":
      build(s, 4, 4);
      ops.push(["P1", "R1"], ["P2", "R2"], ["P3", "R3"], ["P4", "R4"], ["P1", "R2"], ["P2", "R3"], ["P3", "R4"], ["P4", "R1"]);
      break;
    case "distributed":
      build(s, 6, 6);
      ops.push(["P1", "R1"], ["P2", "R2"], ["P3", "R3"], ["P1", "R2"], ["P2", "R3"], ["P3", "R1"], ["P4", "R4"], ["P5", "R5"], ["P4", "R5"], ["P6", "R6"], ["P5", "R1"]);
      break;
    case "safe":
      build(s, 4, 4);
      ops.push(["P1", "R1"], ["P2", "R2"], ["P3", "R3"], ["P2", "R1"], ["P3", "R2"], ["P4", "R3"]);
      break;
    default:
      build(s, 4, 4);
  }
  const auto = s.auto;
  s.auto = false;
  for (const [p, r] of ops) dlRequest(p, r);
  s.auto = auto;
  s.log = [];
  note(s, `Scenario "${name}" loaded`);
  if (auto) detect(s);
}

export function dlView() {
  const s = st();
  return {
    auto: s.auto,
    procs: s.procs.map((p) => ({ ...p, nodeName: getNode(p.node).name })),
    res: s.res.map((r) => ({ ...r, nodeName: getNode(r.node).name })),
    detection: s.detection,
    log: s.log.slice(-40).reverse(),
  };
}
