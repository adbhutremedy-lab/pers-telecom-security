"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { useNow } from "@/hooks/useNow";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, EmptyState, PageHeader, Spinner, TeamBadge } from "@/components/ui";
import { cleanError, fmtAgo } from "@/lib/format";
import { isAdminRole, type RrtLive } from "@/lib/types";

export default function TeamsClient() {
  const profile = useProfile();
  const toast = useToast();
  const now = useNow(1000);
  const [rows, setRows] = useState<RrtLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("v_rrt_live").select("*").order("code");
    if (error) setError(error.message);
    else {
      setError(null);
      setRows((data as RrtLive[]) ?? []);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeRefetch(["rrt_teams", "incidents"], load, { intervalMs: 10000 });

  async function toggle(t: RrtLive) {
    setBusyId(t.id);
    const { error } = await supabaseBrowser().rpc("set_team_online", { p_online: !t.is_online_enabled, p_team_id: t.id });
    setBusyId(null);
    if (error) toast.push({ kind: "error", title: "Could not change the team", body: cleanError(error) });
    else {
      toast.push({ kind: "success", title: `${t.code} is now ${t.is_online_enabled ? "offline" : "online"}` });
      void load();
    }
  }

  const admin = isAdminRole(profile.role);

  return (
    <div className="p-3 lg:p-5">
      <PageHeader title="RRT Teams" subtitle="Live status of every Rapid Response Team (1 real phone + 9 simulated)" />
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No teams yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Current incident</th>
                <th className="px-4 py-3 text-right">Speed</th>
                <th className="px-4 py-3">Last GPS</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} className={t.is_active ? "hover:bg-slate-50" : "opacity-50"}>
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard?team=${t.id}`} className="font-medium text-brand-700 hover:underline">
                      {t.code}
                    </Link>{" "}
                    <span className="text-slate-900">{t.name}</span>
                    <span className="block text-xs text-slate-500">{t.mobile ?? "—"} · {t.region ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {t.vehicle_plate ?? "—"}
                    <span className="block text-xs text-slate-500">{t.vehicle_model}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {t.is_simulated ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Simulated</span>
                    ) : (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Real phone</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <TeamBadge status={t.live_status} />
                    {t.is_stale && t.db_status !== "OFFLINE" && <span className="ml-1 text-xs text-red-600">GPS lost</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.current_incident_id ? (
                      <Link href={`/incidents/${t.current_incident_id}`} className="text-brand-700 hover:underline">
                        {t.incident_number}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {t.tower_number && <span className="block text-xs text-slate-500">{t.tower_number}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.speed_kmh != null ? `${Math.round(t.speed_kmh)} km/h` : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtAgo(t.last_seen_at, now)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {admin && t.is_simulated && !t.current_incident_id && (
                      <Button tone="outline" className="px-2.5 py-1.5 text-xs" busy={busyId === t.id} onClick={() => toggle(t)}>
                        {t.is_online_enabled ? "Take offline" : "Bring online"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
