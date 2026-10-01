"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { IncidentDetail } from "@/lib/types";

type Row = Pick<
  IncidentDetail,
  "id" | "incident_number" | "tower_name" | "tower_number" | "status" | "triggered_at" | "resolved_at" | "response_seconds" | "resolution_seconds"
>;

/** The team's last 25 finished incidents. */
export default function HistoryTab({ teamId, refreshKey }: { teamId: string; refreshKey: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      const { data, error: err } = await supabaseBrowser()
        .from("v_incident_detail")
        .select("id, incident_number, tower_name, tower_number, status, triggered_at, resolved_at, response_seconds, resolution_seconds")
        .eq("assigned_team_id", teamId)
        .eq("status", "RESOLVED")
        .order("resolved_at", { ascending: false })
        .limit(25);
      if (stop) return;
      if (err) setError(err.message);
      else setRows((data ?? []) as Row[]);
    })();
    return () => {
      stop = true;
    };
  }, [teamId, refreshKey]);

  return (
    <div className="space-y-3 p-4" data-testid="history-tab">
      <h2 className="text-lg font-semibold">My finished jobs</h2>
      {error && <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {rows?.length === 0 && <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-300">No finished jobs yet.</p>}
      {rows?.map((r) => (
        <div key={r.id} className="rounded-2xl bg-white/5 p-4" data-testid="history-row">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{r.incident_number}</p>
            <span className="inline-flex items-center gap-1 text-xs text-green-300">
              <CheckCircle2 className="h-4 w-4" /> Resolved
            </span>
          </div>
          <p className="text-sm text-slate-200">
            {r.tower_name} <span className="text-slate-400">({r.tower_number})</span>
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            {fmtDateTime(r.resolved_at)} · reached in {fmtDuration(r.response_seconds)} · total {fmtDuration(r.resolution_seconds)}
          </p>
        </div>
      ))}
    </div>
  );
}
