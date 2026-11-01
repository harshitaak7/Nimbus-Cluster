import { getCluster, getNode, log, nextId, registerNodeHook } from "./cluster";
import { singleton, rand } from "./util";

/**
 * Ricart–Agrawala distributed mutual exclusion.
 * Messages travel over a simulated network with configurable latency so the
 * protocol can be watched step by step. Lamport clocks order the requests.
 */

export type RAMode = "RELEASED" | "WANTED" | "HELD";

interface RANode {
  id: string;
  state: RAMode;
  clock: number;
  reqTs: number | null;
  reqAt: number;
  peers: string[];
  replies: string[];
  deferred: string[];
  entries: number;
  token: number;
}

export interface RAMsg {
  id: number;
  from: string;
  to: string;
  type: "REQUEST" | "REPLY";
  ts: number;
  sentAt: number;
  deliverAt: number;
}

interface RAHistory {
  id: number;
  node: string;
  reqTs: number;
  waitMs: number;
  enterAt: number;
  exitAt: number | null;
}

interface RAState {
  nodes: Record<string, RANode>;
  inflight: RAMsg[];
  log: { id: number; ts: number; text: string; level: "info" | "ok" | "warn" }[];
  latency: number;
  csMs: number;
  entries: number;
  messages: number;
  violations: number;
  history: RAHistory[];
}

function fresh(id: string): RANode {
  return { id, state: "RELEASED", clock: 0, reqTs: null, reqAt: 0, peers: [], replies: [], deferred: [], entries: 0, token: 0 };
}

function st(): RAState {
  const s = singleton("__dc_ra", () => {
    const x: RAState = {
      nodes: {},
      inflight: [],
      log: [],
      latency: 900,
      csMs: 2600,
      entries: 0,
      messages: 0,
      violations: 0,
      history: [],
    };
    return x;
  });
  for (const n of getCluster().nodes) if (!s.nodes[n.id]) s.nodes[n.id] = fresh(n.id);
  return s;
}

export function ensureMutex() {
  const s = st();
  registerNodeHook("mutex", (n) => {
    const rn = s.nodes[n.id];
    if (n.status === "down") {
      if (rn.state === "HELD") closeHistory(s, n.id);
      s.nodes[n.id] = { ...fresh(n.id), clock: rn.clock, entries: rn.entries, token: rn.token + 1 };
      s.inflight = s.inflight.filter((m) => m.to !== n.id && m.from !== n.id);
      note(s, `${n.name} crashed — removed from the quorum`, "warn");
      for (const other of Object.values(s.nodes)) check(s, other.id);
    } else {
      s.nodes[n.id] = { ...fresh(n.id), clock: rn.clock, entries: rn.entries, token: rn.token + 1 };
    }
  });
}

function note(s: RAState, text: string, level: "info" | "ok" | "warn" = "info") {
  s.log.push({ id: nextId(), ts: Date.now(), text, level });
  if (s.log.length > 80) s.log.shift();
  log("mutex", level === "warn" ? "warn" : level === "ok" ? "ok" : "info", text);
}

const name = (id: string) => getNode(id).name;
const isUp = (id: string) => getNode(id).status === "up";

function send(s: RAState, from: string, to: string, type: "REQUEST" | "REPLY", ts: number) {
  const delay = Math.round(s.latency * rand(0.75, 1.25));
  const msg: RAMsg = { id: nextId(), from, to, type, ts, sentAt: Date.now(), deliverAt: Date.now() + delay };
  s.messages++;
  s.inflight.push(msg);
  setTimeout(() => deliver(s, msg), delay);
}

function deliver(s: RAState, msg: RAMsg) {
  const idx = s.inflight.findIndex((m) => m.id === msg.id);
  if (idx < 0) return; // dropped (node crash)
  s.inflight.splice(idx, 1);
  if (!isUp(msg.to)) return;
  const r = s.nodes[msg.to];
  r.clock = Math.max(r.clock, msg.ts) + 1;
  if (msg.type === "REQUEST") {
    const mineFirst =
      r.state === "WANTED" && r.reqTs !== null && (r.reqTs < msg.ts || (r.reqTs === msg.ts && r.id < msg.from));
    if (r.state === "HELD" || mineFirst) {
      r.deferred.push(msg.from);
      note(s, `${name(r.id)} DEFERS reply to ${name(msg.from)} (${r.state === "HELD" ? "in critical section" : `own request (${r.reqTs},${r.id}) has priority over (${msg.ts},${msg.from})`})`, "warn");
    } else {
      note(s, `${name(r.id)} replies OK to ${name(msg.from)} (${r.state === "WANTED" ? "lower priority" : "not interested"})`);
      r.clock++;
      send(s, r.id, msg.from, "REPLY", r.clock);
    }
  } else {
    if (!r.replies.includes(msg.from)) r.replies.push(msg.from);
    check(s, r.id);
  }
}

function check(s: RAState, id: string) {
  const r = s.nodes[id];
  if (!r || r.state !== "WANTED" || !isUp(id)) return;
  const need = r.peers.filter(isUp);
  if (need.every((p) => r.replies.includes(p))) enter(s, r);
}

function enter(s: RAState, r: RANode) {
  const other = Object.values(s.nodes).find((n) => n.id !== r.id && n.state === "HELD");
  if (other) {
    s.violations++;
    note(s, `SAFETY VIOLATION: ${name(r.id)} and ${name(other.id)} both in CS`, "warn");
  }
  r.state = "HELD";
  r.entries++;
  s.entries++;
  const token = ++r.token;
  s.history.unshift({ id: nextId(), node: r.id, reqTs: r.reqTs ?? 0, waitMs: Date.now() - r.reqAt, enterAt: Date.now(), exitAt: null });
  if (s.history.length > 14) s.history.pop();
  note(s, `${name(r.id)} ENTERS critical section (got ${r.replies.length}/${r.peers.length} replies, waited ${Date.now() - r.reqAt}ms)`, "ok");
  setTimeout(() => release(s, r.id, token), s.csMs);
}

function closeHistory(s: RAState, id: string) {
  const h = s.history.find((x) => x.node === id && x.exitAt === null);
  if (h) h.exitAt = Date.now();
}

function release(s: RAState, id: string, token: number) {
  const r = s.nodes[id];
  if (!r || r.state !== "HELD" || r.token !== token) return;
  r.state = "RELEASED";
  r.reqTs = null;
  r.replies = [];
  r.peers = [];
  closeHistory(s, id);
  note(s, `${name(id)} EXITS critical section${r.deferred.length ? ` and sends ${r.deferred.length} deferred reply(ies)` : ""}`);
  const d = r.deferred;
  r.deferred = [];
  for (const to of d) {
    r.clock++;
    if (isUp(to)) send(s, id, to, "REPLY", r.clock);
  }
}

export function raRequest(id: string) {
  const s = st();
  const n = getNode(id);
  if (n.status !== "up") throw new Error(`${n.name} is down`);
  const r = s.nodes[id];
  if (r.state !== "RELEASED") return false;
  r.state = "WANTED";
  r.clock++;
  r.reqTs = r.clock;
  r.reqAt = Date.now();
  r.replies = [];
  r.deferred = [];
  r.peers = getCluster().nodes.filter((x) => x.id !== id && x.status === "up").map((x) => x.id);
  note(s, `${n.name} wants the critical section → multicasts REQUEST(ts=${r.reqTs}, ${id}) to ${r.peers.length} peer(s)`, "info");
  for (const p of r.peers) send(s, id, p, "REQUEST", r.reqTs);
  check(s, id);
  return true;
}

export function raStress() {
  const s = st();
  const ids = getCluster().nodes.filter((n) => n.status === "up" && s.nodes[n.id].state === "RELEASED").map((n) => n.id);
  note(s, `Stress test: ${ids.length} nodes request the critical section simultaneously`, "warn");
  ids.forEach((id, i) => setTimeout(() => { try { raRequest(id); } catch { /* node may have failed */ } }, i * 60));
}

export function raConfig(latency: number, csMs: number) {
  const s = st();
  s.latency = Math.max(100, Math.min(3000, latency));
  s.csMs = Math.max(500, Math.min(10000, csMs));
}

export function raReset() {
  const s = st();
  for (const n of Object.values(s.nodes)) n.token++;
  s.nodes = {};
  s.inflight = [];
  s.log = [];
  s.entries = 0;
  s.messages = 0;
  s.violations = 0;
  s.history = [];
  st();
  note(s, "Ricart–Agrawala state reset");
}

export function raView() {
  const s = st();
  return {
    latency: s.latency,
    csMs: s.csMs,
    entries: s.entries,
    messages: s.messages,
    violations: s.violations,
    inflight: s.inflight,
    log: s.log.slice(-40).reverse(),
    history: s.history,
    nodes: Object.values(s.nodes).map((n) => ({
      id: n.id,
      state: n.state,
      clock: n.clock,
      reqTs: n.reqTs,
      replies: n.replies,
      peers: n.peers,
      deferred: n.deferred,
      entries: n.entries,
    })),
  };
}
