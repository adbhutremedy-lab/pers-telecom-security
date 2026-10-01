"use client";

import { useEffect, useState } from "react";

/** A clock that re-renders the component every `ms` (default 1 s): for countdowns and "5s ago". */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
