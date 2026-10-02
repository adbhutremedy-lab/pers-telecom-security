"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, Spinner, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";
import MapLocationCard from "./MapLocationCard";

interface Def {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  help: string;
}
/** Numeric settings that can be edited. Ranges match the database check. */
const DEFS: Def[] = [
  { key: "offer_timeout_seconds", label: "Time to accept an offer", unit: "seconds", min: 5, max: 300, help: "How long a team has to accept before the incident moves to the next nearest team." },
  { key: "retry_interval_seconds", label: "Wait before offering again", unit: "seconds", min: 10, max: 3600, help: "Pause when every team declined or timed out, before a new round starts." },
  { key: "max_dispatch_rounds", label: "Automatic rounds of offers", unit: "rounds", min: 1, max: 20, help: "After this many rounds an operator must assign a team by hand." },
  { key: "offline_after_seconds", label: "Show team as offline after", unit: "seconds", min: 15, max: 600, help: "No GPS signal for this long marks a team OFFLINE." },
  { key: "gps_interval_seconds", label: "Phone sends position every", unit: "seconds", min: 2, max: 120, help: "Smaller is smoother on the map but uses more battery." },
  { key: "arrival_radius_m", label: "Auto-arrival distance", unit: "metres", min: 5, max: 2000, help: "A team this close to the tower is marked REACHED automatically." },
  { key: "arrival_max_accuracy_m", label: "Ignore GPS worse than", unit: "metres", min: 1, max: 2000, help: "Readings less accurate than this are not used to detect arrival." },
  { key: "default_speed_kmh", label: "Assumed speed", unit: "km/h", min: 5, max: 120, help: "Used for the arrival-time estimate when a team has not started moving." },
  { key: "eta_fresh_seconds", label: "Trust road ETA for", unit: "seconds", min: 10, max: 3600, help: "How long a road-route ETA is trusted before the straight-line estimate is used." },
  { key: "location_retention_days", label: "Keep GPS history for", unit: "days", min: 1, max: 3650, help: "Older GPS history is deleted automatically." },
];

interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
}

export default function SettingsAdmin() {
  const toast = useToast();
  const me = useProfile();
  const isSuper = me.role === "SUPER_ADMIN";
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser().from("settings").select("key, value, description").order("key");
    if (error) toast.push({ kind: "error", title: "Could not load settings", body: cleanError(error) });
    const list = (data ?? []) as SettingRow[];
    setRows(list);
    const d: Record<string, string> = {};
    for (const r of list) if (typeof r.value === "number") d[r.key] = String(r.value);
    setDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const byKey = (k: string) => rows?.find((r) => r.key === k);
  const dirty = DEFS.filter((d) => byKey(d.key) && draft[d.key] !== undefined && Number(draft[d.key]) !== byKey(d.key)!.value);

  async function save() {
    setErr(null);
    for (const d of dirty) {
      const n = Number(draft[d.key]);
      if (!Number.isFinite(n) || draft[d.key].trim() === "") return setErr(`${d.label}: enter a number.`);
      if (n < d.min || n > d.max) return setErr(`${d.label}: must be between ${d.min} and ${d.max}.`);
      if (!Number.isInteger(n)) return setErr(`${d.label}: use a whole number.`);
    }
    setBusy(true);
    const sb = supabaseBrowser();
    for (const d of dirty) {
      const { error } = await sb.from("settings").update({ value: Number(draft[d.key]), updated_by: me.id }).eq("key", d.key);
      if (error) {
        setBusy(false);
        void load();
        return setErr(`${d.label}: ${cleanError(error)}`);
      }
    }
    setBusy(false);
    toast.push({ kind: "success", title: "Settings saved", body: `${dirty.length} changed. Phones pick this up the next time they open.` });
    void load();
  }

  if (rows === null) return <div className="grid place-items-center p-12"><Spinner /></div>;
  const MAP_KEYS = ["map_default_center", "map_default_zoom", "demo_city"]; // edited in the Demo location card
  const others = rows.filter((r) => !DEFS.some((d) => d.key === r.key) && !MAP_KEYS.includes(r.key));

  return (
    <div className="space-y-4" data-testid="admin-settings">
      <p className="text-sm text-slate-600">
        {isSuper ? "These rules control how dispatch behaves. Changes apply to new offers straight away." : "These rules control how dispatch behaves. Only a Super Admin can change them."}
      </p>
      <MapLocationCard />
      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {DEFS.filter((d) => byKey(d.key)).map((d) => (
          <div key={d.key} className="grid items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[1fr_180px]">
            <div>
              <div className="text-sm font-medium text-slate-900">{d.label}</div>
              <div className="text-xs text-slate-500">{d.help} Allowed: {d.min}–{d.max}.</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                className={inputCls}
                inputMode="numeric"
                value={draft[d.key] ?? ""}
                disabled={!isSuper}
                onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })}
                aria-label={d.label}
                data-testid={`set-${d.key}`}
              />
              <span className="w-14 shrink-0 text-xs text-slate-500">{d.unit}</span>
            </div>
          </div>
        ))}
      </div>
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {isSuper && (
        <div className="flex items-center gap-3">
          <Button onClick={save} busy={busy} disabled={dirty.length === 0} data-testid="save-settings">Save changes</Button>
          {dirty.length > 0 && <span className="text-sm text-slate-500">{dirty.length} unsaved</span>}
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-700">Fixed values (shown for information)</h3>
          <div className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
            {others.map((r) => (
              <div key={r.key} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0">
                <span className="text-slate-600">{r.description ?? r.key}</span>
                <span className="font-mono text-xs text-slate-900">{typeof r.value === "string" ? r.value : JSON.stringify(r.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
