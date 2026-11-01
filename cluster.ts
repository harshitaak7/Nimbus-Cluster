import net from "node:net";
import dgram from "node:dgram";
import { singleton, sleep, rand, errMsg } from "./util";

/* ------------------------------------------------------------------ types */

export type EventKind =
  | "system"
  | "tcp"
  | "udp"
  | "file"
  | "balancer"
  | "berkeley"
  | "mutex"
  | "deadlock"
  | "mapreduce";

export type Level = "info" | "ok" | "warn" | "error";

export interface LogEvent {
  id: number;
  ts: number;
  kind: EventKind;
  level: Level;
  text: string;
}

export interface ClusterNode {
  id: string;
  name: string;
  status: "up" | "down";
  tcpPort: number;
  udpPort: number;
  clockOffset: number; // ms relative to true time
  drift: number; // ms gained per second
  weight: number;
  subscriptions: string[];
  startedAt: number;
}

export interface InboxMsg {
  id: number;
  from: string;
  body: string;
  ts: number; // receiver's local clock
}

export interface TcpFeedItem {
  id: number;
  ts: number;
  from: string;
  to: string;
  body: string;
  bytes: number;
  rtt: number;
  status: "acked" | "failed";
  detail: string;
}

export interface UdpFeedItem {
  id: number;
  ts: number;
  from: string;
  to: string;
  topic: string;
  body: string;
  bytes: number;
  status: "sent" | "delivered" | "ignored" | "dropped" | "lost";
}

export interface Stats {
  tcpMessages: number;
  tcpBytes: number;
  tcpFailures: number;
  udpSent: number;
  udpDelivered: number;
  udpDropped: number;
  heartbeats: number;
  filesServed: number;
  filesStored: number;
}

export const TOPICS = ["alerts", "deploy", "metrics", "chat"] as const;

export interface Cluster {
  nodes: ClusterNode[];
  inbox: Record<string, InboxMsg[]>;
  notifs: Record<string, UdpFeedItem[]>;
  events: LogEvent[];
  tcpFeed: TcpFeedItem[];
  udpFeed: UdpFeedItem[];
  stats: Stats;
  udpLoss: number;
  lastSeen: Record<string, number>;
  seq: number;
  servers: Map<string, net.Server>;
  sockets: Map<string, dgram.Socket>;
}

export type TcpMessage = { from: string; type: string; [k: string]: unknown };
type Handler = (node: ClusterNode, msg: TcpMessage) => unknown | Promise<unknown>;

/* --------------------------------------------------------------- registry */

const handlers = singleton("__dc_handlers", () => new Map<string, Handler>());
const hooks = singleton(
  "__dc_hooks",
  () => new Map<string, (node: ClusterNode) => void>(),
);

export function registerHandler(type: string, fn: Handler) {
  handlers.set(type, fn);
}

/** Called whenever a node goes up or down. */
export function registerNodeHook(key: string, fn: (node: ClusterNode) => void) {
  hooks.set(key, fn);
}

/* -------------------------------------------------------------- bootstrap */

const NODE_DEFS = [
  { id: "node-1", name: "Alpha", weight: 3, drift: 11, subs: ["alerts", "deploy", "metrics"] },
  { id: "node-2", name: "Bravo", weight: 2, drift: -7, subs: ["alerts", "chat"] },
  { id: "node-3", name: "Charlie", weight: 2, drift: 19, subs: ["alerts", "deploy"] },
  { id: "node-4", name: "Delta", weight: 1, drift: -14, subs: ["alerts", "metrics", "chat"] },
  { id: "node-5", name: "Echo", weight: 1, drift: 5, subs: ["alerts", "chat", "deploy"] },
];

export function getCluster(): Cluster {
  const c = (globalThis as unknown as { __dc_cluster?: Cluster }).__dc_cluster;
  if (!c) throw new Error("cluster not started");
  return c;
}

export function ensureCluster(): Promise<Cluster> {
  return singleton("__dc_ready", () => bootstrap());
}

async function bootstrap(): Promise<Cluster> {
  const now = Date.now();
  const nodes: ClusterNode[] = NODE_DEFS.map((d, i) => ({
    id: d.id,
    name: d.name,
    status: "up",
    tcpPort: 0,
    udpPort: 0,
    clockOffset: [0, 1840, -2650, 4210, -980][i],
    drift: d.drift,
    weight: d.weight,
    subscriptions: [...d.subs],
    startedAt: now,
  }));
  const c: Cluster = {
    nodes,
    inbox: {},
    notifs: {},
    events: [],
    tcpFeed: [],
    udpFeed: [],
    stats: {
      tcpMessages: 0,
      tcpBytes: 0,
      tcpFailures: 0,
      udpSent: 0,
      udpDelivered: 0,
      udpDropped: 0,
      heartbeats: 0,
      filesServed: 0,
      filesStored: 0,
    },
    udpLoss: 0.1,
    lastSeen: {},
    seq: 1,
    servers: new Map(),
    sockets: new Map(),
  };
  for (const n of nodes) {
    c.inbox[n.id] = [];
    c.notifs[n.id] = [];
    c.lastSeen[n.id] = now;
  }
  (globalThis as unknown as { __dc_cluster?: Cluster }).__dc_cluster = c;

  await Promise.all(nodes.map((n) => startNode(c, n)));

  // clock drift: every node's oscillator runs slightly fast or slow
  setInterval(() => {
    for (const n of c.nodes) n.clockOffset += n.drift;
  }, 1000).unref?.();

  // UDP heartbeats between all live nodes
  setInterval(() => {
    for (const from of c.nodes) {
      if (from.status !== "up") continue;
      const sock = c.sockets.get(from.id);
      if (!sock) continue;
      const data = Buffer.from(JSON.stringify({ type: "heartbeat", from: from.id }));
      for (const to of c.nodes) {
        if (to.id === from.id || !to.udpPort) continue;
        sock.send(data, to.udpPort, "127.0.0.1", () => undefined);
      }
    }
  }, 2000).unref?.();

  log(
    "system",
    "ok",
    `Cluster online: ${nodes.map((n) => `${n.name}(tcp:${n.tcpPort}/udp:${n.udpPort})`).join(", ")}`,
  );
  return c;
}

function startNode(c: Cluster, node: ClusterNode): Promise<void> {
  const tcp = new Promise<void>((resolve) => {
    const server = net.createServer((sock) => {
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("error", () => undefined);
      sock.on("data", (d: string) => {
        buf += d;
        let i = buf.indexOf("\n");
        while (i >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          void handleLine(node, line).then((out) => {
            if (!sock.destroyed) sock.write(out + "\n");
          });
          i = buf.indexOf("\n");
        }
      });
    });
    server.on("error", () => resolve());
    server.listen(0, "127.0.0.1", () => {
      node.tcpPort = (server.address() as net.AddressInfo).port;
      resolve();
    });
    c.servers.set(node.id, server);
  });

  const udp = new Promise<void>((resolve) => {
    const sock = dgram.createSocket("udp4");
    sock.on("error", () => resolve());
    sock.on("message", (buf) => onDatagram(c, node, buf));
    sock.bind(0, "127.0.0.1", () => {
      node.udpPort = sock.address().port;
      resolve();
    });
    c.sockets.set(node.id, sock);
  });

  return Promise.all([tcp, udp]).then(() => undefined);
}

/* ------------------------------------------------------------------- misc */

export function log(kind: EventKind, level: Level, text: string) {
  const c = (globalThis as unknown as { __dc_cluster?: Cluster }).__dc_cluster;
  if (!c) return;
  c.events.push({ id: c.seq++, ts: Date.now(), kind, level, text });
  if (c.events.length > 300) c.events.splice(0, c.events.length - 300);
}

export function nextId(): number {
  return getCluster().seq++;
}

export function getNode(id: string): ClusterNode {
  const n = getCluster().nodes.find((x) => x.id === id);
  if (!n) throw new Error(`unknown node ${id}`);
  return n;
}

export function liveNodes(): ClusterNode[] {
  return getCluster().nodes.filter((n) => n.status === "up");
}

export function nodeNow(n: ClusterNode): number {
  return Date.now() + n.clockOffset;
}

export function setNodeStatus(id: string, status: "up" | "down") {
  const n = getNode(id);
  if (n.status === status) return;
  n.status = status;
  if (status === "up") getCluster().lastSeen[id] = Date.now();
  log("system", status === "up" ? "ok" : "warn", `${n.name} ${status === "up" ? "recovered and rejoined the cluster" : "FAILED (crash simulated)"}`);
  for (const h of hooks.values()) h(n);
}

/* -------------------------------------------------------------------- TCP */

async function handleLine(node: ClusterNode, line: string): Promise<string> {
  try {
    const msg = JSON.parse(line) as TcpMessage;
    return JSON.stringify(await dispatch(node, msg));
  } catch (e) {
    return JSON.stringify({ error: errMsg(e) });
  }
}

async function dispatch(node: ClusterNode, msg: TcpMessage) {
  if (node.status === "down") return { error: `${node.name} is down` };
  const h = handlers.get(msg.type);
  if (!h) return { error: `no handler for '${msg.type}'` };
  try {
    return { ok: true, data: await h(node, msg) };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

export interface TcpResult<T = unknown> {
  reply: T;
  rtt: number;
  bytes: number;
}

/** One real TCP round-trip (newline-delimited JSON) between two nodes. */
export async function tcpRequest<T = Record<string, unknown>>(
  fromId: string,
  toId: string,
  payload: { type: string; [k: string]: unknown },
): Promise<TcpResult<T>> {
  const c = getCluster();
  const from = getNode(fromId);
  const to = getNode(toId);
  if (from.status === "down") throw new Error(`${from.name} is down and cannot send`);
  if (to.status === "down") {
    c.stats.tcpFailures++;
    throw new Error(`connect ECONNREFUSED 127.0.0.1:${to.tcpPort} — ${to.name} is down`);
  }
  const t0 = performance.now();
  await sleep(rand(12, 55)); // simulated link latency
  const line = JSON.stringify({ from: fromId, ...payload });

  let raw: string;
  if (!to.tcpPort) {
    raw = JSON.stringify(await dispatch(to, { from: fromId, ...payload }));
  } else {
    raw = await new Promise<string>((resolve, reject) => {
      const sock = net.connect({ port: to.tcpPort, host: "127.0.0.1" });
      let buf = "";
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("TCP timeout after 4s"));
      }, 4000);
      sock.setEncoding("utf8");
      sock.on("connect", () => sock.write(line + "\n"));
      sock.on("data", (d: string) => {
        buf += d;
        const i = buf.indexOf("\n");
        if (i >= 0) {
          clearTimeout(timer);
          sock.end();
          resolve(buf.slice(0, i));
        }
      });
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
  const rtt = Math.round((performance.now() - t0) * 10) / 10;
  const bytes = Buffer.byteLength(line) + Buffer.byteLength(raw);
  const parsed = JSON.parse(raw) as { ok?: boolean; data?: T; error?: string };
  c.stats.tcpMessages++;
  c.stats.tcpBytes += bytes;
  if (parsed.error) {
    c.stats.tcpFailures++;
    throw new Error(parsed.error);
  }
  return { reply: parsed.data as T, rtt, bytes };
}

registerHandler("ping", (node) => ({ pong: node.name, clock: nodeNow(node) }));

registerHandler("msg", (node, msg) => {
  const c = getCluster();
  const box = c.inbox[node.id];
  const m: InboxMsg = {
    id: nextId(),
    from: msg.from,
    body: String(msg.body ?? ""),
    ts: nodeNow(node),
  };
  box.push(m);
  if (box.length > 30) box.shift();
  return { ack: true, receivedBy: node.name, seq: m.id, receiverClock: m.ts };
});

export async function sendTcpMessage(from: string, to: string, body: string) {
  const c = getCluster();
  const item: TcpFeedItem = {
    id: nextId(),
    ts: Date.now(),
    from,
    to,
    body,
    bytes: 0,
    rtt: 0,
    status: "failed",
    detail: "",
  };
  try {
    const r = await tcpRequest<{ receivedBy: string; seq: number }>(from, to, {
      type: "msg",
      body,
    });
    item.status = "acked";
    item.bytes = r.bytes;
    item.rtt = r.rtt;
    item.detail = `ACK seq=${r.reply.seq} from ${r.reply.receivedBy}`;
    log("tcp", "ok", `${getNode(from).name} → ${getNode(to).name} "${body.slice(0, 40)}" acked in ${r.rtt}ms`);
  } catch (e) {
    item.detail = errMsg(e);
    log("tcp", "error", `${getNode(from).name} → ${getNode(to).name} failed: ${errMsg(e)}`);
  }
  c.tcpFeed.push(item);
  if (c.tcpFeed.length > 60) c.tcpFeed.shift();
  return item;
}

/* -------------------------------------------------------------------- UDP */

function onDatagram(c: Cluster, node: ClusterNode, buf: Buffer) {
  let p: { type: string; id?: number; from: string; topic?: string; body?: string };
  try {
    p = JSON.parse(buf.toString("utf8"));
  } catch {
    return;
  }
  if (p.type === "heartbeat") {
    if (node.status === "up") {
      c.lastSeen[p.from] = Date.now();
      c.stats.heartbeats++;
    }
    return;
  }
  const item = c.udpFeed.find((i) => i.id === p.id);
  if (node.status === "down") {
    if (item) item.status = "lost";
    return;
  }
  if (!p.topic || !node.subscriptions.includes(p.topic)) {
    if (item) item.status = "ignored";
    return;
  }
  if (item) {
    item.status = "delivered";
    c.stats.udpDelivered++;
    const box = c.notifs[node.id];
    box.push({ ...item });
    if (box.length > 25) box.shift();
  }
}

/** Fire-and-forget UDP datagram with configurable simulated packet loss. */
export function udpNotify(from: string, to: string, topic: string, body: string) {
  const c = getCluster();
  const src = getNode(from);
  const dst = getNode(to);
  if (src.status === "down") throw new Error(`${src.name} is down`);
  const payload = { type: "notify", id: nextId(), from, topic, body };
  const data = Buffer.from(JSON.stringify(payload));
  const item: UdpFeedItem = {
    id: payload.id,
    ts: Date.now(),
    from,
    to,
    topic,
    body,
    bytes: data.length,
    status: "sent",
  };
  c.udpFeed.push(item);
  if (c.udpFeed.length > 80) c.udpFeed.shift();
  c.stats.udpSent++;
  if (Math.random() < c.udpLoss) {
    item.status = "dropped";
    c.stats.udpDropped++;
    return item;
  }
  const sock = c.sockets.get(from);
  if (!sock || !dst.udpPort) {
    onDatagram(c, dst, data);
  } else {
    sock.send(data, dst.udpPort, "127.0.0.1", () => undefined);
  }
  return item;
}

export function udpBroadcast(from: string, topic: string, body: string) {
  const c = getCluster();
  const items = c.nodes
    .filter((n) => n.id !== from)
    .map((n) => udpNotify(from, n.id, topic, body));
  log("udp", "info", `${getNode(from).name} broadcast [${topic}] "${body.slice(0, 40)}" → ${items.length} datagrams`);
  return items;
}

/* ------------------------------------------------------------------- view */

export function nodeViews() {
  const c = getCluster();
  const now = Date.now();
  return c.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    status: n.status,
    tcpPort: n.tcpPort,
    udpPort: n.udpPort,
    clock: nodeNow(n),
    offset: Math.round(n.clockOffset),
    drift: n.drift,
    weight: n.weight,
    subscriptions: n.subscriptions,
    lastSeenAgo: now - c.lastSeen[n.id],
    inbox: c.inbox[n.id].slice(-8).reverse(),
    notifs: c.notifs[n.id].slice(-8).reverse(),
  }));
}
