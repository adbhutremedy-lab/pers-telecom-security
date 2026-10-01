"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Pencil, Plus, Wand2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, Field, Modal, Spinner, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";
import type { RoleCode } from "@/lib/types";

interface UserRow {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  rrt_team_id: string | null;
  is_active: boolean;
  roles: { code: RoleCode } | { code: RoleCode }[] | null;
}
interface TeamLite {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}
const ROLE_LABEL: Record<RoleCode, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrator",
  OPERATOR: "Control-room operator",
  RRT_MEMBER: "RRT member (phone)",
};
const roleOf = (u: UserRow): RoleCode => (Array.isArray(u.roles) ? u.roles[0]?.code : u.roles?.code) ?? "OPERATOR";

/** Readable password: no look-alike characters (0/O, 1/l/I). */
export function makePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY346789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

interface EditState {
  id?: string;
  email: string;
  full_name: string;
  phone: string;
  role: RoleCode;
  team_id: string;
  is_active: boolean;
  password: string;
}
const BLANK: EditState = { email: "", full_name: "", phone: "", role: "OPERATOR", team_id: "", is_active: true, password: "" };

export default function UsersAdmin() {
  const toast = useToast();
  const me = useProfile();
  const isSuper = me.role === "SUPER_ADMIN";
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pwFor, setPwFor] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState("");
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [u, t] = await Promise.all([
      sb.from("users").select("id, email, full_name, phone, rrt_team_id, is_active, roles ( code )").order("full_name"),
      sb.from("rrt_teams").select("id, code, name, is_active").order("code"),
    ]);
    if (u.error) toast.push({ kind: "error", title: "Could not load users", body: cleanError(u.error) });
    setRows((u.data ?? []) as unknown as UserRow[]);
    setTeams((t.data ?? []) as TeamLite[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const teamLabel = (id: string | null) => {
    const t = teams.find((x) => x.id === id);
    return t ? `${t.code} · ${t.name}` : "–";
  };
  /** An RRT login may only be linked to a team that has no other active login. */
  const freeTeams = (current?: string) =>
    teams.filter((t) => t.is_active && (t.id === current || !(rows ?? []).some((u) => u.is_active && u.rrt_team_id === t.id)));

  function canEdit(u: UserRow) {
    if (isSuper) return true;
    const r = roleOf(u);
    return r === "OPERATOR" || r === "RRT_MEMBER";
  }

  async function save() {
    if (!edit) return;
    setErr(null);
    if (!edit.full_name.trim()) return setErr("Full name is required.");
    if (edit.role === "RRT_MEMBER" && !edit.team_id) return setErr("Choose the response team this phone login belongs to.");
    const sb = supabaseBrowser();
    setBusy(true);
    if (!edit.id) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(edit.email.trim())) {
        setBusy(false);
        return setErr("Enter a valid email address.");
      }
      if (edit.password.length < 8) {
        setBusy(false);
        return setErr("The password must be at least 8 characters. Use the Generate button.");
      }
      const { error } = await sb.rpc("admin_create_user", {
        p_email: edit.email.trim().toLowerCase(),
        p_password: edit.password,
        p_full_name: edit.full_name.trim(),
        p_role: edit.role,
        p_phone: edit.phone.trim() || null,
        p_team_id: edit.role === "RRT_MEMBER" ? edit.team_id : null,
      });
      setBusy(false);
      if (error) return setErr(cleanError(error));
      setShown({ email: edit.email.trim().toLowerCase(), password: edit.password });
      toast.push({ kind: "success", title: "Login created", body: edit.full_name.trim() });
    } else {
      const { error } = await sb.rpc("admin_update_user", {
        p_user_id: edit.id,
        p_full_name: edit.full_name.trim(),
        p_phone: edit.phone.trim() || null,
        p_role: edit.role,
        p_team_id: edit.role === "RRT_MEMBER" ? edit.team_id || null : null,
        p_is_active: edit.is_active,
      });
      setBusy(false);
      if (error) return setErr(cleanError(error));
      toast.push({ kind: "success", title: "User saved", body: edit.full_name.trim() });
    }
    setEdit(null);
    void load();
  }

  async function resetPassword() {
    if (!pwFor) return;
    if (newPw.length < 8) return setErr("The password must be at least 8 characters.");
    setErr(null);
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("admin_set_password", { p_user_id: pwFor.id, p_password: newPw });
    setBusy(false);
    if (error) return setErr(cleanError(error));
    setShown({ email: pwFor.email ?? "", password: newPw });
    toast.push({ kind: "success", title: "Password changed", body: pwFor.email ?? "" });
    setPwFor(null);
  }

  return (
    <div className="space-y-3" data-testid="admin-users">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {isSuper
            ? "People who can sign in. You are a Super Admin, so you can create logins, reset passwords and change roles."
            : "People who can sign in. Only a Super Admin can create logins, reset passwords or change roles; you can edit names, phones and team links."}
        </p>
        {isSuper && (
          <Button onClick={() => { setErr(null); setEdit({ ...BLANK, password: makePassword() }); }} data-testid="add-user"><Plus className="h-4 w-4" /> Add login</Button>
        )}
      </div>
      {rows === null ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-slate-100" data-testid="user-row">
                  <td className="px-3 py-2 font-medium">{u.full_name}{u.id === me.id && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{u.email}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[roleOf(u)]}</td>
                  <td className="px-3 py-2 text-slate-600">{roleOf(u) === "RRT_MEMBER" ? teamLabel(u.rrt_team_id) : "–"}</td>
                  <td className="px-3 py-2">
                    {u.is_active ? <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-800">active</span> : <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">deactivated</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canEdit(u) && (
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Edit ${u.email}`} onClick={() => { setErr(null); setEdit({ id: u.id, email: u.email ?? "", full_name: u.full_name, phone: u.phone ?? "", role: roleOf(u), team_id: u.rrt_team_id ?? "", is_active: u.is_active, password: "" }); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {isSuper && (
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Reset password for ${u.email}`} data-testid="reset-pw" onClick={() => { setErr(null); setNewPw(makePassword()); setPwFor(u); }}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!edit}
        title={edit?.id ? "Edit user" : "Add login"}
        onClose={() => setEdit(null)}
        footer={<><Button tone="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} busy={busy} data-testid="save-user">{edit?.id ? "Save" : "Create login"}</Button></>}
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Full name"><input className={inputCls} value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} aria-label="Full name" /></Field>
            <Field label="Email (used to sign in)"><input className={inputCls} type="email" value={edit.email} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, email: e.target.value })} aria-label="Email" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone"><input className={inputCls} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} aria-label="Phone" /></Field>
              <Field label="Role">
                <select className={inputCls} value={edit.role} disabled={!isSuper} onChange={(e) => setEdit({ ...edit, role: e.target.value as RoleCode })} aria-label="Role">
                  {(Object.keys(ROLE_LABEL) as RoleCode[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>
            </div>
            {edit.role === "RRT_MEMBER" && (
              <Field label="Response team" hint="Each team can have one active phone login.">
                <select className={inputCls} value={edit.team_id} onChange={(e) => setEdit({ ...edit, team_id: e.target.value })} aria-label="Response team">
                  <option value="">Choose a team…</option>
                  {freeTeams(edit.team_id || undefined).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                </select>
              </Field>
            )}
            {!edit.id && (
              <Field label="Starting password" hint="Write it down or copy it. You will see it only once.">
                <div className="flex gap-2">
                  <input className={inputCls} value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} aria-label="Starting password" />
                  <Button tone="outline" type="button" onClick={() => setEdit({ ...edit, password: makePassword() })}><Wand2 className="h-4 w-4" /> Generate</Button>
                </div>
              </Field>
            )}
            {edit.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={edit.is_active} disabled={edit.id === me.id} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} aria-label="Active" /> Active (can sign in)
              </label>
            )}
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!pwFor}
        title="Reset password"
        onClose={() => setPwFor(null)}
        footer={<><Button tone="outline" onClick={() => setPwFor(null)}>Cancel</Button><Button onClick={resetPassword} busy={busy} data-testid="save-pw">Change password</Button></>}
      >
        {pwFor && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">New password for <b>{pwFor.full_name}</b> ({pwFor.email}).</p>
            <div className="flex gap-2">
              <input className={inputCls} value={newPw} onChange={(e) => setNewPw(e.target.value)} aria-label="New password" />
              <Button tone="outline" type="button" onClick={() => setNewPw(makePassword())}><Wand2 className="h-4 w-4" /> Generate</Button>
            </div>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!shown} title="Sign-in details" onClose={() => setShown(null)} footer={<Button onClick={() => setShown(null)}>Done</Button>}>
        {shown && (
          <div className="space-y-3" data-testid="shown-credentials">
            <p className="text-sm text-slate-600">Give these to the person. For safety this window is the only place the password is shown.</p>
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
