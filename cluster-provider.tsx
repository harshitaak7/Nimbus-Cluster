"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ActionResult, Snapshot } from "@/lib/engine/actions";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error" | "info";
}

interface Ctx {
  snap: Snapshot | null;
  receivedAt: number;
  online: boolean;
  act: (action: string, payload?: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<ActionResult>;
  refresh: () => Promise<void>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  nodeName: (id: string) => string;
  serverNow: () => number;
}

const ClusterCtx = createContext<Ctx | null>(null);

export function useCluster(): Ctx {
  const c = useContext(ClusterCtx);
  if (!c) throw new Error("useCluster outside provider");
  return c;
}

/** Re-render the component every `ms` milliseconds (for live clocks/animations). */
export function useTicker(ms = 100) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function ClusterProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const snapRef = useRef<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/dc", { cache: "no-store" });
      const j = (await r.json()) as Snapshot;
      snapRef.current = j;
      setSnap(j);
      setReceivedAt(Date.now());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (alive) t = setTimeout(loop, 600);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [refresh]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const act = useCallback<Ctx["act"]>(
    async (action, payload = {}, opts) => {
      try {
        const r = await fetch("/api/dc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload }),
        });
        const j = (await r.json()) as ActionResult;
        if (!j.ok && j.error && !opts?.silent) toast(j.error, "error");
        void refresh();
        return j;
      } catch {
        toast("Network error talking to the cluster", "error");
        return { ok: false, error: "network" };
      }
    },
    [refresh, toast],
  );

  const value = useMemo<Ctx>(
    () => ({
      snap,
      receivedAt,
      online,
      act,
      refresh,
      toast,
      nodeName: (id) => snapRef.current?.nodes.find((n) => n.id === id)?.name ?? id,
      serverNow: () => (snapRef.current ? snapRef.current.serverTime + (Date.now() - receivedAt) : Date.now()),
    }),
    [snap, receivedAt, online, act, refresh, toast],
  );

  return (
    <ClusterCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`slide-in pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
              t.tone === "error"
                ? "border-rose-500/40 bg-rose-950/80 text-rose-100"
                : t.tone === "ok"
                  ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-100"
                  : "border-sky-500/40 bg-sky-950/80 text-sky-100"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ClusterCtx.Provider>
  );
}
