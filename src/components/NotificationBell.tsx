"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "./ProfileContext";
import { useToast } from "./Toast";
import { fmtAgo } from "@/lib/format";
import { beep } from "@/lib/sound";
import type { AppNotification, NotificationType } from "@/lib/types";
import { useNow } from "@/hooks/useNow";

const KIND: Partial<Record<NotificationType, "success" | "error" | "info" | "warning">> = {
  INCIDENT_REACHED: "info",
  INCIDENT_RESOLVED: "success",
  INCIDENT_EXHAUSTED: "error",
  INCIDENT_CANCELLED: "info",
  TEAM_OFFLINE: "warning",
};

export default function NotificationBell() {
  const profile = useProfile();
  const toast = useToast();
  const now = useNow(30000);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("notifications")
      .select("id, user_id, type, incident_id, title, body, payload, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (data) setItems(data as AppNotification[]);
  }, []);

  useEffect(() => {
    void load();
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`notif-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const n = payload.new as AppNotification;
          setItems((s) => [n, ...s].slice(0, 25));
          toast.push({ kind: KIND[n.type] ?? "info", title: n.title, body: n.body ?? undefined, ms: n.type === "INCIDENT_EXHAUSTED" ? 15000 : 7000 });
          if (n.type === "INCIDENT_EXHAUSTED" || n.type === "TEAM_OFFLINE") beep("alert");
          else if (n.type === "INCIDENT_REACHED" || n.type === "INCIDENT_RESOLVED") beep("ok");
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile.id, load, toast]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unread = items.filter((i) => !i.read_at).length;

  async function markAllRead() {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (ids.length === 0) return;
    const at = new Date().toISOString();
    setItems((s) => s.map((i) => (i.read_at ? i : { ...i, read_at: at })));
    await supabaseBrowser().from("notifications").update({ read_at: at }).in("id", ids);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:underline">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet</li>}
            {items.map((n) => {
              const inner = (
                <div className={clsx("px-4 py-3", !n.read_at && "bg-blue-50/60")}>
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  {n.body && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-400">{fmtAgo(n.created_at, now)}</p>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.incident_id ? (
                    <Link href={`/incidents/${n.incident_id}`} onClick={() => setOpen(false)} className="block hover:bg-slate-50">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
