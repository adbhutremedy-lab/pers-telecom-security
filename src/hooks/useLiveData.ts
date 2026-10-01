"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "./useRealtimeRefetch";
import type { DashboardStats, IncidentDetail, RrtLive, Tower } from "@/lib/types";

export interface LiveData {
  stats: DashboardStats | null;
  teams: RrtLive[];
  towers: Tower[];
  active: IncidentDetail[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Everything the live dashboard needs, refreshed through Supabase Realtime. */
export function useLiveData(): LiveData {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [teams, setTeams] = useState<RrtLive[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [active, setActive] = useState<IncidentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [s, t, tw, inc] = await Promise.all([
      sb.from("v_dashboard_stats").select("*").maybeSingle(),
      sb.from("v_rrt_live").select("*").eq("is_active", true).order("code"),
      sb.from("towers").select("id, tower_number, site_name, lat, lng, region, status, address, deleted_at").is("deleted_at", null).order("tower_number").limit(1000),
      sb.from("v_incident_detail").select("*").in("status", ["OPEN", "ASSIGNED", "REACHED"]).order("triggered_at", { ascending: false }),
    ]);
    const firstError = s.error ?? t.error ?? tw.error ?? inc.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setError(null);
      setStats((s.data as DashboardStats) ?? null);
      setTeams((t.data as RrtLive[]) ?? []);
      setTowers((tw.data as Tower[]) ?? []);
      setActive((inc.data as IncidentDetail[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefetch(["rrt_teams", "incidents", "incident_assignments", "towers"], load, { throttleMs: 600, intervalMs: 10000 });

  return { stats, teams, towers, active, loading, error, reload: load };
}
