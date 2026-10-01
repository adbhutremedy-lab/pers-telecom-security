"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { Button, EmptyState, IncidentBadge, Modal, PageHeader, Spinner, inputCls } from "@/components/ui";
import TowerPicker from "@/components/TowerPicker";
import TriggerIncidentModal, { type TriggerTarget } from "@/components/TriggerIncidentModal";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import type { IncidentDetail, IncidentStatus } from "@/lib/types";

const PAGE = 25;
const FILTERS: { key: IncidentStatus | "ALL" | "ACTIVE"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "OPEN", label: "Open" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "REACHED", label: "Reached" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CANCELLED", label: "Cancelled" },
];

type Row = Pick<
  IncidentDetail,
  | "id"
  | "incident_number"
  | "status"
  | "dispatch_state"
  | "tower_number"
  | "tower_name"
  | "region"
  | "team_code"
  | "team_name"
  | "triggered_at"
  | "response_seconds"
  | "resolution_seconds"
  | "offers_count"
  | "is_demo_seed"
>;

const COLUMNS =
  "id, incident_number, status, dispatch_state, tower_number, tower_name, region, team_code, team_name, triggered_at, response_seconds, resolution_seconds, offers_count, is_demo_seed";

export default function IncidentsClient() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [target, setTarget] = useState<TriggerTarget | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setTerm(search.trim().replace(/[,()%*\\]/g, " "));
      setPage(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    let q = supabaseBrowser().from("v_incident_detail").select(COLUMNS, { count: "exact" }).order("triggered_at", { ascending: false });
    if (filter === "ACTIVE") q = q.in("status", ["OPEN", "ASSIGNED", "REACHED"]);
    else if (filter !== "ALL") q = q.eq("status", filter);
    if (term) q = q.or(`incident_number.ilike.%${term}%,tower_number.ilike.%${term}%,tower_name.ilike.%${term}%`);
    const { data, count, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) setError(error.message);
    else {
      setError(null);
      setRows((data as Row[]) ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [filter, term, page]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  useRealtimeRefetch(["incidents", "incident_assignments"], load, { intervalMs: 20000 });

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="p-3 lg:p-5">
      <PageHeader
        title="Incidents"
        subtitle={`${total} incident${total === 1 ? "" : "s"}`}
        actions={
          <Button onClick={() => setPickOpen(true)}>
            <Plus className="h-4 w-4" /> Create incident
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(0);
              }}
              aria-pressed={filter === f.key}
              className={clsx("rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition", filter === f.key ? "bg-ink-800 text-white ring-ink-800" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className={inputCls + " pl-9"} placeholder="Search incident or tower" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search incidents" />
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading && rows.length === 0 ? (
        <div className="grid place-items-center p-12">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No incidents match" hint="Change the filter, or create an incident." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Incident</th>
                <th className="px-4 py-3">Tower</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">RRT</th>
                <th className="px-4 py-3">Triggered (IST)</th>
                <th className="px-4 py-3 text-right">Response</th>
                <th className="px-4 py-3 text-right">Resolution</th>
                <th className="px-4 py-3 text-right">Offers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/incidents/${r.id}`)}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/incidents/${r.id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.incident_number}
                    </Link>
                    {r.status === "OPEN" && r.dispatch_state === "EXHAUSTED" && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">NO TEAM</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{r.tower_number}</span>
                    <span className="block text-xs text-slate-500">{r.tower_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <IncidentBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">{r.team_code ? `${r.team_code} · ${r.team_name}` : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{fmtDateTime(r.triggered_at)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.response_seconds)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtDuration(r.resolution_seconds)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.offers_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>
          Page {page + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <Button tone="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button tone="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Modal open={pickOpen} title="Create incident: choose the tower" onClose={() => setPickOpen(false)}>
        <TowerPicker
          onPick={(t) => {
            setPickOpen(false);
            setTarget({ id: t.id, tower_number: t.tower_number, site_name: t.site_name, region: t.region, status: t.status });
          }}
        />
      </Modal>
      <TriggerIncidentModal tower={target} source="CREATE_FORM" onClose={() => setTarget(null)} onDone={(id) => router.push(`/incidents/${id}`)} />
    </div>
  );
}
