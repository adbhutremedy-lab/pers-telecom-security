"use client";

import { useCallback, useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Offset between this phone's clock and the database clock, so the 30 second
 * countdown is right even if the phone's time is wrong.
 * Returns a function: serverNow() -> milliseconds (database time).
 * Falls back to the phone clock when the server_time() function is not installed.
 */
export function useServerClock(): () => number {
  const offset = useRef(0);

  useEffect(() => {
    let stop = false;
    const measure = async () => {
      try {
        const t0 = Date.now();
        const { data, error } = await supabaseBrowser().rpc("server_time");
        const t1 = Date.now();
        if (stop || error || typeof data !== "string") return;
        offset.current = Date.parse(data) - (t0 + t1) / 2;
      } catch {
        /* keep the phone clock */
      }
    };
    void measure();
    const id = window.setInterval(measure, 5 * 60 * 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  return useCallback(() => Date.now() + offset.current, []);
}
