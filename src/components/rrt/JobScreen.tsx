"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, ClipboardCheck, MapPin, Navigation, Radio, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchRoute, type LngLat } from "@/lib/demoSim";
import { MAPBOX_TOKEN } from "@/lib/env";
import { fmtDistance, fmtDuration, fmtTime, haversineKm } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";
import type { Fix } from "@/hooks/useGps";

const JobMap = dynamic(() => import("./JobMap"), {
  ssr: false,
  loading: () => <div className="h-60 animate-pulse rounded-2xl bg-white/5" />,
});

interface Props {
  job: IncidentDetail;
  fix: Fix | null;
  onReport: () => void;
}

const ROUTE_EVERY_MS = 60_000;

/** The active incident: where to go, how far, a map, and the "Finish & report" button. */
export default function JobScreen({ job, fix, onReport }: Props) {
  const reached = job.status === "REACHED";
  const [route, setRoute] = useState<LngLat[] | null>(null);
  const [routeEta, setRouteEta] = useState<{ s: number; m: number } | null>(null);
  const lastRoute = useRef(0);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const hasFix = fix !== null;

  // Road route + ETA from Mapbox, refreshed about once a minute while driving. Saved so the control room sees it too.
  useEffect(() => {
    if (reached) return;
    let stop = false;
    const run = async () => {
      const f = fixRef.current;
      if (!f || stop || document.visibilityState === "hidden") return;
      if (Date.now() - lastRoute.current < ROUTE_EVERY_MS - 1000) return;
      lastRoute.current = Date.now();
      const r = await fetchRoute([f.lng, f.lat], [job.tower_lng, job.tower_lat], MAPBOX_TOKEN);
      if (stop) return;
      setRoute(r.coords);
      setRouteEta({ s: Math.round(r.durationS), m: Math.round(r.distanceM) });
      await supabaseBrowser().rpc("update_incident_route", {
        p_incident_id: job.id,
        p_eta_seconds: Math.round(r.durationS),
        p_distance_m: Math.round(r.distanceM),
        p_geojson: { type: "LineString", coordinates: r.coords },
      });
    };
    void run();
    const t = window.setInterval(() => void run(), 5000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [job.id, job.tower_lat, job.tower_lng, reached, hasFix]);

  const straightM = useMemo(
    () => (fix ? haversineKm(fix.lat, fix.lng, job.tower_lat, job.tower_lng) * 1000 : null),
    [fix, job.tower_lat, job.tower_lng],
  );
  const distanceM = straightM ?? job.distance_remaining_m;
  const etaS = routeEta?.s ?? job.eta_seconds;
  const far = straightM !== null && straightM > 150;

  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${job.tower_lat},${job.tower_lng}&travelmode=driving`;

  return (
    <div className="space-y-4 p-4" data-testid="job-screen">
      <div
        data-testid="job-status"
        className={clsx(
          "flex items-center gap-3 rounded-2xl p-4",
          reached ? "bg-blue-600/90" : "bg-amber-500/90 text-ink-900",
        )}
      >
        {reached ? <CheckCircle2 className="h-8 w-8 shrink-0" /> : <Navigation className="h-8 w-8 shrink-0" />}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{job.incident_number}</p>
          <p className="text-lg font-bold leading-tight">{reached ? "You have reached the tower" : "Go to the tower"}</p>
          <p className="text-xs opacity-80">
            {reached ? `Arrived ${fmtTime(job.reached_at)}` : `Accepted ${fmtTime(job.accepted_at)}`}
            {job.reached_manually ? " (marked by control room)" : ""}
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-white/5 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Tower</p>
        <p className="text-xl font-semibold">{job.tower_name}</p>
        <p className="text-sm text-slate-300">
          {job.tower_number}
          {job.region ? ` · ${job.region}` : ""}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/5 p-3" data-testid="job-distance">
            <p className="text-xs text-slate-400">Distance</p>
            <p className="text-lg font-semibold">{reached ? "On site" : distanceM != null ? fmtDistance(distanceM) : "—"}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3" data-testid="job-eta">
            <p className="text-xs text-slate-400">Arrival in</p>
            <p className="text-lg font-semibold">{reached ? "—" : etaS != null ? fmtDuration(etaS) : "—"}</p>
          </div>
        </div>
      </div>

      {!fix && (
        <div className="flex items-start gap-2 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">
          <Radio className="mt-0.5 h-4 w-4 shrink-0" />
          Waiting for your GPS position. Go outside or near a window, and keep location switched on.
        </div>
      )}

      <JobMap tower={{ lat: job.tower_lat, lng: job.tower_lng, name: job.tower_name }} me={fix ? { lat: fix.lat, lng: fix.lng } : null} route={route} />

      {!reached && (
        <a
          href={navUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="job-navigate"
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-brand-600 text-base font-semibold text-white active:bg-brand-700"
        >
          <MapPin className="h-5 w-5" /> Open in Google Maps
        </a>
      )}

      {!reached && (
        <p className="text-center text-xs text-slate-400">
          Arrival is detected automatically when you are within 50 m of the tower. Keep this app open.
        </p>
      )}

      {far && !reached && (
        <div data-testid="job-far-warning" className="flex items-start gap-2 rounded-xl bg-yellow-500/15 p-3 text-sm text-yellow-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          You are still {fmtDistance(straightM)} from the tower. Only finish the report if the work is really done.
        </div>
      )}

      <button
        onClick={onReport}
        data-testid="job-report"
        className={clsx(
          "flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold",
          reached ? "bg-green-600 text-white active:bg-green-700" : "bg-white/10 text-slate-200 active:bg-white/20",
        )}
      >
        <ClipboardCheck className="h-5 w-5" />
        Finish &amp; report
      </button>
    </div>
  );
}
