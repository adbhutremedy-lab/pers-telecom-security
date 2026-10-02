"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Pencil, Plus, Wand2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useProfile } from "@/components/ProfileContext";
import { Button, Field, Modal, Spinner, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";
import { makePassword } from "./UsersAdmin";

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
  login_email: string;
  login_password: string;
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BLANK: Form = { code: "", name: "", mobile: "", vehicle_plate: "", vehicle_model: "", region: "", home_lat: "", home_lng: "", is_active: true, is_simulated: false, login_email: "", login_password: "" };

export default function TeamsAdmin() {
  const toast = useToast();
  const me = useProfile();
  const isSuper = me.role === "SUPER_ADMIN";
  const [regionNames, setRegionNames] = useState<string[]>([]);
  const [loginFor, setLoginFor] = useState<{ team: Team; email: string; name: string; password: string } | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [rows, setRows] = useState<Team[] | null>(null);
  const [logins, setLogins] = useState<Login[]>([]);
  const [edit, setEdit] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [t, u, tw] = await Promise.all([
      sb.from("rrt_teams").select("id, code, name, mobile, vehicle_plate, vehicle_model, region, home_lat, home_lng, is_active, is_simulated, current_incident_id").order("code"),
      sb.from("users").select("rrt_team_id, email, is_active"),
      sb.from("towers").select("region"),
    ]);
    setRegionNames(((tw.data ?? []) as { region: string | null }[]).map((r) => r.region ?? ""));
    if (t.error) toast.push({ kind: "error", title: "Could not load teams", body: cleanError(t.error) });
    setRows((t.data ?? []) as Team[]);
    setLogins(((u.data ?? []) as Login[]).filter((l) => l.rrt_team_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const regions = [...new Set([...(rows ?? []).map((r) => r.region ?? ""), ...regionNames].map((r) => r.trim()).filter(Boolean))].sort();

  async function createLogin() {
    if (!loginFor) return;
    setErr(null);
    const email = loginFor.email.trim().toLowerCase();
    if (!loginFor.name.trim()) return setErr("Enter the person's name.");
    if (!EMAIL_RE.test(email)) return setErr("Enter a valid email address.");
    if (loginFor.password.length < 8) return setErr("The password must be at least 8 characters. Use the Generate button.");
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("admin_create_user", {
      p_email: email,
      p_password: loginFor.password,
      p_full_name: loginFor.name.trim(),
      p_role: "RRT_MEMBER",
      p_phone: loginFor.team.mobile,
      p_team_id: loginFor.team.id,
    });
    setBusy(false);
    if (error) return setErr(cleanError(error));
    setShown({ email, password: loginFor.password });
    toast.push({ kind: "success", title: "Login created", body: `${loginFor.team.code} · ${email}` });
    setLoginFor(null);
    void load();
  }

  async function save() {
    if (!edit) return;
    setErr(null);
    if (!edit.code.trim() || !edit.name.trim()) return setErr("Team code and name are required.");
    const wantLogin = !edit.id && isSuper && !edit.is_simulated && edit.login_email.trim() !== "";
    if (wantLogin && !EMAIL_RE.test(edit.login_email.trim())) return setErr("The login email does not look right. Leave it empty to create the login later.");
    if (wantLogin && edit.login_password.length < 8) return setErr("The login password must be at least 8 characters. Use the Generate button.");
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
    let newTeamId: string | null = null;
    let res: { error: { message: string } | null };
    if (edit.id) {
      res = await sb.from("rrt_teams").update(base).eq("id", edit.id);
    } else {
      const ins = await sb.from("rrt_teams").insert({ ...base, code: edit.code.trim().toUpperCase(), is_simulated: edit.is_simulated }).select("id").single();
      res = ins;
      newTeamId = (ins.data as { id: string } | null)?.id ?? null;
    }
    if (res.error) {
      setBusy(false);
      const m = cleanError(res.error);
      return setErr(/duplicate|unique/i.test(m) ? "A team with this code already exists." : m);
    }
    // optional: create the phone login together with the team
    if (wantLogin && newTeamId) {
      const email = edit.login_email.trim().toLowerCase();
      const { error } = await sb.rpc("admin_create_user", {
        p_email: email,
        p_password: edit.login_password,
        p_full_name: edit.name.trim(),
        p_role: "RRT_MEMBER",
        p_phone: base.mobile,
        p_team_id: newTeamId,
      });
      setBusy(false);
      toast.push({ kind: "success", title: "Team added", body: edit.code.toUpperCase() });
      if (error) {
        toast.push({ kind: "error", title: "Team saved, but the login was not created", body: `${cleanError(error)} Use the Create login button on the team row.` });
      } else {
        setShown({ email, password: edit.login_password });
      }
      setEdit(null);
      void load();
      return;
    }
    setBusy(false);
    toast.push({ kind: "success", title: edit.id ? "Team saved" : "Team added", body: edit.code.toUpperCase() });
    setEdit(null);
    void load();
  }

  return (
    <div className="space-y-3" data-testid="admin-teams">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Rapid Response Teams. A team needs a login (see the Users tab) before its phone can sign in.</p>
        <Button onClick={() => { setErr(null); setEdit({ ...BLANK, login_password: makePassword() }); }} data-testid="add-team"><Plus className="h-4 w-4" /> Add team</Button>
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
                    <td className="px-3 py-2 text-slate-600">{t.region ?? <span className="text-amber-700">not set</span>}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {lg?.email ?? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-amber-700">no login</span>
                          {isSuper && !t.is_simulated && t.is_active && (
                            <Button tone="outline" className="px-2 py-0.5 text-xs" data-testid="create-team-login" aria-label={`Create login for ${t.code}`} onClick={() => { setErr(null); setLoginFor({ team: t, email: "", name: t.name, password: makePassword() }); }}>
                              <KeyRound className="h-3.5 w-3.5" /> Create login
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{t.is_simulated ? "simulated" : "real phone"}</span>
                      {!t.is_active && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">deactivated</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Edit ${t.code}`} onClick={() => { setErr(null); setEdit({ id: t.id, code: t.code, name: t.name, mobile: t.mobile ?? "", vehicle_plate: t.vehicle_plate ?? "", vehicle_model: t.vehicle_model ?? "", region: t.region ?? "", home_lat: t.home_lat === null ? "" : String(t.home_lat), home_lng: t.home_lng === null ? "" : String(t.home_lng), is_active: t.is_active, is_simulated: t.is_simulated, login_email: "", login_password: "" }); }}>
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
              <Field label="Region" hint="Pick one or type a new name, e.g. Lagos.">
                <input className={inputCls} list="team-regions" value={edit.region} onChange={(e) => setEdit({ ...edit, region: e.target.value })} placeholder="e.g. Lagos" aria-label="Region" />
                <datalist id="team-regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
                {regions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {regions.map((r) => (
                      <button key={r} type="button" onClick={() => setEdit({ ...edit, region: r })} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50">{r}</button>
                    ))}
                  </div>
                )}
                {edit.region.trim() !== "" && !regions.some((r) => r.toLowerCase() === edit.region.trim().toLowerCase()) && (
                  <p className="mt-1 text-xs font-medium text-emerald-700" data-testid="new-team-region-note">New region &ldquo;{edit.region.trim()}&rdquo; will be created.</p>
                )}
              </Field>
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
            {!edit.id && !edit.is_simulated && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="team-login-section">
                <p className="mb-2 text-sm font-medium text-slate-800">Phone login for this team</p>
                {isSuper ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">Optional. Fill this in and the login is created together with the team. Or leave the email empty and use the Create login button on the team row later.</p>
                    <Field label="Login email"><input className={inputCls} type="email" value={edit.login_email} onChange={(e) => setEdit({ ...edit, login_email: e.target.value })} placeholder="rrt11@pers.example" aria-label="Login email" /></Field>
                    {edit.login_email.trim() !== "" && (
                      <Field label="Starting password" hint="You will see it once after saving.">
                        <div className="flex gap-2">
                          <input className={inputCls} value={edit.login_password} onChange={(e) => setEdit({ ...edit, login_password: e.target.value })} aria-label="Login password" />
                          <Button tone="outline" type="button" onClick={() => setEdit({ ...edit, login_password: makePassword() })}><Wand2 className="h-4 w-4" /> Generate</Button>
                        </div>
                      </Field>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Only a Super Admin can create logins. Save the team, then ask a Super Admin to create its login.</p>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} aria-label="Active" /> Active (can receive incidents)
            </label>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!loginFor}
        title={loginFor ? `Create login for ${loginFor.team.code}` : "Create login"}
        onClose={() => setLoginFor(null)}
        footer={<><Button tone="outline" onClick={() => setLoginFor(null)}>Cancel</Button><Button onClick={createLogin} busy={busy} data-testid="save-team-login">Create login</Button></>}
      >
        {loginFor && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">This login signs in on the team&rsquo;s phone and is linked to {loginFor.team.code} · {loginFor.team.name}.</p>
            <Field label="Person's name"><input className={inputCls} value={loginFor.name} onChange={(e) => setLoginFor({ ...loginFor, name: e.target.value })} aria-label="Person's name" /></Field>
            <Field label="Email (used to sign in)"><input className={inputCls} type="email" value={loginFor.email} onChange={(e) => setLoginFor({ ...loginFor, email: e.target.value })} placeholder="rrt11@pers.example" aria-label="Login email for team" data-testid="team-login-email" /></Field>
            <Field label="Starting password" hint="Write it down or copy it. You will see it only once.">
              <div className="flex gap-2">
                <input className={inputCls} value={loginFor.password} onChange={(e) => setLoginFor({ ...loginFor, password: e.target.value })} aria-label="Starting password" />
                <Button tone="outline" type="button" onClick={() => setLoginFor({ ...loginFor, password: makePassword() })}><Wand2 className="h-4 w-4" /> Generate</Button>
              </div>
            </Field>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!shown} title="Sign-in details" onClose={() => setShown(null)} footer={<Button onClick={() => setShown(null)}>Done</Button>}>
        {shown && (
          <div className="space-y-3" data-testid="shown-team-credentials">
            <p className="text-sm text-slate-600">Give these to the team. For safety this window is the only place the password is shown.</p>
            <div className="rounded-lg bg-slate-50 p-3 font-mono text-sm">
              <div>Email: {shown.email}</div>
              <div>Password: {shown.password}</div>
            </div>
            <Button tone="outline" onClick={() => void navigator.clipboard?.writeText(`Email: ${shown.email}\nPassword: ${shown.password}`)}><Copy className="h-4 w-4" /> Copy</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
