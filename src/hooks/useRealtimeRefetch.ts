"use client";

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Calls `refetch` whenever one of the listed tables changes (Supabase Realtime),
 * at most once per `throttleMs`. As a safety net it also refetches every
 * `intervalMs` and whenever the browser tab becomes visible again.
 */
export function useRealtimeRefetch(
  tables: string[],
  refetch: () => void,
  { throttleMs = 700, intervalMs = 15000 }: { throttleMs?: number; intervalMs?: number } = {},
) {
  const fn = useRef(refetch);
  fn.current = refetch;
  const key = tables.join(",");

  useEffect(() => {
    const supabase = supabaseBrowser();
    let timer: number | null = null;
    let last = 0;

    const fire = () => {
      const wait = Math.max(0, throttleMs - (Date.now() - last));
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        last = Date.now();
        fn.current();
      }, wait);
    };

    const channel = supabase.channel(`rt-${key}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, fire);
    }
    channel.subscribe();

    const poll = window.setInterval(() => fn.current(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") fn.current();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [key, throttleMs, intervalMs]);
}
