"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { Button, TowerBadge } from "./ui";
import type { Tower, TowerCounts } from "@/lib/types";

export default function TowerPanel({
  tower,
  activeIncidentId,
  onClose,
  onTrigger,
}: {
  tower: Tower;
  activeIncidentId?: string | null;
  onClose: () => void;
  onTrigger: () => void;
}) {
  const [counts, setCounts] = useState<TowerCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabaseBrowser()
      .from("v_tower_incident_counts")
      .select("*")
      .eq("tower_id", tower.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCounts((data as TowerCounts) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [tower.id, activeIncidentId]);

  const canTrigger = tower.status !== "INACTIVE" && !activeIncidentId;

  return (
    <div className="w-72 rounded-xl bg-white p-4 shadow-xl ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-slate-900">{tower.tower_number}</p>
          <p className="text-sm text-slate-600">{tower.site_name}</p>
        </div>
        <button onClick={onClose} aria-label="Close tower details" className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <TowerBadge status={tower.status} />
        <span className="text-xs text-slate-500">{tower.region}</span>
      </div>
      {tower.address && <p className="mt-2 text-xs text-slate-500">{tower.address}</p>}
      <p className="mt-1 text-xs text-slate-400">
        {tower.lat.toFixed(5)}, {tower.lng.toFixed(5)}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2 text-center">
        <div>
          <dt className="text-[11px] text-slate-500">Total</dt>
          <dd className="text-lg font-semibold tabular-nums">{counts?.total_incidents ?? "–"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Open</dt>
          <dd className="text-lg font-semibold tabular-nums text-red-600">{counts?.open_incidents ?? "–"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Resolved</dt>
          <dd className="text-lg font-semibold tabular-nums text-green-700">{counts?.resolved_incidents ?? "–"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Last incident: {fmtDateTime(counts?.last_incident_at)} · Avg response: {fmtDuration(counts?.avg_response_seconds ?? null)}
      </p>

      <div className="mt-3 space-y-2">
        {activeIncidentId ? (
          <Link href={`/incidents/${activeIncidentId}`} className="block rounded-lg bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-700 hover:bg-red-100">
            Active incident in progress — open it
          </Link>
        ) : (
          <Button tone="danger" className="w-full" onClick={onTrigger} disabled={!canTrigger}>
            Trigger incident
          </Button>
        )}
        {tower.status === "INACTIVE" && <p className="text-center text-xs text-slate-500">Inactive towers cannot raise incidents.</p>}
      </div>
    </div>
  );
}
