"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Ban, CheckCheck, FileText, MapPinned, Shuffle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { useNow } from "@/hooks/useNow";
import { useToast } from "@/components/Toast";
import { Button, EmptyState, Field, IncidentBadge, Modal, Spinner, TeamBadge, inputCls } from "@/components/ui";
import LiveMap from "@/components/LiveMap";
import { downloadBlob, exportIncidentPdf } from "@/lib/reports/export";
import { cleanError, fmtDateTime, fmtDistance, fmtDuration, fmtTime, haversineKm } from "@/lib/format";
import type { IncidentAnswer, IncidentDetail, IncidentOffer, IncidentPhoto, RrtLive, Tower } from "@/lib/types";

type Dialog = null | "cancel" | "reassign";

export default function IncidentDetailClient({ id }: { id: string }) {
  const toast = useToast();
  const now = useNow(1000);
  const [inc, setInc] = useState<IncidentDetail | null>(null);
  const [offers, setOffers] = useState<IncidentOffer[]>([]);
  const [answers, setAnswers] = useState<IncidentAnswer[]>([]);
  const [photos, setPhotos] = useState<(IncidentPhoto & { url?: string })[]>([]);
  const [teams, setTeams] = useState<RrtLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [pickTeam, setPickTeam] = useState<string>("auto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [i, o, a, p, t] = await Promise.all([
      sb.from("v_incident_detail").select("*").eq("id", id).maybeSingle(),
      sb.from("v_incident_offers").select("*").eq("incident_id", id).order("sequence_no"),
      sb.from("incident_answers").select("*").eq("incident_id", id).order("answered_at"),
      sb.from("incident_photos").select("id, incident_id, question_id, kind, storage_path, file_name, mime_type, created_at").eq("incident_id", id).order("created_at"),
      sb.from("v_rrt_live").select("*").eq("is_active", true).order("code"),
    ]);
    if (!i.data) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setInc(i.data as IncidentDetail);
    setOffers((o.data as IncidentOffer[]) ?? []);
    setAnswers((a.data as IncidentAnswer[]) ?? []);
    setTeams((t.data as RrtLive[]) ?? []);

    const list = (p.data as IncidentPhoto[]) ?? [];
    if (list.length) {
      const { data: signed } = await sb.storage.from("incident-media").createSignedUrls(list.map((x) => x.storage_path), 3600);
      const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      setPhotos(list.map((x) => ({ ...x, url: byPath.get(x.storage_path) ?? undefined })));
    } else {
      setPhotos([]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtimeRefetch(["incidents", "incident_assignments", "incident_photos", "rrt_teams"], load, { intervalMs: 10000 });

  const tower: Tower | null = useMemo(
    () =>
      inc
        ? { id: inc.tower_id, tower_number: inc.tower_number, site_name: inc.tower_name, lat: inc.tower_lat, lng: inc.tower_lng, region: inc.region ?? "", status: inc.tower_status, address: null, deleted_at: null }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inc?.tower_id, inc?.tower_number, inc?.tower_name, inc?.tower_lat, inc?.tower_lng, inc?.region, inc?.tower_status],
  );
  const mapTeams = useMemo(() => teams.filter((t) => inc && (t.id === inc.assigned_team_id || t.id === inc.pending_team_id)), [teams, inc]);
  const isActive = inc ? inc.status === "OPEN" || inc.status === "ASSIGNED" || inc.status === "REACHED" : false;
  const mapTowers = useMemo(() => (tower ? [tower] : []), [tower]);
  const mapActive = useMemo(() => new Set(isActive && tower ? [tower.id] : []), [isActive, tower]);
  const mapIncidents = useMemo(() => (isActive && inc ? [inc] : []), [isActive, inc]);
  const mapFocus = useMemo(() => (tower ? { lat: tower.lat, lng: tower.lng, zoom: 13, key: tower.id } : null), [tower]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    setErr(null);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      setErr(cleanError(error));
      return false;
    }
    toast.push({ kind: "success", title: ok });
    setDialog(null);
    setReason("");
    void load();
    return true;
  }

  const sb = supabaseBrowser;
  const doCancel = () => run(() => sb().rpc("cancel_incident", { p_incident_id: id, p_reason: reason.trim() || null }), "Incident cancelled");
  const doReassign = () => run(() => sb().rpc("reassign_incident", { p_incident_id: id, p_team_id: pickTeam === "auto" ? null : pickTeam }), "Incident reassigned");
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const { blob, name } = await exportIncidentPdf(id);
      downloadBlob(blob, name);
    } catch (e) {
      toast.push({ kind: "error", title: "Could not create the PDF", body: cleanError(e) });
    } finally {
      setPdfBusy(false);
    }
  };
  const doReached = () => run(() => sb().rpc("mark_reached", { p_incident_id: id }), "Arrival recorded");

  if (loading) return <div className="grid place-items-center p-16"><Spinner /></div>;
  if (missing || !inc || !tower) {
    return (
      <div className="p-4">
        <BackLink />
        <EmptyState title="Incident not found" hint="It may have been removed, or you may not have access to it." />
      </div>
    );
  }

  const candidates = teams
    .filter((t) => t.live_status === "AVAILABLE" && !t.current_incident_id && t.lat != null && t.lng != null)
    .map((t) => ({ t, km: haversineKm(t.lat as number, t.lng as number, inc.tower_lat, inc.tower_lng) }))
    .sort((a, b) => a.km - b.km);

  const left = inc.pending_expires_at ? Math.max(0, Math.ceil((new Date(inc.pending_expires_at).getTime() - now) / 1000)) : null;

  return (
    <div className="space-y-4 p-3 lg:p-5">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-900">{inc.incident_number}</h1>
            <IncidentBadge status={inc.status} />
            {inc.status === "OPEN" && inc.dispatch_state === "EXHAUSTED" && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">NO TEAM AVAILABLE</span>}
            {inc.is_demo_seed && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">demo history</span>}
          </div>
          <p className="mt-1 text-slate-600">
            <Link href={`/dashboard?tower=${inc.tower_id}`} className="font-medium text-brand-700 hover:underline">
              {inc.tower_number}
            </Link>{" "}
            · {inc.tower_name} · {inc.region}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="outline" onClick={downloadPdf} busy={pdfBusy} data-testid="incident-pdf">
            <FileText className="h-4 w-4" /> PDF report
          </Button>
        {isActive && (
          <>
            {inc.status === "ASSIGNED" && (
              <Button tone="outline" onClick={doReached} busy={busy}>
                <MapPinned className="h-4 w-4" /> Mark reached
              </Button>
            )}
            <Button tone="outline" onClick={() => { setErr(null); setPickTeam("auto"); setDialog("reassign"); }}>
              <Shuffle className="h-4 w-4" /> Reassign
            </Button>
            <Button tone="danger" onClick={() => { setErr(null); setDialog("cancel"); }}>
              <Ban className="h-4 w-4" /> Cancel incident
            </Button>
          </>
        )}
        </div>
      </div>
      {err && !dialog && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* live status */}
          {isActive && (
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Live status</h2>
              {inc.status === "OPEN" && inc.pending_team_code && (
                <p className="text-slate-800">
                  Alert sent to <strong>{inc.pending_team_code} {inc.pending_team_name}</strong>. Waiting for an answer: <strong className="tabular-nums text-amber-700">{left}s</strong> left.
                </p>
              )}
              {inc.status === "OPEN" && inc.dispatch_state === "EXHAUSTED" && (
                <p className="text-red-700">No team is available. The system retries automatically (round {inc.dispatch_round}); you can also use “Reassign” to pick a team yourself.</p>
              )}
              {inc.status === "ASSIGNED" && (
                <p className="text-slate-800">
                  <strong>{inc.team_code} {inc.team_name}</strong> is on the way: {fmtDistance(inc.distance_remaining_m)} left, ETA {fmtDuration(inc.eta_seconds)}
                  {inc.team_last_seen_at && <span className="text-slate-500"> (GPS at {fmtTime(inc.team_last_seen_at)})</span>}.
                </p>
              )}
              {inc.status === "REACHED" && (
                <p className="text-slate-800"><strong>{inc.team_code} {inc.team_name}</strong> is on site since {fmtTime(inc.reached_at)}{inc.reached_manually ? " (arrival recorded by an operator)" : ""}. Waiting for the resolution report.</p>
              )}
            </section>
          )}

          {/* timeline */}
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Timeline</h2>
            <ol className="space-y-3">
              <Step done label="Triggered" at={inc.triggered_at} sub={inc.triggered_by_name ? `by ${inc.triggered_by_name}` : undefined} />
              <Step done={!!inc.accepted_at} label="Accepted by team" at={inc.accepted_at} sub={inc.accept_seconds != null ? `${fmtDuration(inc.accept_seconds)} after trigger` : undefined} />
              <Step done={!!inc.reached_at} label="Reached tower" at={inc.reached_at} sub={inc.response_seconds != null ? `Response time ${fmtDuration(inc.response_seconds)}${inc.travel_seconds != null ? ` · travel ${fmtDuration(inc.travel_seconds)}` : ""}` : undefined} />
              <Step done={!!inc.resolved_at} label="Resolved" at={inc.resolved_at} sub={inc.resolution_seconds != null ? `Resolution time ${fmtDuration(inc.resolution_seconds)}${inc.onsite_seconds != null ? ` · on site ${fmtDuration(inc.onsite_seconds)}` : ""}` : undefined} />
              {inc.status === "CANCELLED" && <Step done tone="red" label="Cancelled" at={inc.cancelled_at} sub={inc.cancel_reason ?? undefined} />}
            </ol>
            {inc.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Notes: {inc.notes}</p>}
          </section>

          {/* offers chain */}
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Alerts sent to teams ({offers.length})</h2>
            {offers.length === 0 ? (
              <p className="text-sm text-slate-500">No team has been alerted yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Team</th>
                      <th className="py-2 pr-3">Distance</th>
                      <th className="py-2 pr-3">Sent</th>
                      <th className="py-2 pr-3">Result</th>
                      <th className="py-2 text-right">Answered in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {offers.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 pr-3 tabular-nums">{o.sequence_no}</td>
                        <td className="py-2 pr-3 font-medium">{o.team_code} <span className="font-normal text-slate-500">{o.team_name}</span>{o.manual && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600">manual</span>}</td>
                        <td className="py-2 pr-3 tabular-nums">{o.distance_km.toFixed(1)} km</td>
                        <td className="py-2 pr-3 text-slate-600">{fmtTime(o.offered_at)}</td>
                        <td className="py-2 pr-3"><OfferResult status={o.status} reason={o.response_reason} /></td>
                        <td className="py-2 text-right tabular-nums">{o.status === "PENDING" ? "…" : fmtDuration(o.response_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* resolution report */}
          {(answers.length > 0 || photos.length > 0) && (
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Resolution report</h2>
              <dl className="divide-y divide-slate-100">
                {answers.map((a) => (
                  <div key={a.id} className="grid gap-1 py-2 sm:grid-cols-3">
                    <dt className="text-sm text-slate-500">{a.question_label}</dt>
                    <dd className="text-sm font-medium text-slate-900 sm:col-span-2">{showValue(a)}</dd>
                  </div>
                ))}
              </dl>
              {photos.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-slate-500">Photos and files ({photos.length})</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {photos.map((p) =>
                      p.url && p.mime_type.startsWith("image/") ? (
                        <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-slate-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt={p.file_name ?? "Site photo"} className="h-32 w-full object-cover" loading="lazy" />
                        </a>
                      ) : (
                        <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="grid h-32 place-items-center rounded-lg bg-slate-50 p-2 text-center text-xs text-slate-600 ring-1 ring-slate-200">
                          {p.file_name ?? p.storage_path}
                        </a>
                      ),
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* right column */}
        <div className="space-y-4">
          <section className="h-72 overflow-hidden rounded-xl bg-slate-200 shadow-sm ring-1 ring-slate-200">
            <LiveMap
              towers={mapTowers}
              activeTowerIds={mapActive}
              teams={mapTeams}
              incidents={mapIncidents}
              focus={mapFocus}
            />
          </section>
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Assigned team</h2>
            {inc.team_code ? (
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-slate-900">{inc.team_code} · {inc.team_name}</p>
                {inc.team_mobile && <p className="text-slate-600">{inc.team_mobile}</p>}
                {teams.find((t) => t.id === inc.assigned_team_id) && <TeamBadge status={teams.find((t) => t.id === inc.assigned_team_id)!.live_status} />}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No team assigned yet.</p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Mini k="Dispatch rounds" v={String(inc.dispatch_round)} />
              <Mini k="Triggered" v={fmtDateTime(inc.triggered_at)} />
              <Mini k="Road distance" v={fmtDistance(inc.route_distance_m)} />
              <Mini k="Source" v={inc.source === "MAP_MENU" ? "Map" : inc.source === "CREATE_FORM" ? "Create form" : "API"} />
            </dl>
          </section>
        </div>
      </div>

      <Modal
        open={dialog === "cancel"}
        title="Cancel incident"
        onClose={() => setDialog(null)}
        footer={<><Button tone="outline" onClick={() => setDialog(null)} disabled={busy}>Keep incident</Button><Button tone="danger" onClick={doCancel} busy={busy}>Cancel incident</Button></>}
      >
        <p className="mb-3 text-sm text-slate-600">The assigned team (if any) is released and told the incident was cancelled.</p>
        <Field label="Reason">
          <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. False alarm confirmed by NOC" maxLength={300} />
        </Field>
        {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      </Modal>

      <Modal
        open={dialog === "reassign"}
        title="Reassign incident"
        onClose={() => setDialog(null)}
        footer={<><Button tone="outline" onClick={() => setDialog(null)} disabled={busy}>Close</Button><Button onClick={doReassign} busy={busy}>Reassign</Button></>}
      >
        <p className="mb-3 text-sm text-slate-600">The current team is released and a new round starts. Choose who is alerted.</p>
        <div className="space-y-2" role="radiogroup" aria-label="Who should be alerted">
          <Choice checked={pickTeam === "auto"} onSelect={() => setPickTeam("auto")} title="Automatic" sub="Alert the nearest available team (previous teams are skipped)" />
          {candidates.map(({ t, km }) => (
            <Choice key={t.id} checked={pickTeam === t.id} onSelect={() => setPickTeam(t.id)} title={`${t.code} · ${t.name}`} sub={`${km.toFixed(1)} km from the tower${t.is_simulated ? " · simulated" : ""}`} />
          ))}
          {candidates.length === 0 && <p className="text-sm text-slate-500">No team is online and free right now.</p>}
        </div>
        {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
      <ArrowLeft className="h-4 w-4" /> All incidents
    </Link>
  );
}

function Step({ done, label, at, sub, tone }: { done: boolean; label: string; at?: string | null; sub?: string; tone?: "red" }) {
  return (
    <li className="flex gap-3">
      <span className={clsx("mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full", done ? (tone === "red" ? "bg-red-600" : "bg-green-600") : "bg-slate-200")}>
        {done && <CheckCheck className="h-3 w-3 text-white" />}
      </span>
      <div>
        <p className={clsx("text-sm font-medium", done ? "text-slate-900" : "text-slate-400")}>
          {label}
          {done && at && <span className="ml-2 font-normal text-slate-500">{fmtDateTime(at)}</span>}
        </p>
        {done && sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
    </li>
  );
}

function OfferResult({ status, reason }: { status: IncidentOffer["status"]; reason: string | null }) {
  const tone: Record<IncidentOffer["status"], string> = {
    PENDING: "bg-amber-100 text-amber-800",
    ACCEPTED: "bg-green-100 text-green-800",
    REJECTED: "bg-red-100 text-red-800",
    EXPIRED: "bg-slate-200 text-slate-700",
    CANCELLED: "bg-slate-100 text-slate-600",
  };
  const text: Record<IncidentOffer["status"], string> = { PENDING: "Waiting", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "No answer", CANCELLED: "Cancelled" };
  return (
    <span title={reason ?? undefined} className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", tone[status])}>
      {text[status]}
    </span>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-900">{v}</dd>
    </div>
  );
}

function Choice({ checked, onSelect, title, sub }: { checked: boolean; onSelect: () => void; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className={clsx("flex w-full items-start gap-3 rounded-lg border p-3 text-left", checked ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
      <span className={clsx("mt-1 h-4 w-4 shrink-0 rounded-full border-2", checked ? "border-brand-600 bg-brand-600 ring-2 ring-white ring-inset" : "border-slate-300")} />
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </button>
  );
}

function showValue(a: IncidentAnswer): string {
  const v = a.value;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  if (v === null || v === undefined) return "—";
  return String(v);
}
