import {
  getCluster,
  getNode,
  liveNodes,
  log,
  nextId,
  registerNodeHook,
  type ClusterNode,
} from "./cluster";
import { singleton, randInt } from "./util";

export type Algo = "round-robin" | "weighted" | "least-connections" | "random";

export interface Task {
  id: number;
  cost: number;
  node: string;
  status: "queued" | "running" | "done";
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  retries: number;
}

interface Balancer {
  algo: Algo;
  pointer: number; // index of the node chosen last by RR
  cw: Record<string, number>; // smooth-WRR current weights
  tasks: Task[];
  assigned: Record<string, number>;
  processed: Record<string, number>;
  timer: ReturnType<typeof setInterval> | null;
}

function state(): Balancer {
  return singleton("__dc_balancer", () => ({
    algo: "round-robin" as Algo,
    pointer: -1,
    cw: {},
    tasks: [],
    assigned: {},
    processed: {},
    timer: null,
  }));
}

/** Classic Round Robin: walk the ring, skipping failed nodes. */
export function rrNext(): ClusterNode | null {
  const b = state();
  const nodes = getCluster().nodes;
  for (let i = 1; i <= nodes.length; i++) {
    const idx = (b.pointer + i) % nodes.length;
    if (nodes[idx].status === "up") {
      b.pointer = idx;
      return nodes[idx];
    }
  }
  return null;
}

function pick(): ClusterNode | null {
  const b = state();
  const ups = liveNodes();
  if (ups.length === 0) return null;
  switch (b.algo) {
    case "round-robin":
      return rrNext();
    case "weighted": {
      // smooth weighted round robin (nginx)
      const total = ups.reduce((s, n) => s + n.weight, 0);
      let best: ClusterNode | null = null;
      for (const n of ups) {
        b.cw[n.id] = (b.cw[n.id] ?? 0) + n.weight;
        if (!best || b.cw[n.id] > b.cw[best.id]) best = n;
      }
      if (best) b.cw[best.id] -= total;
      return best;
    }
    case "least-connections": {
      const load = (n: ClusterNode) =>
        b.tasks.filter((t) => t.node === n.id && t.status !== "done").length;
      return [...ups].sort((x, y) => load(x) - load(y))[0];
    }
    default:
      return ups[randInt(0, ups.length - 1)];
  }
}

export function ensureBalancer() {
  const b = state();
  if (b.timer) return;
  b.timer = setInterval(tick, 120);
  b.timer.unref?.();
  registerNodeHook("balancer", (n) => {
    if (n.status !== "down") return;
    const moved = b.tasks.filter((t) => t.node === n.id && t.status !== "done");
    for (const t of moved) {
      const target = pick();
      if (!target) continue;
      t.node = target.id;
      t.status = "queued";
      t.startedAt = undefined;
      t.retries++;
      b.assigned[target.id] = (b.assigned[target.id] ?? 0) + 1;
    }
    if (moved.length)
      log("balancer", "warn", `${n.name} failed — ${moved.length} in-flight task(s) rescheduled round-robin`);
  });
}

function tick() {
  const b = state();
  const now = Date.now();
  for (const n of getCluster().nodes) {
    if (n.status !== "up") continue;
    const mine = b.tasks.filter((t) => t.node === n.id);
    const running = mine.find((t) => t.status === "running");
    if (running && now - (running.startedAt ?? now) >= running.cost) {
      running.status = "done";
      running.endedAt = now;
      b.processed[n.id] = (b.processed[n.id] ?? 0) + 1;
    }
    if (!mine.some((t) => t.status === "running")) {
      const next = mine.find((t) => t.status === "queued");
      if (next) {
        next.status = "running";
        next.startedAt = now;
      }
    }
  }
  const done = b.tasks.filter((t) => t.status === "done");
  if (done.length > 60) {
    const drop = new Set(done.slice(0, done.length - 60).map((t) => t.id));
    b.tasks = b.tasks.filter((t) => !drop.has(t.id));
  }
}

export function submitTasks(count: number, minCost: number, maxCost: number) {
  ensureBalancer();
  const b = state();
  const out: Task[] = [];
  for (let i = 0; i < Math.min(count, 60); i++) {
    const node = pick();
    if (!node) throw new Error("no live nodes available");
    const t: Task = {
      id: nextId(),
      cost: randInt(minCost, Math.max(minCost, maxCost)),
      node: node.id,
      status: "queued",
      createdAt: Date.now(),
      retries: 0,
    };
    b.tasks.push(t);
    b.assigned[node.id] = (b.assigned[node.id] ?? 0) + 1;
    out.push(t);
  }
  log("balancer", "info", `${out.length} task(s) dispatched using ${b.algo}: ${summarize(out)}`);
  return out;
}

function summarize(tasks: Task[]) {
  const m: Record<string, number> = {};
  for (const t of tasks) m[getNode(t.node).name] = (m[getNode(t.node).name] ?? 0) + 1;
  return Object.entries(m)
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
}

export function setAlgo(algo: Algo) {
  const b = state();
  b.algo = algo;
  b.cw = {};
  log("balancer", "info", `Load-balancing policy → ${algo}`);
}

export function setWeight(id: string, weight: number) {
  getNode(id).weight = Math.max(1, Math.min(9, Math.round(weight)));
}

export function resetBalancer() {
  const b = state();
  b.tasks = [];
  b.assigned = {};
  b.processed = {};
  b.cw = {};
  b.pointer = -1;
  log("balancer", "info", "Balancer counters reset");
}

export function balancerView() {
  const b = state();
  const nodes = getCluster().nodes;
  let nextIndex = -1;
  for (let i = 1; i <= nodes.length; i++) {
    const idx = (b.pointer + i) % nodes.length;
    if (nodes[idx].status === "up") {
      nextIndex = idx;
      break;
    }
  }
  return {
    algo: b.algo,
    pointer: b.pointer,
    nextIndex,
    assigned: b.assigned,
    processed: b.processed,
    load: Object.fromEntries(
      nodes.map((n) => [
        n.id,
        {
          queued: b.tasks.filter((t) => t.node === n.id && t.status === "queued").length,
          running: b.tasks.filter((t) => t.node === n.id && t.status === "running").length,
        },
      ]),
    ),
    tasks: b.tasks.slice(-30).reverse(),
  };
}
