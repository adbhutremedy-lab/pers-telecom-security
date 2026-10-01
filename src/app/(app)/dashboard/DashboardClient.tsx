"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import LiveMap, { type MapFocus } from "@/components/LiveMap";
import StatTile from "@/components/StatTile";
import IncidentCard from "@/components/IncidentCard";
import TowerPanel from "@/components/TowerPanel";
import TriggerIncidentModal from "@/components/TriggerIncidentModal";
import { TeamBadge } from "@/components/ui";
import { useLiveData } from "@/hooks/useLiveData";
import { useNow } from "@/hooks/useNow";
import { TEAM_COLOR, TEAM_LABEL } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { RrtLive, TeamStatus } from "@/lib/types";

export default function DashboardClient({ initialTowerId, initialTeamId }: { initialTowerId: string | null; initialTeamId: string | null }) {
  const { stats, teams, towers, active, loading, error } = useLiveData();
  const now = useNow(1000);
  const [tab, setTab] = useState<"incidents" | "teams">("incidents");
  const [selectedTowerId, setSelectedTowerId] = useState<string | null>(null);
  const [triggerFor, setTriggerFor] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  const activeTowerIds = useMemo(() => new Set(active.map((i) => i.tower_id)), [active]);
  const selectedTower = towers.find((t) => t.id === selectedTowerId) ?? null;
  const triggerTower = towers.find((t) => t.id === triggerFor) ?? null;
  const activeForSelected = active.find((i) => i.tower_id === selectedTowerId)?.id ?? null;

  // open straight on a tower / team when arriving from another page (?tower=… / ?team=…)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || loading) return;
    if (initialTowerId) {
      const t = towers.find((x) => x.id === initialTowerId);
      if (t) {
        deepLinked.current = true;
        setSelectedTowerId(t.id);
        setFocus({ lat: t.lat, lng: t.lng, zoom: 15, key: `deep-${t.id}` });
      }
    } else if (initialTeamId) {
      const t = teams.find((x) => x.id === initialTeamId);
      if (t) {
        deepLinked.current = true;
        setTab("teams");
        if (t.lat != null && t.lng != null) setFocus({ lat: t.lat, lng: t.lng, zoom: 15, key: `deep-${t.id}` });
      }
    }
  }, [initialTowerId, initialTeamId, loading, towers, teams]);

  const fly = (lat: number | null, lng: number | null, key: string) => {
    if (lat == null || lng == null) return;
    setFocus({ lat, lng, zoom: 15, key: `${key}-${Date.now()}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:p-4">
      {/* seven live tiles */}
      <section aria-label="Live statistics" className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <StatTile label="Total towers" value={stats?.total_towers} accent="bg-slate-500" hint={stats ? `${stats.active_towers} active` : undefined} />
        <StatTile label="Active incidents" value={stats?.active_incidents} accent="bg-red-600" hint={stats ? `${stats.open_incidents} waiting for a team` : undefined} />
        <StatTile label="Online RRT" value={stats?.online_rrt} accent="bg-green-600" hint="available now" />
        <StatTile label="Assigned RRT" value={stats?.assigned_rrt} accent="bg-yellow-500" hint="travelling to site" />
        <StatTile label="Reached" value={stats?.reached_rrt} accent="bg-blue-600" hint="on site" />
        <StatTile label="Offline RRT" value={stats?.offline_rrt} accent="bg-red-400" hint="no GPS / switched off" />
        <StatTile label="Resolved today" value={stats?.resolved_today} accent="bg-emerald-700" hint="India time" />
      </section>

      {error && (
        <p role="alert" className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load live data: {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {/* map */}
        <section className="relative min-h-[55vh] flex-1 overflow-hidden rounded-xl bg-slate-200 shadow-sm ring-1 ring-slate-200 lg:min-h-0">
          <LiveMap
            towers={towers}
            activeTowerIds={activeTowerIds}
            teams={teams}
            incidents={active}
            focus={focus}
            selectedTowerId={selectedTowerId}
            onTowerClick={(id) => setSelectedTowerId(id)}
            onTeamClick={(id) => {
              setTab("teams");
              const t = teams.find((x) => x.id === id);
              if (t) fly(t.lat, t.lng, t.id);
            }}
          />
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-white/60">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            </div>
          )}
          {selectedTower && (
            <div className="absolute bottom-3 left-3 z-10">
              <TowerPanel tower={selectedTower} activeIncidentId={activeForSelected} onClose={() => setSelectedTowerId(null)} onTrigger={() => setTriggerFor(selectedTower.id)} />
            </div>
          )}
          <Legend />
        </section>

        {/* side panel */}
        <aside className="flex max-h-[60vh] min-h-0 w-full flex-col rounded-xl bg-slate-50 shadow-sm ring-1 ring-slate-200 lg:max-h-none lg:w-96">
          <div className="flex shrink-0 gap-1 border-b border-slate-200 p-1.5" role="tablist">
            {(
              [
                ["incidents", `Active incidents (${active.length})`],
                ["teams", `RRT teams (${teams.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={clsx("flex-1 rounded-lg px-3 py-2 text-sm font-medium transition", tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
            {tab === "incidents" ? (
              active.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No active incidents. Click a tower on the map to trigger one.</p>
              ) : (
                active.map((i) => <IncidentCard key={i.id} i={i} now={now} onLocate={() => fly(i.tower_lat, i.tower_lng, i.id)} />)
              )
            ) : (
              teams.map((t) => <TeamRow key={t.id} t={t} now={now} onClick={() => fly(t.lat, t.lng, t.id)} />)
            )}
          </div>
        </aside>
      </div>

      <TriggerIncidentModal tower={triggerTower} source="MAP_MENU" onClose={() => setTriggerFor(null)} />
    </div>
  );
}

function TeamRow({ t, now, onClick }: { t: RrtLive; now: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm hover:border-brand-500">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: TEAM_COLOR[t.live_status], color: t.live_status === "ASSIGNED" ? "#1f2937" : "#fff" }}>
        {t.code.replace("RRT-", "")}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-900">{t.name}</span>
          {t.is_simulated ? (
            <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium uppercase text-slate-500">sim</span>
          ) : (
            <span className="rounded bg-green-100 px-1.5 text-[10px] font-medium uppercase text-green-800">real phone</span>
          )}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {t.incident_number ? `${t.incident_number} · ${t.tower_number}` : t.region ?? "—"} · seen {fmtAgo(t.last_seen_at, now)}
        </span>
      </span>
      <TeamBadge status={t.live_status as TeamStatus} />
    </button>
  );
}

function Legend() {
  const order: TeamStatus[] = ["AVAILABLE", "ASSIGNED", "REACHED", "OFFLINE"];
  return (
    <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/95 px-3 py-2 text-xs shadow ring-1 ring-slate-200">
      <p className="mb-1 font-semibold text-slate-700">RRT status</p>
      <ul className="space-y-0.5">
        {order.map((s) => (
          <li key={s} className="flex items-center gap-2 text-slate-600">
            <span className="h-3 w-3 rounded-full" style={{ background: TEAM_COLOR[s] }} /> {TEAM_LABEL[s]}
          </li>
        ))}
        <li className="flex items-center gap-2 text-slate-600">
          <span className="h-3 w-3 rounded-full bg-teal-700" /> Tower
        </li>
        <li className="flex items-center gap-2 text-slate-600">
          <span className="h-3 w-3 rounded-full bg-red-600 ring-2 ring-red-300" /> Incident
        </li>
      </ul>
    </div>
  );
}
