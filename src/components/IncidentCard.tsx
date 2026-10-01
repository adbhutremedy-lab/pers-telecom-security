"use client";

import Link from "next/link";
import { AlertOctagon, Clock, MapPin, Navigation, Timer } from "lucide-react";
import { IncidentBadge } from "./ui";
import { fmtAgo, fmtDistance, fmtDuration } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

export default function IncidentCard({ i, now, onLocate }: { i: IncidentDetail; now: number; onLocate?: () => void }) {
  const secondsLeft = i.pending_expires_at ? Math.max(0, Math.ceil((new Date(i.pending_expires_at).getTime() - now) / 1000)) : null;
  const exhausted = i.status === "OPEN" && i.dispatch_state === "EXHAUSTED";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/incidents/${i.id}`} className="font-semibold text-brand-700 hover:underline">
            {i.incident_number}
          </Link>
          <p className="truncate text-sm text-slate-700">
            {i.tower_number} · {i.tower_name}
          </p>
        </div>
        <IncidentBadge status={i.status} />
      </div>

      <div className="mt-2 space-y-1 text-sm text-slate-600">
        {i.status === "OPEN" && !exhausted && i.pending_team_code && (
          <p className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-amber-600" />
            Alert sent to <strong>{i.pending_team_code}</strong>
            <span className="ml-auto rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold tabular-nums text-amber-800">{secondsLeft}s</span>
          </p>
        )}
        {exhausted && (
          <p className="flex items-start gap-1.5 text-red-700">
            <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No team available (round {i.dispatch_round}). Retrying automatically. You can assign a team by hand.
            </span>
          </p>
        )}
        {(i.status === "ASSIGNED" || i.status === "REACHED") && i.team_code && (
          <p className="flex items-center gap-1.5">
            <Navigation className="h-4 w-4 text-yellow-600" />
            <strong>{i.team_code}</strong> {i.team_name}
          </p>
        )}
        {i.status === "ASSIGNED" && (
          <p className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-slate-400" />
            {fmtDistance(i.distance_remaining_m)} away · ETA {fmtDuration(i.eta_seconds)}
          </p>
        )}
        {i.status === "REACHED" && (
          <p className="flex items-center gap-1.5 text-blue-700">
            <MapPin className="h-4 w-4" /> On site since {fmtAgo(i.reached_at, now)} {i.reached_manually && "(marked by operator)"}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="h-3.5 w-3.5" /> Triggered {fmtAgo(i.triggered_at, now)} · {i.offers_count} offer{i.offers_count === 1 ? "" : "s"}
        </p>
      </div>

      {onLocate && (
        <button onClick={onLocate} className="mt-2 text-xs font-medium text-brand-600 hover:underline">
          Show on map
        </button>
      )}
    </div>
  );
}
