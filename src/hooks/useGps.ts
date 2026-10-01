"use client";

import { useEffect, useRef, useState } from "react";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  speedKmh: number | null;
  heading: number | null;
  ts: number;
}

export type GpsError = "denied" | "unavailable" | "timeout" | "unsupported" | null;

/** Follows the phone's GPS while `enabled`. `fixRef` always holds the newest reading; `fix` updates at most once a second. */
export function useGps(enabled: boolean) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<GpsError>(null);
  const fixRef = useRef<Fix | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("unsupported");
      return;
    }
    let lastSet = 0;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const f: Fix = {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          speedKmh: c.speed != null && !Number.isNaN(c.speed) ? Math.max(0, c.speed * 3.6) : null,
          heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : null,
          ts: Date.now(),
        };
        fixRef.current = f;
        setError(null);
        if (f.ts - lastSet > 1000) {
          lastSet = f.ts;
          setFix(f);
        }
      },
      (err) => setError(err.code === 1 ? "denied" : err.code === 2 ? "unavailable" : "timeout"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { fix, fixRef, error };
}
