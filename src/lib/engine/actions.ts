import {
  ensureCluster,
  getCluster,
  getNode,
  log,
  nodeViews,
  sendTcpMessage,
  setNodeStatus,
  udpBroadcast,
  udpNotify,
  TOPICS,
} from "./cluster";
import {
  balancerView,
  ensureBalancer,
  resetBalancer,
  setAlgo,
  setWeight,
  submitTasks,
  type Algo,
} from "./balancer";
import { berkeleyView, randomizeClocks, runBerkeley, setOffset } from "./berkeley";
import { ensureMutex, raConfig, raRequest, raReset, raStress, raView } from "./mutex";
import {
  dlAdd,
  dlAuto,
  dlDetect,
  dlPreset,
  dlRelease,
  dlRequest,
  dlRestart,
  dlResolve,
  dlView,
} from "./deadlock";
import { errMsg, num, str, bool, type Payload } from "./util";

async function boot() {
  const c = await ensureCluster();
  ensureBalancer();
  ensureMutex();
  return c;
}

export async function snapshot() {
  const c = await boot();
  return {
    serverTime: Date.now(),
    nodes: nodeViews(),
    stats: c.stats,
    topics: [...TOPICS],
    udpLoss: c.udpLoss,
    events: c.events.slice(-150),
    tcpFeed: c.tcpFeed.slice(-30).reverse(),
    udpFeed: c.udpFeed.slice(-40).reverse(),
    balancer: balancerView(),
    berkeley: berkeleyView(),
    mutex: raView(),
    deadlock: dlView(),
  };
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export type ActionResult = { ok: boolean; data?: unknown; error?: string };

export async function performAction(action: string, p: Payload): Promise<ActionResult> {
  await boot();
  const c = getCluster();
  try {
    switch (action) {
      /* ---- cluster ---- */
      case "node.fail":
        setNodeStatus(str(p, "node"), "down");
        return { ok: true };
      case "node.recover":
        setNodeStatus(str(p, "node"), "up");
        return { ok: true };

      /* ---- TCP / UDP ---- */
      case "tcp.send": {
        const r = await sendTcpMessage(str(p, "from"), str(p, "to"), str(p, "body", "hello"));
        return { ok: r.status === "acked", data: r, error: r.status === "acked" ? undefined : r.detail };
      }
      case "udp.notify": {
        const topic = str(p, "topic", "alerts");
        const to = str(p, "to", "*");
        const body = str(p, "body", "ping");
        const items =
          to === "*"
            ? udpBroadcast(str(p, "from"), topic, body)
            : [udpNotify(str(p, "from"), to, topic, body)];
        return { ok: true, data: items.length };
      }
      case "udp.loss":
        c.udpLoss = Math.max(0, Math.min(0.95, num(p, "loss")));
        log("udp", "info", `Simulated packet loss set to ${Math.round(c.udpLoss * 100)}%`);
        return { ok: true };
      case "udp.subscribe": {
        const n = getNode(str(p, "node"));
        const topic = str(p, "topic");
        n.subscriptions = n.subscriptions.includes(topic)
          ? n.subscriptions.filter((t) => t !== topic)
          : [...n.subscriptions, topic];
        return { ok: true };
      }

      /* ---- balancer ---- */
      case "lb.algo":
        setAlgo(str(p, "algo") as Algo);
        return { ok: true };
      case "lb.submit":
        return { ok: true, data: submitTasks(num(p, "count", 10), num(p, "min", 400), num(p, "max", 1200)).length };
      case "lb.weight":
        setWeight(str(p, "node"), num(p, "weight", 1));
        return { ok: true };
      case "lb.reset":
        resetBalancer();
        return { ok: true };

      /* ---- clocks ---- */
      case "clock.berkeley": {
        const run = await runBerkeley(str(p, "master", "node-1"), num(p, "threshold", 3000));
        return { ok: true, data: run };
      }
      case "clock.randomize":
        randomizeClocks(num(p, "max", 6000));
        return { ok: true };
      case "clock.set":
        setOffset(str(p, "node"), num(p, "offset"));
        return { ok: true };

      /* ---- mutual exclusion ---- */
      case "ra.request":
        return { ok: raRequest(str(p, "node")) };
      case "ra.stress":
        raStress();
        return { ok: true };
      case "ra.config":
        raConfig(num(p, "latency", 900), num(p, "cs", 2600));
        return { ok: true };
      case "ra.reset":
        raReset();
        return { ok: true };

      /* ---- deadlock ---- */
      case "dl.request":
        dlRequest(str(p, "pid"), str(p, "rid"));
        return { ok: true };
      case "dl.release":
        dlRelease(str(p, "pid"), str(p, "rid"));
        return { ok: true };
      case "dl.detect":
        return { ok: true, data: dlDetect() };
      case "dl.resolve":
        return { ok: true, data: dlResolve(str(p, "strategy", "youngest")) };
      case "dl.restart":
        dlRestart(str(p, "pid"));
        return { ok: true };
      case "dl.preset":
        dlPreset(str(p, "name"));
        return { ok: true };
      case "dl.add":
        dlAdd(str(p, "kind") === "resource" ? "resource" : "process");
        return { ok: true };
      case "dl.auto":
        dlAuto(bool(p, "on", true));
        return { ok: true };

      default:
        return { ok: false, error: `unknown action '${action}'` };
    }
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
