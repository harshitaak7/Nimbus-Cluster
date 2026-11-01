"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Btn, Card, Empty, EventLog, Field, PageHeader, Stat, inputCls } from "@/components/ui";
import { useCluster } from "@/components/cluster-provider";
import { fmtBytes, nodeColor } from "@/lib/format";

interface FileRow {
  id: number;
  name: string;
  size: number;
  checksum: string;
  version: number;
  primaryNode: string;
  replicas: string[];
  targetReplicas: number;
  downloads: number;
}

export default function FilesPage() {
  const { snap, toast, refresh, nodeName } = useCluster();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [copies, setCopies] = useState(3);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("notes.txt");
  const [content, setContent] = useState("Distributed systems are fun.\nReplication keeps our data alive.\nEvery node holds a copy.\n");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/files", { cache: "no-store" });
      if (!r.ok) throw new Error(`File store unavailable (${r.status})`);
      setFiles((await r.json()) as FileRow[]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "File store unavailable", "error");
    }
  }, [toast]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(load, 2000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  async function upload(list: FileList | File[]) {
    setBusy(true);
    for (const f of Array.from(list)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("copies", String(copies));
      const r = await fetch("/api/files", { method: "POST", body: fd });
      const j = (await r.json()) as { ok: boolean; error?: string };
      toast(j.ok ? `${f.name} uploaded & replicated` : j.error ?? "upload failed", j.ok ? "ok" : "error");
    }
    setBusy(false);
    await load();
    void refresh();
  }

  async function createText() {
    setBusy(true);
    const r = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, copies }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string };
    toast(j.ok ? `${name} created & replicated` : j.error ?? "failed", j.ok ? "ok" : "error");
    setBusy(false);
    await load();
    void refresh();
  }

  async function repair() {
    const r = await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "repair" }) });
    const j = (await r.json()) as { repaired: number };
    toast(j.repaired ? `${j.repaired} file(s) re-replicated onto healthy nodes` : "All files are fully replicated", j.repaired ? "ok" : "info");
    await load();
    void refresh();
  }

  async function del(id: number) {
    await fetch(`/api/files/${id}`, { method: "DELETE" });
    await load();
  }

  async function download(f: FileRow) {
    const r = await fetch(`/api/files/${f.id}`);
    if (!r.ok) {
      toast(((await r.json()) as { error: string }).error, "error");
      return;
    }
    const served = r.headers.get("X-Served-By");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
    toast(`${f.name} downloaded from ${served} (round robin over live replicas)`, "ok");
    await load();
    void refresh();
  }

  const nodes = snap?.nodes ?? [];
  const total = files.reduce((s, f) => s + f.size, 0);
  const under = files.filter((f) => f.replicas.filter((r) => nodes.find((n) => n.id === r)?.status === "up").length < f.targetReplicas).length;

  return (
    <>
      <PageHeader
        icon="▤"
        eyebrow="Distributed storage"
        title="File sharing & replication"
        desc="Uploaded files are stored in PostgreSQL and streamed to replica nodes as 48 KB chunks over real TCP connections. The primary is picked by Round Robin, downloads rotate between live replicas, and when a node crashes you can re-replicate onto healthy ones."
        chips={["chunked TCP transfer", "SHA-256 checksums", "replication factor", "round-robin reads", "failover & repair"]}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Files" value={files.length} tone="text-teal-300" />
        <Stat label="Logical size" value={fmtBytes(total)} />
        <Stat label="Replica copies" value={files.reduce((s, f) => s + f.replicas.length, 0)} tone="text-sky-300" />
        <Stat label="Under-replicated" value={under} tone={under ? "text-amber-300" : "text-emerald-300"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Upload">
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}
              onClick={() => input.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${drag ? "border-teal-400 bg-teal-400/10" : "border-white/15 hover:border-white/30"}`}
            >
              <div className="text-2xl">⇪</div>
              <div className="mt-1 text-sm text-slate-200">{busy ? "Replicating…" : "Drop files or click to browse"}</div>
              <div className="text-xs text-slate-500">up to 1.5 MB each</div>
              <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
            </div>
            <Field label={`Replication factor: ${copies}`} className="mt-4">
              <input type="range" min={1} max={5} value={copies} onChange={(e) => setCopies(Number(e.target.value))} className="w-full accent-teal-400" />
            </Field>
          </Card>
          <Card title="Create a text file">
            <Field label="Filename"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Content" className="mt-2"><textarea className={`${inputCls} h-28 font-mono text-xs`} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
            <Btn variant="primary" className="mt-3 w-full" disabled={busy || !name.trim()} onClick={createText}>Store & replicate</Btn>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Shared files"
            subtitle="Replica chips are colored by node; greyed chips are offline"
            right={<Btn size="sm" variant="warn" onClick={repair}>⟳ Repair replicas</Btn>}
          >
            {files.length === 0 ? <Empty>No files yet — upload something to see it replicated across the cluster.</Empty> : (
              <div className="space-y-2">
                {files.map((f) => {
                  const live = f.replicas.filter((r) => nodes.find((n) => n.id === r)?.status === "up");
                  return (
                    <div key={f.id} className="slide-in rounded-xl border border-white/5 bg-black/25 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{f.name}</div>
                          <div className="font-mono text-[10.5px] text-slate-500">
                            {fmtBytes(f.size)} · v{f.version} · sha256:{f.checksum.slice(0, 12)}… · {f.downloads} downloads
                          </div>
                        </div>
                        <div className="flex gap-1.5">
                          <Btn size="sm" variant="success" onClick={() => download(f)}>Download</Btn>
                          <Link href={`/mapreduce?file=${f.id}`}><Btn size="sm">→ MapReduce</Btn></Link>
                          <Btn size="sm" variant="danger" onClick={() => del(f.id)}>Delete</Btn>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {f.replicas.map((r) => {
                          const up = nodes.find((n) => n.id === r)?.status === "up";
                          return (
                            <span key={r} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]" style={{ borderColor: up ? nodeColor(r) + "88" : "#334155", color: up ? nodeColor(r) : "#64748b", opacity: up ? 1 : 0.6 }}>
                              {r === f.primaryNode ? "★ " : ""}{nodeName(r)}
                            </span>
                          );
                        })}
                        <Badge tone={live.length >= f.targetReplicas ? "green" : live.length ? "amber" : "red"}>{live.length}/{f.targetReplicas} live</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Per-node storage">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {nodes.map((n) => {
                const mine = files.filter((f) => f.replicas.includes(n.id));
                return (
                  <div key={n.id} className={`rounded-xl border border-white/5 bg-black/25 p-3 ${n.status === "down" ? "opacity-50" : ""}`}>
                    <div className="flex items-center justify-between text-xs font-semibold" style={{ color: nodeColor(n.id) }}>
                      {n.name} <span className="text-[10px] text-slate-500">{n.status}</span>
                    </div>
                    <div className="mt-1 font-mono text-lg text-white">{mine.length}</div>
                    <div className="text-[10.5px] text-slate-500">{fmtBytes(mine.reduce((s, f) => s + f.size, 0))}</div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Transfer log"><EventLog kinds={["file"]} max={12} height="max-h-56" /></Card>
        </div>
      </div>
    </>
  );
}
