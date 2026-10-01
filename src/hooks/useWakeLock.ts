"use client";

import { useEffect, useState } from "react";

/** Keeps the screen on while `enabled` (Android Chrome stops GPS when the screen turns off). */
export function useWakeLock(enabled: boolean): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setActive(false);
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        const l = await navigator.wakeLock.request("screen");
        if (stopped) {
          void l.release();
          return;
        }
        lock = l;
        setActive(true);
        l.addEventListener("release", () => setActive(false));
      } catch {
        setActive(false);
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
      setActive(false);
    };
  }, [enabled]);

  return active;
}
