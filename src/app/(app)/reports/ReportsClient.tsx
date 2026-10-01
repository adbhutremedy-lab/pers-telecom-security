"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import StatTile from "@/components/StatTile";
import { Button, EmptyState, Field, IncidentBadge, PageHeader, Spinner, inputCls } from "@/components/ui";
import { BarList, ColumnChart, StatusBar } from "@/components/reports/Charts";
import { cleanError, fmtDuration } from "@/lib/format";
import {
  MAX_ROWS,
  PRESETS,
  fetchReportRows,
  istDay,
  presetRange,
  summarize,
  type PresetId,
  type Range,
  type ReportRow,
} from "@/lib/reports/data";
import { downloadBlob, exportCsv, exportIncidentPdf, exportPdf, exportXlsx, istStamp, periodText, reportFileName } from "@/lib/reports/export";

const SHOW = 100;

export default function ReportsClient() {
  const toast = useToast();
  const [preset, setPreset] = useState<PresetId>("last30");
  const [range, setRange] = useState<Range>(() => presetRange("last30") as Range);
  const [region, setRegion] = useState<string>("");
  const [regions, setRegions] = useState<string[]>([]);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "pdf" | "xlsx" | "csv" | string>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabaseBrowser().from("towers").select("region").is("deleted_at", null).limit(2000);
      const set = new Set<string>((data ?? []).map((r: { region: string }) => r.region).filter(Boolean));
      setRegions([...set].sort());
    })();
  }, []);

  const valid = range.from && range.to && range.from <= range.to;

  const load = useCallback(async () => {
    if (!valid) return;
    setRows(null);
    setError(null);
    try {
      const r = await fetchReportRows(range, region || null);
      setRows(r.rows);
      setTruncated(r.truncated);
      setShowAll(false);
    } catch (e) {
      setError(cleanError(e));
      setRows([]);
    }
  }, [range, region, valid]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => (rows ? summarize(rows, range) : null), [rows, range]);

  function pickPreset(id: PresetId) {
    setPreset(id);
    const r = presetRange(id);
    if (r) setRange(r);
  }

  async function run(kind: "pdf" | "xlsx" | "csv") {
    if (!rows || !summary) return;
    setBusy(kind);
    try {
      const name = reportFileName(range, kind, region || null);
      if (kind === "csv") downloadBlob(exportCsv(rows), name);
      else if (kind === "xlsx") downloadBlob(await exportXlsx(rows, summary, range, region || null), name);
      else downloadBlob(await exportPdf(rows, summary, range, region || null), name);
      toast.push({ kind: "success", title: "Report ready", body: name });
    } catch (e) {
      toast.push({ kind: "error", title: "Could not create the file", body: cleanError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function incidentPdf(id: string) {
    setBusy(id);
    try {
      const { blob, name } = await exportIncidentPdf(id);
      downloadBlob(blob, name);
    } catch (e) {
      toast.push({ kind: "error", title: "Could not create the PDF", body: cleanError(e) });
    } finally {
      setBusy(null);
    }
  }

  const empty = rows !== null && rows.length === 0 && !error;
  const unit = summary?.bucketUnit ?? "day";

  return (
    <div className="space-y-4 p-3 lg:p-5" data-testid="reports">
      <PageHeader
        title="Reports"
        subtitle="Daily, weekly, monthly or custom. Download as PDF, Excel or CSV. Times are India time."
        actions={
          <>
            <Button tone="outline" onClick={() => run("pdf")} disabled={!rows || empty || !!busy} busy={busy === "pdf"} data-testid="dl-pdf">
              <FileText className="h-4 w-4" /> PDF
            </Button>
            <Button tone="outline" onClick={() => run("xlsx")} disabled={!rows || empty || !!busy} busy={busy === "xlsx"} data-testid="dl-xlsx">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button tone="outline" onClick={() => run("csv")} disabled={!rows || empty || !!busy} busy={busy === "csv"} data-testid="dl-csv">
              <FileType2 className="h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      <section className="grid gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Period">
          <select className={inputCls} value={preset} onChange={(e) => pickPreset(e.target.value as PresetId)} data-testid="preset">
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" className={inputCls} value={range.from === "2000-01-01" ? "" : range.from} max={istDay(new Date())} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} data-testid="from" />
        </Field>
        <Field label="To">
          <input type="date" className={inputCls} value={range.to} max={istDay(new Date())} onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} data-testid="to" />
        </Field>
        <Field label="Region">
          <select className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} data-testid="region">
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        {!valid && <p className="text-sm text-red-700 sm:col-span-2 lg:col-span-4">The start date must be on or before the end date.</p>}
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">{error}</p>}
      {truncated && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">More than {MAX_ROWS.toLocaleString()} incidents match. Only the newest {MAX_ROWS.toLocaleString()} are shown. Narrow the period.</p>}

      {rows === null && !error && (
        <div className="grid place-items-center p-16"><Spinner /></div>
      )}

      {empty && <EmptyState title="No incidents in this period" hint="Choose another period or region." />}

      {summary && rows && rows.length > 0 && (
        <>
          <p className="text-sm text-slate-500" data-testid="period-text">
            {periodText(range)} · {region || "all regions"} · {rows.length} incident{rows.length === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="tiles">
            <StatTile label="Incidents" value={summary.total} accent="bg-brand-500" />
            <StatTile label="Resolved" value={summary.resolvedPct === null ? "–" : `${summary.resolvedPct}%`} accent="bg-green-500" hint={`${summary.resolved} of ${summary.total}`} />
            <StatTile label="Avg response" value={fmtDuration(summary.avgResponse)} accent="bg-blue-400" hint="alarm to arrival" />
            <StatTile label="Avg resolution" value={fmtDuration(summary.avgResolution)} accent="bg-teal-500" hint="alarm to closed" />
            <StatTile label="Avg accept time" value={fmtDuration(summary.avgAccept)} accent="bg-yellow-400" hint="alarm to accepted" />
            <StatTile label="First team accepted" value={summary.firstOfferPct === null ? "–" : `${summary.firstOfferPct}%`} accent="bg-slate-400" hint={`${summary.multiOffer} needed more offers`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 xl:col-span-2">
              <ColumnChart data={summary.buckets} unit={unit === "day" ? "Day" : unit === "week" ? "Week starting" : "Month"} title={`Incidents per ${unit}`} />
            </section>
            <section className="space-y-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <StatusBar resolved={summary.resolved} inProgress={summary.inProgress} cancelled={summary.cancelled} />
              <BarList title="Incidents by region" items={summary.regions.map((r) => ({ label: r.region, value: r.incidents, right: r.avgResponse === null ? undefined : fmtDuration(r.avgResponse), hint: "average response time shown on the right" }))} testId="chart-regions" />
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">RRT team performance</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="team-table">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-3">Team</th>
                      <th className="px-2 text-right">Handled</th>
                      <th className="px-2 text-right">Resolved</th>
                      <th className="px-2 text-right">Avg accept</th>
                      <th className="px-2 text-right">Avg response</th>
                      <th className="pl-2 text-right">Avg resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.teams.map((t) => (
                      <tr key={t.code} className="border-t border-slate-100">
                        <td className="py-1.5 pr-3"><span className="font-semibold">{t.code}</span> <span className="text-slate-500">{t.name}</span></td>
                        <td className="px-2 text-right tabular-nums">{t.handled}</td>
                        <td className="px-2 text-right tabular-nums">{t.resolved}</td>
                        <td className="px-2 text-right tabular-nums">{fmtDuration(t.avgAccept)}</td>
                        <td className="px-2 text-right tabular-nums">{fmtDuration(t.avgResponse)}</td>
                        <td className="pl-2 text-right tabular-nums">{fmtDuration(t.avgResolution)}</td>
                      </tr>
                    ))}
                    {summary.teams.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500">No team handled an incident in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <BarList title="Towers with the most incidents" items={summary.towers.slice(0, 10).map((t) => ({ label: `${t.number} ${t.name}`, value: t.incidents, hint: t.region }))} testId="chart-towers" />
            </section>
          </div>

          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Download className="h-4 w-4" /> Incidents ({rows.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="incident-table">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-1.5 pr-3">Incident</th>
                    <th className="px-2">Status</th>
                    <th className="px-2">Tower</th>
                    <th className="px-2">Triggered (IST)</th>
                    <th className="px-2">Team</th>
                    <th className="px-2 text-right">Response</th>
                    <th className="px-2 text-right">Resolution</th>
                    <th className="pl-2 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? rows : rows.slice(0, SHOW)).map((r) => (
                    <tr key={r.incident_id} className="border-t border-slate-100" data-testid="incident-row">
                      <td className="py-1.5 pr-3"><Link href={`/incidents/${r.incident_id}`} className="font-medium text-brand-700 hover:underline">{r.incident_number}</Link></td>
                      <td className="px-2"><IncidentBadge status={r.status} /></td>
                      <td className="px-2">{r.tower_number} <span className="text-slate-500">{r.tower_name}</span></td>
                      <td className="px-2 tabular-nums text-slate-600">{istStamp(r.triggered_at).slice(0, 16)}</td>
                      <td className="px-2">{r.team_code ?? "–"}</td>
                      <td className="px-2 text-right tabular-nums">{fmtDuration(r.response_seconds)}</td>
                      <td className="px-2 text-right tabular-nums">{fmtDuration(r.resolution_seconds)}</td>
                      <td className="pl-2 text-right">
                        <button type="button" onClick={() => incidentPdf(r.incident_id)} disabled={!!busy} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700 disabled:opacity-40" aria-label={`PDF report for ${r.incident_number}`} data-testid="row-pdf">
                          {busy === r.incident_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!showAll && rows.length > SHOW && (
              <div className="mt-3 text-center">
                <Button tone="outline" onClick={() => setShowAll(true)}>Show all {rows.length}</Button>
                <p className="mt-1 text-xs text-slate-400">The downloads always contain every incident.</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
