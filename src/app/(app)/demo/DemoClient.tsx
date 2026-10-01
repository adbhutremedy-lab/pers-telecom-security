"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Bomb, MapPinPlus, Pause, Play, RotateCcw, Zap } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MAPBOX_TOKEN } from "@/lib/env";
import { buildPath, fetchRoute, pointAt, type Path } from "@/lib/demoSim";
import { cleanError, fmtAgo, fmtTime } from "@/lib/format";
import { useLiveData } from "@/hooks/useLiveData";
import { useNow } from "@/hooks/useNow";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, Field, Modal, PageHeader, TeamBadge, inputCls } from "@/components/ui";
import type { CustomQuestion, IncidentDetail, RrtLive } from "@/lib/types";

interface Cfg {
  acceptDelay: number; // seconds before a simulated team accepts
  rejectChance: number; // % of offers a simulated team rejects
  speed: number; // km/h while driving
  autoResolve: boolean;
  resolveDelay: number; // seconds on site before the form is submitted
}
const DEFAULT_CFG: Cfg = { acceptDelay: 6, rejectChance: 0, speed: 70, autoResolve: true, resolveDelay: 15 };
const CFG_KEY = "pers-demo-cfg-v1";

interface LogLine {
  id: number;
  at: string;
  kind: "info" | "ok" | "warn" | "err";
  text: string;
}

interface Drive {
  incidentId: string;
  path: Path;
  progress: number;
  last: number;
  lastEta: number;
}

export default function DemoClient() {
  const profile = useProfile();
  const toast = useToast();
  const { towers, active, teams } = useLiveData();
  const now = useNow(1000);

  const [cfg, setCfg] = useState<Cfg>(DEFAULT_CFG);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [demoTeam, setDemoTeam] = useState("");
  const [offset, setOffset] = useState(30);
  const [alsoTrigger, setAlsoTrigger] = useState(true);

  // settings remembered in this browser (optional convenience)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) setCfg({ ...DEFAULT_CFG, ...(JSON.parse(raw) as Partial<Cfg>) });
    } catch {
      /* ignore */
    }
  }, []);
  const update = (patch: Partial<Cfg>) =>
    setCfg((c) => {
      const next = { ...c, ...patch };
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const seq = useRef(0);
  const say = useCallback((text: string, kind: LogLine["kind"] = "info") => {
    setLog((l) => [{ id: ++seq.current, at: new Date().toISOString(), kind, text }, ...l].slice(0, 80));
  }, []);

  // ---- simulation memory (lives only in this browser tab) --------------------
  const plans = useRef(new Map<string, { action: "accept" | "reject"; due: number }>());
  const drives = useRef(new Map<string, Drive>());
  const reachedSeen = useRef(new Map<string, number>());
  const resolving = useRef(new Map<string, number>()); // incident -> last attempt
  const ticking = useRef(false);

  async function resolveSim(i: IncidentDetail, teamCode: string) {
    const sb = supabaseBrowser();
    const formId = i.form_id;
    let qs: CustomQuestion[] = [];
    {
      let q = sb.from("custom_questions").select("id, form_id, position, label, type, is_required, options, scale_min, scale_max, min_files, is_active").eq("is_active", true).order("position");
      if (formId) q = q.eq("form_id", formId);
      const { data } = await q;
      qs = (data as CustomQuestion[]) ?? [];
      if (!formId && qs.length) {
        // no form on the incident: use the default form's questions
        const { data: f } = await sb.from("custom_forms").select("id").eq("is_default", true).maybeSingle();
        if (f) qs = qs.filter((x) => x.form_id === f.id);
      }
    }

    const answers: { question_id: string; value: unknown }[] = [];
    for (const q of qs) {
      switch (q.type) {
        case "YES_NO":
          answers.push({ question_id: q.id, value: true });
          break;
        case "RATING":
          answers.push({ question_id: q.id, value: Math.max(q.scale_min ?? 1, (q.scale_max ?? 5) - Math.floor(Math.random() * 2)) });
          break;
        case "TEXT":
          answers.push({ question_id: q.id, value: "Simulated visit by the Demo Controller. Fault cleared and site secured." });
          break;
        case "DROPDOWN":
          answers.push({ question_id: q.id, value: q.options[Math.floor(Math.random() * q.options.length)] });
          break;
        case "MULTI_SELECT":
          answers.push({ question_id: q.id, value: [q.options[Math.floor(Math.random() * q.options.length)]] });
          break;
        case "PHOTO":
        case "FILE": {
          const need = Math.max(q.min_files, q.is_required ? 1 : 0);
          for (let n = 0; n < need; n++) {
            const blob = await makeJpeg(`SIMULATED SITE PHOTO\n${i.incident_number}\n${i.tower_number} · ${teamCode}\n${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`);
            const path = `${i.incident_number}/sim-${crypto.randomUUID()}.jpg`;
            const up = await sb.storage.from("incident-media").upload(path, blob, { contentType: "image/jpeg" });
            if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
            const ins = await sb.from("incident_photos").insert({
              incident_id: i.id,
              question_id: q.id,
              kind: "PHOTO",
              storage_path: path,
              file_name: "simulated-photo.jpg",
              mime_type: "image/jpeg",
              size_bytes: blob.size,
              uploaded_by: profile.id,
            });
            if (ins.error) throw new Error(ins.error.message);
          }
          break;
        }
      }
    }
    const { error } = await sb.rpc("resolve_incident", { p_incident_id: i.id, p_answers: answers });
    if (error) throw new Error(cleanError(error));
  }

  const tick = useCallback(async () => {
    if (ticking.current) return;
    ticking.current = true;
    try {
      const sb = supabaseBrowser();
      const c = cfgRef.current;
      const t0 = Date.now();

      const { data: teamData, error: teamErr } = await sb.from("v_rrt_live").select("*").eq("is_simulated", true).eq("is_active", true);
      if (teamErr) throw new Error(teamErr.message);
      const simTeams = (teamData as RrtLive[]) ?? [];
      const sim = new Map(simTeams.map((t) => [t.id, t]));

      const [offerRes, incRes] = await Promise.all([
        sb.from("v_incident_offers").select("id, team_id, team_code, incident_id, expires_at").eq("status", "PENDING"),
        sb.from("v_incident_detail").select("*").in("status", ["ASSIGNED", "REACHED"]),
      ]);
      const offers = (offerRes.data as { id: string; team_id: string; team_code: string; incident_id: string; expires_at: string }[]) ?? [];
      const incs = ((incRes.data as IncidentDetail[]) ?? []).filter((i) => i.assigned_team_id && sim.has(i.assigned_team_id));

      // 1. answer offers made to simulated teams ------------------------------------
      const pendingIds = new Set(offers.map((o) => o.id));
      for (const k of Array.from(plans.current.keys())) if (!pendingIds.has(k)) plans.current.delete(k);
      for (const o of offers) {
        if (!sim.has(o.team_id)) continue;
        let plan = plans.current.get(o.id);
        if (!plan) {
          const reject = Math.random() * 100 < c.rejectChance;
          const delay = Math.min(c.acceptDelay, 24) * 1000 * (reject ? 0.6 : 1) + Math.random() * 800;
          plan = { action: reject ? "reject" : "accept", due: t0 + delay };
          plans.current.set(o.id, plan);
        }
        if (t0 < plan.due) continue;
        plans.current.delete(o.id);
        if (new Date(o.expires_at).getTime() - t0 < 1200) continue; // too late, the database will move on
        if (plan.action === "accept") {
          const { error } = await sb.rpc("accept_offer", { p_assignment_id: o.id });
          if (error) say(`${o.team_code} could not accept: ${cleanError(error)}`, "warn");
          else say(`${o.team_code} accepted the alert`, "ok");
        } else {
          const { error } = await sb.rpc("reject_offer", { p_assignment_id: o.id, p_reason: "Simulated: team busy" });
          if (error) say(`${o.team_code} could not reject: ${cleanError(error)}`, "warn");
          else say(`${o.team_code} rejected the alert (simulated)`, "warn");
        }
      }

      // 2. drive assigned teams along the road ------------------------------------------
      const assignedTeamIds = new Set(incs.filter((i) => i.status === "ASSIGNED").map((i) => i.assigned_team_id as string));
      for (const k of Array.from(drives.current.keys())) if (!assignedTeamIds.has(k)) drives.current.delete(k);

      for (const i of incs) {
        const team = sim.get(i.assigned_team_id as string)!;
        if (i.status === "ASSIGNED") {
          if (team.lat == null || team.lng == null) continue;
          let d = drives.current.get(team.id);
          if (!d || d.incidentId !== i.id) {
            const r = await fetchRoute([team.lng, team.lat], [i.tower_lng, i.tower_lat], MAPBOX_TOKEN);
            const path = buildPath([...r.coords, [i.tower_lng, i.tower_lat]]);
            d = { incidentId: i.id, path, progress: 0, last: t0, lastEta: t0 };
            drives.current.set(team.id, d);
            const eta = Math.round(path.total / (c.speed / 3.6));
            const { error } = await sb.rpc("update_incident_route", { p_incident_id: i.id, p_eta_seconds: eta, p_distance_m: Math.round(path.total), p_geojson: { type: "LineString", coordinates: path.coords } });
            if (error) say(`Route not stored: ${cleanError(error)}`, "warn");
            say(`${team.code} leaves for ${i.tower_number}: ${(path.total / 1000).toFixed(1)} km, ${r.source === "mapbox" ? "road route" : "straight line (Mapbox route unavailable)"}`, "info");
          }
          const dt = Math.min(3, (t0 - d.last) / 1000);
          d.last = t0;
          d.progress += (c.speed / 3.6) * dt;
          const p = pointAt(d.path, d.progress);
          const { error } = await sb.rpc("post_location", { p_lat: p.lat, p_lng: p.lng, p_speed_kmh: p.done ? 0 : c.speed, p_heading: p.heading, p_accuracy_m: 8, p_team_id: team.id });
          if (error) say(`${team.code} GPS failed: ${cleanError(error)}`, "err");
          if (t0 - d.lastEta > 20000 && !p.done) {
            d.lastEta = t0;
            const left = Math.max(0, d.path.total - d.progress);
            await sb.rpc("update_incident_route", { p_incident_id: i.id, p_eta_seconds: Math.round(left / (c.speed / 3.6)), p_distance_m: Math.round(d.path.total), p_geojson: null });
          }
        } else if (i.status === "REACHED") {
          if (!reachedSeen.current.has(i.id)) {
            reachedSeen.current.set(i.id, t0);
            say(`${team.code} reached ${i.tower_number} (${i.incident_number})`, "ok");
          }
          if (!c.autoResolve) continue;
          const since = reachedSeen.current.get(i.id) as number;
          const lastTry = resolving.current.get(i.id) ?? 0;
          if (t0 - since >= c.resolveDelay * 1000 && t0 - lastTry > 10000) {
            resolving.current.set(i.id, t0);
            try {
              await resolveSim(i, team.code);
              say(`${team.code} submitted the resolution form: ${i.incident_number} resolved`, "ok");
              reachedSeen.current.delete(i.id);
            } catch (e) {
              say(`Could not auto-resolve ${i.incident_number}: ${(e as Error).message}`, "err");
            }
          }
        }
      }
    } catch (e) {
      say(`Controller error: ${(e as Error).message}`, "err");
    } finally {
      ticking.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);

  useEffect(() => {
    if (!running) return;
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(id);
  }, [running, tick]);

  // ---- one-off actions --------------------------------------------------------------
  const free = useMemo(() => {
    const busyTowers = new Set(active.map((i) => i.tower_id));
    return towers.filter((t) => t.status === "ACTIVE" && !busyTowers.has(t.id));
  }, [towers, active]);

  async function triggerRandom() {
    if (free.length === 0) return toast.push({ kind: "warning", title: "Every active tower already has an incident" });
    const t = free[Math.floor(Math.random() * free.length)];
    setBusy("random");
    const { data, error } = await supabaseBrowser().rpc("trigger_incident", { p_tower_id: t.id, p_source: "MAP_MENU", p_notes: "Triggered by the Demo Controller" });
    setBusy(null);
    if (error) return toast.push({ kind: "error", title: "Could not trigger", body: cleanError(error) });
    const r = data as { incident_number: string; dispatch_result?: string };
    say(`Incident ${r.incident_number} triggered at ${t.tower_number} ${t.site_name} (${r.dispatch_result})`, "info");
  }

  async function demoTower() {
    const team = teams.find((t) => t.id === demoTeam);
    if (!team || team.lat == null || team.lng == null) return toast.push({ kind: "warning", title: "Pick a team that has a GPS position" });
    setBusy("tower");
    const sb = supabaseBrowser();
    const { data, error } = await sb.rpc("create_demo_tower", { p_lat: team.lat, p_lng: team.lng, p_offset_m: offset });
    if (error) {
      setBusy(null);
      return toast.push({ kind: "error", title: "Could not create the tower", body: cleanError(error) });
    }
    const tower = data as { id: string; tower_number: string };
    say(`Demo tower ${tower.tower_number} created ${offset} m from ${team.code}`, "ok");
    if (alsoTrigger) {
      const r = await sb.rpc("trigger_incident", { p_tower_id: tower.id, p_source: "MAP_MENU", p_notes: "Demo tower incident" });
      if (r.error) say(`Could not trigger at the demo tower: ${cleanError(r.error)}`, "err");
      else say(`Incident ${(r.data as { incident_number: string }).incident_number} triggered at ${tower.tower_number}`, "info");
    }
    setBusy(null);
  }

  async function reset() {
    setBusy("reset");
    const { data, error } = await supabaseBrowser().rpc("reset_demo");
    setBusy(null);
    setConfirmReset(false);
    if (error) return toast.push({ kind: "error", title: "Reset failed", body: cleanError(error) });
    plans.current.clear();
    drives.current.clear();
    reachedSeen.current.clear();
    resolving.current.clear();
    const r = data as { incidents_removed: number; demo_towers_removed: number };
    say(`Demo reset: ${r.incidents_removed} incident(s) and ${r.demo_towers_removed} demo tower(s) removed; simulated teams are back at base`, "ok");
    toast.push({ kind: "success", title: "Demo reset", body: "Seeded history is kept." });
  }

  async function toggleTeam(t: RrtLive) {
    const { error } = await supabaseBrowser().rpc("set_team_online", { p_online: !t.is_online_enabled, p_team_id: t.id });
    if (error) toast.push({ kind: "error", title: "Could not change the team", body: cleanError(error) });
  }

  const simTeams = teams.filter((t) => t.is_simulated);

  return (
    <div className="space-y-4 p-3 lg:p-5">
      <PageHeader title="Demo Controller" subtitle="Drives the 9 simulated teams so the customer sees a live, moving fleet. The real phone (RRT-01) is never touched." />

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Autopilot</h2>
              <p className="text-sm text-slate-500">Simulated teams accept alerts, drive along real roads, reach the tower and submit the resolution form.</p>
            </div>
            <Button tone={running ? "danger" : "primary"} onClick={() => { setRunning((r) => !r); say(running ? "Autopilot stopped" : "Autopilot started", "info"); }} className="px-5 py-2.5 text-base">
              {running ? <><Pause className="h-5 w-5" /> Stop autopilot</> : <><Play className="h-5 w-5" /> Start autopilot</>}
            </Button>
          </div>
          <p className={clsx("rounded-lg px-3 py-2 text-sm", running ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800")} role="status">
            {running ? "Autopilot is RUNNING. Keep this tab open: the simulation lives in this browser page." : "Autopilot is OFF. Simulated teams stay parked and will not answer alerts (the database still keeps them online)."}
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Num label="Accept an alert after (seconds)" min={1} max={24} value={cfg.acceptDelay} onChange={(v) => update({ acceptDelay: v })} hint="Must be under 30" />
            <Num label="Reject chance (%)" min={0} max={100} value={cfg.rejectChance} onChange={(v) => update({ rejectChance: v })} hint="Shows escalation to the next team" />
            <Num label="Driving speed (km/h)" min={10} max={200} value={cfg.speed} onChange={(v) => update({ speed: v })} hint="Faster than real, so the demo is short" />
            <Num label="Resolve after (seconds on site)" min={3} max={300} value={cfg.resolveDelay} onChange={(v) => update({ resolveDelay: v })} />
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={cfg.autoResolve} onChange={(e) => update({ autoResolve: e.target.checked })} className="h-4 w-4" /> Auto-resolve with a simulated photo
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
          <Button className="w-full" onClick={triggerRandom} busy={busy === "random"}>
            <Zap className="h-4 w-4" /> Trigger a random incident
          </Button>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><MapPinPlus className="h-4 w-4" /> Demo tower next to a team</p>
            <p className="mb-2 text-xs text-slate-500">Creates a tower a few metres from the chosen team (use your real phone), so it reaches the site seconds after accepting.</p>
            <Field label="Team">
              <select className={inputCls} value={demoTeam} onChange={(e) => setDemoTeam(e.target.value)}>
                <option value="">Choose…</option>
                {teams.filter((t) => t.lat != null).map((t) => (
                  <option key={t.id} value={t.id}>{t.code} {t.name}{t.is_simulated ? "" : " (real phone)"}</option>
                ))}
              </select>
            </Field>
            <div className="mt-2">
              <Field label="Distance north of the team (metres)" hint="30 m is inside the 50 m arrival radius">
                <input type="number" className={inputCls} min={0} max={5000} value={offset} onChange={(e) => setOffset(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={alsoTrigger} onChange={(e) => setAlsoTrigger(e.target.checked)} className="h-4 w-4" /> Trigger an incident there now
            </label>
            <Button tone="outline" className="mt-3 w-full" onClick={demoTower} busy={busy === "tower"} disabled={!demoTeam}>
              Create demo tower
            </Button>
          </div>

          <Button tone="outline" className="w-full" onClick={() => setConfirmReset(true)}>
            <RotateCcw className="h-4 w-4" /> Reset demo
          </Button>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Simulated teams ({simTeams.length})</h2>
          <ul className="divide-y divide-slate-100">
            {simTeams.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="w-16 text-sm font-semibold">{t.code}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{t.incident_number ? `${t.incident_number} · ${t.tower_number}` : t.name} · {fmtAgo(t.last_seen_at, now)}</span>
                <TeamBadge status={t.live_status} />
                <Button tone="ghost" className="px-2 py-1 text-xs" disabled={!!t.current_incident_id} onClick={() => toggleTeam(t)}>
                  {t.is_online_enabled ? "Take offline" : "Bring online"}
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-900"><Bomb className="h-5 w-5 text-slate-400" /> Activity log</h2>
          <ul className="max-h-96 space-y-1 overflow-auto font-mono text-xs" aria-live="polite">
            {log.length === 0 && <li className="text-slate-400">Nothing yet. Start the autopilot or trigger an incident.</li>}
            {log.map((l) => (
              <li key={l.id} className={clsx(l.kind === "err" && "text-red-700", l.kind === "warn" && "text-amber-700", l.kind === "ok" && "text-green-700", l.kind === "info" && "text-slate-700")}>
                <span className="text-slate-400">{fmtTime(l.at)}</span> {l.text}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Modal
        open={confirmReset}
        title="Reset the demo?"
        onClose={() => setConfirmReset(false)}
        footer={<><Button tone="outline" onClick={() => setConfirmReset(false)}>Keep as is</Button><Button tone="danger" onClick={reset} busy={busy === "reset"}>Reset demo</Button></>}
      >
        <p className="text-sm text-slate-600">
          Removes every incident created during the demo (and demo towers), puts all simulated teams back at their base and frees every team. The 54 seeded historical incidents are kept.
        </p>
      </Modal>
    </div>
  );
}

function Num({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" className={inputCls} min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
    </Field>
  );
}

async function makeJpeg(text: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 640;
  c.height = 400;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas is not available");
  const grad = g.createLinearGradient(0, 0, 640, 400);
  grad.addColorStop(0, "#12284a");
  grad.addColorStop(1, "#1d4ed8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 640, 400);
  g.strokeStyle = "rgba(255,255,255,.25)";
  g.lineWidth = 2;
  for (let x = 0; x < 640; x += 40) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 400);
    g.stroke();
  }
  g.fillStyle = "#fff";
  g.font = "bold 30px system-ui, sans-serif";
  text.split("\n").forEach((line, i) => g.fillText(line, 28, 120 + i * 48));
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/jpeg", 0.8));
}
