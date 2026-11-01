"use client";

import { useState } from "react";
import { Badge, Btn, Card, Empty, EventLog, Field, NodeSelect, NodeTag, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster } from "@/components/cluster-provider";
import { fmtAgo, fmtClock, hhmmss } from "@/lib/format";

const statusTone = { sent: "sky", delivered: "green", ignored: "slate", dropped: "red", lost: "red" } as const;

export default function Messaging() {
  const { snap, act } = useCluster();
  const [from, setFrom] = useState("node-1");
  const [to, setTo] = useState("node-3");
  const [body, setBody] = useState("Hello from the cluster!");
  const [uFrom, setUFrom] = useState("node-2");
  const [uTo, setUTo] = useState("*");
  const [topic, setTopic] = useState("alerts");
  const [uBody, setUBody] = useState("CPU temperature high on rack 4");
  const [busy, setBusy] = useState(false);
  const [inboxNode, setInboxNode] = useState("node-3");
  if (!snap) return null;
  const s = snap.stats;
  const inbox = snap.nodes.find((n) => n.id === inboxNode);

  return (
    <>
      <PageHeader
        icon="⇄"
        eyebrow="Transport layer"
        title="TCP messaging & UDP notifications"
        desc="Every node owns a real TCP server socket and a real UDP socket bound on loopback. TCP messages open a connection, send a framed JSON request and wait for an acknowledgement. UDP notifications are single datagrams — no connection, no ack, and when the simulated network drops one nobody ever knows."
        chips={["net.Socket", "dgram", "ACK / RTT", "pub-sub topics", "packet loss", "UDP heartbeats"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="TCP acked" value={s.tcpMessages} tone="text-sky-300" />
        <Stat label="TCP failures" value={s.tcpFailures} tone={s.tcpFailures ? "text-rose-300" : "text-slate-50"} />
        <Stat label="UDP delivered" value={`${s.udpDelivered}/${s.udpSent}`} tone="text-violet-300" />
        <Stat label="Heartbeats rx" value={s.heartbeats} hint="every 2s per node" tone="text-emerald-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="TCP — reliable messaging" subtitle="Connection-oriented · ordered · acknowledged">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sender"><NodeSelect value={from} onChange={setFrom} /></Field>
            <Field label="Receiver"><NodeSelect value={to} onChange={setTo} /></Field>
          </div>
          <Field label="Message" className="mt-3">
            <input className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="mt-3 flex gap-2">
            <Btn
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act("tcp.send", { from, to, body });
                setBusy(false);
              }}
            >
              {busy ? "Sending…" : "Send over TCP"}
            </Btn>
            <Btn
              onClick={async () => {
                const ids = snap.nodes.filter((n) => n.id !== from).map((n) => n.id);
                await Promise.all(ids.map((t) => act("tcp.send", { from, to: t, body }, { silent: true })));
              }}
            >
              Unicast to all
            </Btn>
          </div>
          <div className="mt-4 max-h-80 space-y-1.5 overflow-y-auto">
            {snap.tcpFeed.length === 0 && <Empty>No TCP traffic yet. Send a message!</Empty>}
            {snap.tcpFeed.map((m) => (
              <div key={m.id} className="slide-in rounded-xl border border-white/5 bg-black/25 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <NodeTag id={m.from} /> <span className="text-slate-500">→</span> <NodeTag id={m.to} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {m.status === "acked" && <Badge tone="slate">{m.rtt} ms</Badge>}
                    <Badge tone={m.status === "acked" ? "green" : "red"}>{m.status === "acked" ? "ACK" : "FAILED"}</Badge>
                  </div>
                </div>
                <div className="mt-1 truncate text-slate-300">“{m.body}”</div>
                <div className={`mt-0.5 font-mono text-[10.5px] ${m.status === "acked" ? "text-slate-500" : "text-rose-400"}`}>
                  {hhmmss(m.ts)} · {m.detail} {m.bytes ? `· ${m.bytes} B on wire` : ""}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="UDP — notifications" subtitle="Connectionless · unordered · unacknowledged">
          <div className="grid grid-cols-3 gap-3">
            <Field label="From"><NodeSelect value={uFrom} onChange={setUFrom} /></Field>
            <Field label="To"><NodeSelect value={uTo} onChange={setUTo} includeAll="Broadcast (all)" /></Field>
            <Field label="Topic">
              <select className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)}>
                {snap.topics.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Payload" className="mt-3">
            <input className={inputCls} value={uBody} onChange={(e) => setUBody(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <Btn variant="primary" onClick={() => act("udp.notify", { from: uFrom, to: uTo, topic, body: uBody })}>
              {uTo === "*" ? "Broadcast datagrams" : "Send datagram"}
            </Btn>
            <div className="min-w-48 flex-1">
              <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-slate-400">
                <span>Simulated packet loss</span>
                <span className="font-mono text-violet-300">{Math.round(snap.udpLoss * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                value={Math.round(snap.udpLoss * 100)}
                onChange={(e) => act("udp.loss", { loss: Number(e.target.value) / 100 }, { silent: true })}
                className="w-full accent-violet-400"
              />
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">Subscriptions (click to toggle)</div>
            <div className="overflow-hidden rounded-xl border border-white/5">
              <table className="w-full text-xs">
                <thead className="bg-white/[0.03] text-slate-500">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Node</th>
                    {snap.topics.map((t) => <th key={t} className="px-2 py-1.5 font-medium">{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {snap.nodes.map((n) => (
                    <tr key={n.id} className="border-t border-white/5">
                      <td className="px-3 py-1.5"><NodeTag id={n.id} /></td>
                      {snap.topics.map((t) => (
                        <td key={t} className="text-center">
                          <button
                            onClick={() => act("udp.subscribe", { node: n.id, topic: t })}
                            className={`h-5 w-5 rounded-md border text-[10px] transition ${
                              n.subscriptions.includes(t) ? "border-violet-400/50 bg-violet-500/30 text-violet-100" : "border-white/10 text-transparent hover:border-white/30"
                            }`}
                          >
                            ✓
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Datagram feed" subtitle="Status is learned from the receiver, never from the sender">
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {snap.udpFeed.length === 0 && <Empty>Broadcast a notification to see datagrams.</Empty>}
            {snap.udpFeed.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/25 px-3 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-1.5">
                  <NodeTag id={u.from} /> <span className="text-slate-600">→</span> <NodeTag id={u.to} />
                  <Badge tone="violet">{u.topic}</Badge>
                  <span className="truncate text-slate-400">{u.body}</span>
                </div>
                <Badge tone={statusTone[u.status]}>{u.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Node inboxes"
          subtitle="What each node's application actually received"
          right={<div className="w-36"><NodeSelect value={inboxNode} onChange={setInboxNode} /></div>}
        >
          {inbox && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-sky-400">TCP messages</div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {inbox.inbox.length === 0 && <div className="text-xs text-slate-500">empty</div>}
                  {inbox.inbox.map((m) => (
                    <div key={m.id} className="rounded-lg bg-black/25 px-2.5 py-1.5 text-xs">
                      <div className="text-slate-200">{m.body}</div>
                      <div className="font-mono text-[10px] text-slate-500">from {snap.nodes.find((n) => n.id === m.from)?.name} · local {fmtClock(m.ts)}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-violet-400">UDP notifications</div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {inbox.notifs.length === 0 && <div className="text-xs text-slate-500">empty</div>}
                  {inbox.notifs.map((m) => (
                    <div key={m.id} className="rounded-lg bg-black/25 px-2.5 py-1.5 text-xs">
                      <div className="text-slate-200"><Badge tone="violet">{m.topic}</Badge> {m.body}</div>
                      <div className="font-mono text-[10px] text-slate-500">from {snap.nodes.find((n) => n.id === m.from)?.name} · {hhmmss(m.ts)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="mt-3 border-t border-white/5 pt-3">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-slate-400">Failure detector (UDP heartbeats)</div>
            <div className="flex flex-wrap gap-2">
              {snap.nodes.map((n) => (
                <Badge key={n.id} tone={n.status === "up" && n.lastSeenAgo < 5000 ? "green" : "red"}>
                  {n.name}: {n.status === "up" ? fmtAgo(n.lastSeenAgo) : "missed"}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Transport log">
          <EventLog kinds={["tcp", "udp"]} max={20} />
        </Card>
      </div>
    </>
  );
}
