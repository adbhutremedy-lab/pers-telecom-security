"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import clsx from "clsx";

type Kind = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}
interface ToastApi {
  push: (t: { kind?: Kind; title: string; body?: string; ms?: number }) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONE: Record<Kind, string> = {
  success: "border-green-300 bg-green-50 text-green-900",
  error: "border-red-300 bg-red-50 text-red-900",
  info: "border-blue-300 bg-blue-50 text-blue-900",
  warning: "border-yellow-300 bg-yellow-50 text-yellow-900",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const remove = useCallback((id: number) => setItems((s) => s.filter((x) => x.id !== id)), []);

  const push = useCallback<ToastApi["push"]>(
    ({ kind = "info", title, body, ms = 6000 }) => {
      const id = ++seq.current;
      setItems((s) => [...s.slice(-4), { id, kind, title, body }]);
      window.setTimeout(() => remove(id), ms);
    },
    [remove],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div key={t.id} role="status" className={clsx("pointer-events-auto flex gap-3 rounded-xl border p-3 shadow-lg", TONE[t.kind])}>
              <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 whitespace-pre-line text-sm opacity-90">{t.body}</p>}
              </div>
              <button onClick={() => remove(t.id)} aria-label="Dismiss" className="h-6 w-6 shrink-0 rounded hover:bg-black/5">
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}
