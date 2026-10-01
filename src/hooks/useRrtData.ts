"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "./useRealtimeRefetch";
import type { IncidentDetail, MyTeam, PhoneOffer } from "@/lib/types";

const TEAM_COLS =
  "id, code, name, mobile, vehicle_plate, vehicle_model, region, status, is_active, is_online_enabled, last_seen_at, last_lat, last_lng, current_incident_id";

export interface RrtData {
  team: MyTeam | null;
  offers: PhoneOffer[];
  job: IncidentDetail | null;
  loaded: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Everything the phone needs: my team, my open offers, my current incident. Live via Realtime + a 4 s safety poll. */
export function useRrtData(teamId: string): RrtData {
  const [team, setTeam] = useState<MyTeam | null>(null);
  const [offers, setOffers] = useState<PhoneOffer[]>([]);
  const [job, setJob] = useState<IncidentDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const again = useRef(false);

  const refetch = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      const sb = supabaseBrowser();
      const [t, a] = await Promise.all([
        sb.from("rrt_teams").select(TEAM_COLS).eq("id", teamId).maybeSingle(),
        sb
          .from("incident_assignments")
          .select("id, incident_id, distance_km, offered_at, expires_at")
          .eq("team_id", teamId)
          .eq("status", "PENDING")
          .order("offered_at", { ascending: true }),
      ]);
      if (t.error) throw t.error;
      if (a.error) throw a.error;
      const nextTeam = (t.data as MyTeam | null) ?? null;
      setTeam(nextTeam);

      const wanted = new Set<string>();
      for (const o of a.data ?? []) wanted.add(o.incident_id as string);
      if (nextTeam?.current_incident_id) wanted.add(nextTeam.current_incident_id);

      let details: IncidentDetail[] = [];
      if (wanted.size > 0) {
        const d = await sb.from("v_incident_detail").select("*").in("id", [...wanted]);
        if (d.error) throw d.error;
        details = (d.data ?? []) as IncidentDetail[];
      }
      const byId = new Map(details.map((i) => [i.id, i]));

      setOffers(
        (a.data ?? [])
          .map((o) => {
            const i = byId.get(o.incident_id as string);
            if (!i) return null;
            return {
              id: o.id as string,
              incident_id: o.incident_id as string,
              distance_km: Number(o.distance_km),
              offered_at: o.offered_at as string,
              expires_at: o.expires_at as string,
              incident_number: i.incident_number,
              tower_number: i.tower_number,
              tower_name: i.tower_name,
              tower_lat: i.tower_lat,
              tower_lng: i.tower_lng,
              region: i.region,
            } satisfies PhoneOffer;
          })
          .filter((x): x is PhoneOffer => x !== null),
      );
      setJob(nextTeam?.current_incident_id ? byId.get(nextTeam.current_incident_id) ?? null : null);
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not load");
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void refetch();
      }
    }
  }, [teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtimeRefetch(["rrt_teams", "incident_assignments", "incidents"], () => void refetch(), { throttleMs: 250, intervalMs: 4000 });

  return { team, offers, job, loaded, error, refetch };
}
