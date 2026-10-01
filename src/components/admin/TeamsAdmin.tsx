"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Button, Field, Modal, Spinner, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";

interface Team {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  region: string | null;
  home_lat: number | null;
  home_lng: number | null;
  is_active: boolean;
  is_simulated: boolean;
  current_incident_id: string | null;
}
interface Login {
  rrt_team_id: string | null;
  email: string | null;
  is_active: boolean;
}
interface Form {
  id?: string;
  code: string;
  name: string;
  mobile: string;
  vehicle_plate: string;
  vehicle_model: string;
  region: string;
  home_lat: string;
  home_lng: string;
  is_active: boolean;
  is_simulated: boolean;
}
const BLANK: Form = { code: "", name: "", mobile: "", vehicle_plate: "", vehicle_model: "", region: "", home_lat: "", home_lng: "", is_active: true, is_simulated: false };

export default function TeamsAdmin() {
  const toast = useToast();
  const [rows, setRows] = useState<Team[] | null>(null);
  const [logins, setLogins] = useState<Login[]>([]);
  const [edit, setEdit] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [t, u] = await Promise.all([
      sb.from("rrt_teams").select("id, code, name, mobile, vehicle_plate, vehicle_model, region, home_lat, home_lng, is_active, is_simulated, current_incident_id").order("code"),
      sb.from("users").select("rrt_team_id, email, is_active"),
    ]);
    if (t.error) toast.push({ kind: "error", title: "Could not load teams", body: cleanError(t.error) });
    setRows((t.data ?? []) as Team[]);
    setLogins(((u.data ?? []) as Login[]).filter((l) => l.rrt_team_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!edit) return;
    setErr(null);
    if (!edit.code.trim() || !edit.name.trim()) return setErr("Team code and name are required.");
    const hasLat = edit.home_lat.trim() !== "";
    const hasLng = edit.home_lng.trim() !== "";
    if (hasLat !== hasLng) return setErr("Give both base latitude and base longitude, or leave both empty.");
    const lat = hasLat ? Number(edit.home_lat) : null;
    const lng = hasLng ? Number(edit.home_lng) : null;
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return setErr("Base latitude must be between -90 and 90.");
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return setErr("Base longitude must be between -180 and 180.");
    setBusy(true);
    const base = {
      name: edit.name.trim(),
      mobile: edit.mobile.trim() || null,
      vehicle_plate: edit.vehicle_plate.trim() || null,
      vehicle_model: edit.vehicle_model.trim() || null,
      region: edit.region.trim() || null,
      home_lat: lat,
      home_lng: lng,
      is_active: edit.is_active,
    };
    const sb = supabaseBrowser();
    const res = edit.id
      ? await sb.from("rrt_teams").update(base).eq("id", edit.id)
      : await sb.from("rrt_teams").insert({ ...base, code: edit.code.trim().toUpperCase(), is_simulated: edit.is_simulated });
    setBusy(false);
    if (res.error) {
      const m = cleanError(res.error);
      return setErr(/duplicate|unique/i.test(m) ? "A team with this code already exists." : m);
    }
    toast.push({ kind: "success", title: edit.id ? "Team saved" : "Team added", body: edit.code.toUpperCase() });
    setEdit(null);
    void load();
  }

  return (
    <div className="space-y-3" data-testid="admin-teams">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Rapid Response Teams. A team needs a login (see the Users tab) before its phone can sign in.</p>
        <Button onClick={() => { setErr(null); setEdit({ ...BLANK }); }} data-testid="add-team"><Plus className="h-4 w-4" /> Add team</Button>
      </div>
      {rows === null ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Mobile</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Login</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const lg = logins.find((l) => l.rrt_team_id === t.id && l.is_active);
                return (
                  <tr key={t.id} className="border-t border-slate-100" data-testid="team-row">
                    <td className="px-3 py-2 font-semibold">{t.code}</td>
                    <td className="px-3 py-2">{t.name}</td>
                    <td className="px-3 py-2 text-slate-600">{t.mobile ?? "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{[t.vehicle_model, t.vehicle_plate].filter(Boolean).join(" · ") || "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{t.region ?? "–"}</td>
                    <td className="px-3 py-2 text-slate-600">{lg?.email ?? <span className="text-amber-700">no login</span>}</td>
                    <td className="px-3 py-2">
                      <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{t.is_simulated ? "simulated" : "real phone"}</span>
                      {!t.is_active && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">deactivated</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Edit ${t.code}`} onClick={() => { setErr(null); setEdit({ id: t.id, code: t.code, name: t.name, mobile: t.mobile ?? "", vehicle_plate: t.vehicle_plate ?? "", vehicle_model: t.vehicle_model ?? "", region: t.region ?? "", home_lat: t.home_lat === null ? "" : String(t.home_lat), home_lng: t.home_lng === null ? "" : String(t.home_lng), is_active: t.is_active, is_simulated: t.is_simulated }); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!edit}
        title={edit?.id ? `Edit team ${edit.code}` : "Add team"}
        onClose={() => setEdit(null)}
        footer={<><Button tone="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} busy={busy} data-testid="save-team">Save</Button></>}
      >
        {edit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Team code"><input className={inputCls} value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="RRT-11" aria-label="Team code" /></Field>
              <Field label="Team name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Team name" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile"><input className={inputCls} value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} aria-label="Mobile" /></Field>
              <Field label="Region"><input className={inputCls} value={edit.region} onChange={(e) => setEdit({ ...edit, region: e.target.value })} aria-label="Region" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vehicle model"><input className={inputCls} value={edit.vehicle_model} onChange={(e) => setEdit({ ...edit, vehicle_model: e.target.value })} aria-label="Vehicle model" /></Field>
              <Field label="Vehicle plate"><input className={inputCls} value={edit.vehicle_plate} onChange={(e) => setEdit({ ...edit, vehicle_plate: e.target.value })} aria-label="Vehicle plate" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base latitude" hint="Where the team starts (optional)"><input className={inputCls} inputMode="decimal" value={edit.home_lat} onChange={(e) => setEdit({ ...edit, home_lat: e.target.value })} aria-label="Base latitude" /></Field>
              <Field label="Base longitude"><input className={inputCls} inputMode="decimal" value={edit.home_lng} onChange={(e) => setEdit({ ...edit, home_lng: e.target.value })} aria-label="Base longitude" /></Field>
            </div>
            {!edit.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={edit.is_simulated} onChange={(e) => setEdit({ ...edit, is_simulated: e.target.checked })} /> Simulated team (moved by the Demo Controller, no phone)
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} aria-label="Active" /> Active (can receive incidents)
            </label>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
