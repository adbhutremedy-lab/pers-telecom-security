"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, Field, Modal, Spinner, TowerBadge, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";
import type { Tower, TowerStatus } from "@/lib/types";

interface Form {
  id?: string;
  tower_number: string;
  site_name: string;
  lat: string;
  lng: string;
  region: string;
  status: TowerStatus;
  address: string;
}
const BLANK: Form = { tower_number: "", site_name: "", lat: "", lng: "", region: "", status: "ACTIVE", address: "" };

export default function TowersAdmin() {
  const toast = useToast();
  const profile = useProfile();
  const [rows, setRows] = useState<Tower[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | TowerStatus>("");
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const all: Tower[] = [];
    for (let off = 0; off < 5000; off += 1000) {
      const { data, error } = await supabaseBrowser()
        .from("towers")
        .select("id, tower_number, site_name, lat, lng, region, status, address, deleted_at")
        .order("tower_number")
        .range(off, off + 999);
      if (error) {
        toast.push({ kind: "error", title: "Could not load towers", body: cleanError(error) });
        break;
      }
      all.push(...((data ?? []) as Tower[]));
      if ((data ?? []).length < 1000) break;
    }
    setRows(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regions = useMemo(() => [...new Set((rows ?? []).map((r) => r.region))].sort(), [rows]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (archived ? r.deleted_at !== null : r.deleted_at === null) &&
        (!status || r.status === status) &&
        (!s || `${r.tower_number} ${r.site_name} ${r.region} ${r.address ?? ""}`.toLowerCase().includes(s)),
    );
  }, [rows, q, status, archived]);

  async function save() {
    if (!edit) return;
    setErr(null);
    const lat = Number(edit.lat);
    const lng = Number(edit.lng);
    if (!edit.tower_number.trim() || !edit.site_name.trim() || !edit.region.trim()) return setErr("Tower number, site name and region are required.");
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || edit.lat.trim() === "") return setErr("Latitude must be a number between -90 and 90.");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180 || edit.lng.trim() === "") return setErr("Longitude must be a number between -180 and 180.");
    setBusy(true);
    const payload = {
      tower_number: edit.tower_number.trim().toUpperCase(),
      site_name: edit.site_name.trim(),
      lat,
      lng,
      region: edit.region.trim(),
      status: edit.status,
      address: edit.address.trim() || null,
    };
    const sb = supabaseBrowser();
    const res = edit.id ? await sb.from("towers").update(payload).eq("id", edit.id) : await sb.from("towers").insert({ ...payload, created_by: profile.id });
    setBusy(false);
    if (res.error) {
      const m = cleanError(res.error);
      return setErr(/duplicate|unique/i.test(m) ? "A tower with this number already exists." : m);
    }
    toast.push({ kind: "success", title: edit.id ? "Tower saved" : "Tower added", body: payload.tower_number });
    setEdit(null);
    void load();
  }

  async function setArchivedFlag(t: Tower, on: boolean) {
    const { error } = await supabaseBrowser().from("towers").update({ deleted_at: on ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) return toast.push({ kind: "error", title: "Could not change the tower", body: cleanError(error) });
    toast.push({ kind: "success", title: on ? "Tower archived" : "Tower restored", body: t.tower_number });
    void load();
  }

  return (
    <div className="space-y-3" data-testid="admin-towers">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className={inputCls + " pl-9"} placeholder="Search tower number, name, region" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search towers" />
        </div>
        <select className={inputCls + " w-40"} value={status} onChange={(e) => setStatus(e.target.value as "" | TowerStatus)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="MAINTENANCE">Maintenance</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="h-4 w-4" /> Archived
        </label>
        <Button onClick={() => { setErr(null); setEdit({ ...BLANK }); }} data-testid="add-tower">
          <Plus className="h-4 w-4" /> Add tower
        </Button>
      </div>

      {rows === null ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Site name</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Latitude, longitude</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((t) => (
                <tr key={t.id} className="border-t border-slate-100" data-testid="tower-row">
                  <td className="px-3 py-2 font-semibold">{t.tower_number}</td>
                  <td className="px-3 py-2">{t.site_name}</td>
                  <td className="px-3 py-2 text-slate-600">{t.region}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{t.lat.toFixed(5)}, {t.lng.toFixed(5)}</td>
                  <td className="px-3 py-2"><TowerBadge status={t.status} /></td>
                  <td className="px-3 py-2 text-right">
                    <Button tone="ghost" className="px-2 py-1" onClick={() => { setErr(null); setEdit({ id: t.id, tower_number: t.tower_number, site_name: t.site_name, lat: String(t.lat), lng: String(t.lng), region: t.region, status: t.status, address: t.address ?? "" }); }} aria-label={`Edit ${t.tower_number}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {t.deleted_at ? (
                      <Button tone="ghost" className="px-2 py-1" onClick={() => setArchivedFlag(t, false)} aria-label={`Restore ${t.tower_number}`}><RotateCcw className="h-4 w-4" /></Button>
                    ) : (
                      <Button tone="ghost" className="px-2 py-1" onClick={() => setArchivedFlag(t, true)} aria-label={`Archive ${t.tower_number}`}><Archive className="h-4 w-4" /></Button>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No towers match.</td></tr>}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            {shown.length} tower{shown.length === 1 ? "" : "s"}{shown.length > 200 ? " (first 200 shown, use the search)" : ""}. Archiving hides a tower from the map and from new incidents but keeps its history.
          </p>
        </div>
      )}

      <Modal
        open={!!edit}
        title={edit?.id ? `Edit tower ${edit.tower_number}` : "Add tower"}
        onClose={() => setEdit(null)}
        footer={<><Button tone="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} busy={busy} data-testid="save-tower">Save</Button></>}
      >
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tower number"><input className={inputCls} value={edit.tower_number} onChange={(e) => setEdit({ ...edit, tower_number: e.target.value })} placeholder="GGN-101" aria-label="Tower number" /></Field>
              <Field label="Status">
                <select className={inputCls} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as TowerStatus })} aria-label="Tower status">
                  <option value="ACTIVE">Active</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </Field>
            </div>
            <Field label="Site name"><input className={inputCls} value={edit.site_name} onChange={(e) => setEdit({ ...edit, site_name: e.target.value })} aria-label="Site name" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude"><input className={inputCls} inputMode="decimal" value={edit.lat} onChange={(e) => setEdit({ ...edit, lat: e.target.value })} placeholder="28.4595" aria-label="Latitude" /></Field>
              <Field label="Longitude"><input className={inputCls} inputMode="decimal" value={edit.lng} onChange={(e) => setEdit({ ...edit, lng: e.target.value })} placeholder="77.0266" aria-label="Longitude" /></Field>
            </div>
            <Field label="Region" hint="Pick an existing region or just type a new name (for example Lagos). A new region is created automatically when you save.">
              <input className={inputCls} list="admin-regions" value={edit.region} onChange={(e) => setEdit({ ...edit, region: e.target.value })} placeholder="Type a region name, e.g. Lagos" aria-label="Region" />
              <datalist id="admin-regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
              {regions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Existing:</span>
                  {regions.map((r) => (
                    <button key={r} type="button" onClick={() => setEdit({ ...edit, region: r })} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50">{r}</button>
                  ))}
                </div>
              )}
              {edit.region.trim() !== "" && !regions.some((r) => r.toLowerCase() === edit.region.trim().toLowerCase()) && (
                <p className="mt-1 text-xs font-medium text-emerald-700" data-testid="new-region-note">New region &ldquo;{edit.region.trim()}&rdquo; will be created.</p>
              )}
            </Field>
            <Field label="Address (optional)"><input className={inputCls} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} aria-label="Address" /></Field>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
