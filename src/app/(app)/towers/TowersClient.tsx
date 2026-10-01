"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { Button, EmptyState, PageHeader, Spinner, TowerBadge, inputCls } from "@/components/ui";
import TriggerIncidentModal, { type TriggerTarget } from "@/components/TriggerIncidentModal";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { TowerCounts } from "@/lib/types";

export default function TowersClient() {
  const [rows, setRows] = useState<TowerCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [target, setTarget] = useState<TriggerTarget | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("v_tower_incident_counts").select("*").order("tower_number").limit(1000);
    if (error) setError(error.message);
    else {
      setError(null);
      setRows((data as TowerCounts[]) ?? []);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeRefetch(["towers", "incidents"], load, { intervalMs: 30000 });

  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))).sort(), [rows]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!term || r.tower_number.toLowerCase().includes(term) || r.site_name.toLowerCase().includes(term)) &&
        (!region || r.region === region) &&
        (!status || r.status === status),
    );
  }, [rows, q, region, status]);

  return (
    <div className="p-3 lg:p-5">
      <PageHeader title="Towers" subtitle={`${shown.length} of ${rows.length} towers`} />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className={inputCls + " pl-9"} placeholder="Search tower number or site" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search towers" />
        </div>
        <select className={inputCls + " w-auto"} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filter by region">
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select className={inputCls + " w-auto"} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="MAINTENANCE">Maintenance</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : shown.length === 0 ? (
        <EmptyState title="No towers match" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tower</th>
                <th className="px-4 py-3">Region</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Incidents</th>
                <th className="px-4 py-3 text-right">Open</th>
                <th className="px-4 py-3">Last incident</th>
                <th className="px-4 py-3 text-right">Avg response</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((t) => (
                <tr key={t.tower_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard?tower=${t.tower_id}`} className="font-medium text-brand-700 hover:underline">
                      {t.tower_number}
                    </Link>
                    <span className="block text-xs text-slate-500">{t.site_name}</span>
                  </td>
                  <td className="px-4 py-2.5">{t.region}</td>
                  <td className="px-4 py-2.5"><TowerBadge status={t.status} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.total_incidents}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{t.open_incidents > 0 ? <span className="font-semibold text-red-600">{t.open_incidents}</span> : 0}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDateTime(t.last_incident_at)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtDuration(t.avg_response_seconds)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      tone="outline"
                      className="px-2.5 py-1.5 text-xs"
                      disabled={t.status === "INACTIVE" || t.open_incidents > 0}
                      title={t.open_incidents > 0 ? "This tower already has an active incident" : t.status === "INACTIVE" ? "Inactive tower" : undefined}
                      onClick={() => setTarget({ id: t.tower_id, tower_number: t.tower_number, site_name: t.site_name, region: t.region, status: t.status })}
                    >
                      Trigger
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TriggerIncidentModal tower={target} source="CREATE_FORM" onClose={() => setTarget(null)} onDone={() => void load()} />
    </div>
  );
}
