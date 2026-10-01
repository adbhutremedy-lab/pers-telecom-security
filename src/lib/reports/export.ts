import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtDateTime, fmtDistance, fmtDuration } from "@/lib/format";
import { BRAND } from "@/lib/constants";
import type { IncidentAnswer, IncidentDetail, IncidentOffer, IncidentPhoto } from "@/lib/types";
import { STATUS_TEXT, answerText, type Range, type ReportRow, type Summary } from "./data";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const IST_MS = 5.5 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-01 14:05:09" in India time, or "". */
export function istStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + IST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const mins = (s: number | null) => (s === null || s === undefined ? null : Math.round(s / 6) / 10);


export function reportFileName(range: Range, ext: string, region: string | null): string {
  const r = range.from === "2000-01-01" ? `all-to-${range.to}` : `${range.from}_to_${range.to}`;
  const g = region ? `_${region.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : "";
  return `PERS_incident_report_${r}${g}.${ext}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** The built-in PDF font covers Western characters only; anything else becomes "?". */
const pdfText = (s: unknown): string =>
  String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\u0009\u000A -~ -ÿ]/g, "?");

// ---------------------------------------------------------------------------
// flat table (CSV and Excel share it)
// ---------------------------------------------------------------------------
interface Col {
  header: string;
  width: number;
  value: (r: ReportRow) => string | number | boolean | null;
  kind?: "text" | "time" | "number";
}

const COLS: Col[] = [
  { header: "Incident", width: 18, value: (r) => r.incident_number },
  { header: "Status", width: 11, value: (r) => STATUS_TEXT[r.status] },
  { header: "Tower no", width: 11, value: (r) => r.tower_number },
  { header: "Tower name", width: 28, value: (r) => r.tower_name },
  { header: "Region", width: 18, value: (r) => r.region ?? "" },
  { header: "Triggered (IST)", width: 20, value: (r) => r.triggered_at, kind: "time" },
  { header: "RRT code", width: 10, value: (r) => r.team_code ?? "" },
  { header: "RRT team", width: 18, value: (r) => r.assigned_rrt ?? "" },
  { header: "Offers made", width: 11, value: (r) => r.offers_count, kind: "number" },
  { header: "Accepted by 1st team", width: 14, value: (r) => (r.accepted_at ? (r.first_offer_accepted ? "Yes" : "No") : "") },
  { header: "Accepted (IST)", width: 20, value: (r) => r.accepted_at, kind: "time" },
  { header: "Reached (IST)", width: 20, value: (r) => r.reached_at, kind: "time" },
  { header: "Reached manually", width: 12, value: (r) => (r.reached_at ? (r.reached_manually ? "Yes" : "No") : "") },
  { header: "Resolved (IST)", width: 20, value: (r) => r.resolved_at, kind: "time" },
  { header: "Accept time (min)", width: 12, value: (r) => mins(r.accept_seconds), kind: "number" },
  { header: "Travel time (min)", width: 12, value: (r) => mins(r.travel_seconds), kind: "number" },
  { header: "Response time (min)", width: 13, value: (r) => mins(r.response_seconds), kind: "number" },
  { header: "On-site time (min)", width: 13, value: (r) => mins(r.onsite_seconds), kind: "number" },
  { header: "Resolution time (min)", width: 14, value: (r) => mins(r.resolution_seconds), kind: "number" },
  { header: "Photos", width: 8, value: (r) => r.photo_count, kind: "number" },
  { header: "Cancel reason", width: 24, value: (r) => r.cancel_reason ?? "" },
  { header: "Resolution answers", width: 60, value: (r) => r.answers.map((a) => `${a.question}: ${answerText(a.value)}`).join(" | ") },
];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function csvCell(v: string | number | boolean | null, kind?: Col["kind"]): string {
  if (v === null || v === undefined) return "";
  let s = kind === "time" ? istStamp(String(v)) : String(v);
  // spreadsheet formula injection: text that starts with = + - @ is made harmless
  if (typeof v === "string" && kind !== "time" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(rows: ReportRow[]): Blob {
  const head = COLS.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => COLS.map((c) => csvCell(c.value(r), c.kind)).join(","));
  // BOM so Excel reads the file as UTF-8
  return new Blob(["﻿" + [head, ...body].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
export async function exportXlsx(rows: ReportRow[], s: Summary, range: Range, region: string | null): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND;
  wb.created = new Date();

  const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0B1B33" } };
  const styleHead = (row: import("exceljs").Row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = HEAD_FILL;
    row.alignment = { vertical: "middle", wrapText: true };
    row.height = 30;
  };

  // --- Summary sheet
  const sum = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 38 }, { width: 24 }];
  sum.addRow([`${BRAND} - Incident report`]).font = { bold: true, size: 16 };
  sum.addRow([`Period: ${periodText(range)}`]);
  sum.addRow([`Region: ${region ?? "All regions"}`]);
  sum.addRow([`Generated: ${istStamp(new Date().toISOString())} IST`]);
  sum.addRow([]);
  const hdr = sum.addRow(["Measure", "Value"]);
  styleHead(hdr);
  const kv: [string, string | number | null][] = [
    ["Incidents", s.total],
    ["Resolved", s.resolved],
    ["Cancelled", s.cancelled],
    ["In progress", s.inProgress],
    ["Resolved share (%)", s.resolvedPct],
    ["Average accept time", s.avgAccept === null ? "" : fmtDuration(s.avgAccept)],
    ["Average travel time", s.avgTravel === null ? "" : fmtDuration(s.avgTravel)],
    ["Average response time (alarm to arrival)", s.avgResponse === null ? "" : fmtDuration(s.avgResponse)],
    ["Average on-site time", s.avgOnsite === null ? "" : fmtDuration(s.avgOnsite)],
    ["Average resolution time (alarm to closed)", s.avgResolution === null ? "" : fmtDuration(s.avgResolution)],
    ["Accepted by the first team offered (%)", s.firstOfferPct],
    ["Incidents that needed more than one offer", s.multiOffer],
  ];
  for (const [k, v] of kv) sum.addRow([k, v ?? ""]);
  sum.addRow([]);
  sum.addRow(["All times are India Standard Time (IST). Durations: response = alarm to arrival; resolution = alarm to closed."]).font = { italic: true, color: { argb: "FF64748B" } };

  // --- Incidents sheet
  const ws = wb.addWorksheet("Incidents", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map((c) => ({ header: c.header, width: c.width }));
  styleHead(ws.getRow(1));
  rows.forEach((r) => {
    const row = ws.addRow(
      COLS.map((c) => {
        const v = c.value(r);
        if (c.kind === "time") return v ? new Date(new Date(String(v)).getTime() + IST_MS) : null; // shows India wall-clock time
        return v;
      }),
    );
    COLS.forEach((c, i) => {
      if (c.kind === "time") row.getCell(i + 1).numFmt = "yyyy-mm-dd hh:mm:ss";
      if (c.kind === "number" && c.header.includes("(min)")) row.getCell(i + 1).numFmt = "0.0";
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  // --- By team
  const wt = wb.addWorksheet("By team", { views: [{ state: "frozen", ySplit: 1 }] });
  wt.columns = [
    { header: "RRT code", width: 10 },
    { header: "Team", width: 22 },
    { header: "Incidents handled", width: 12 },
    { header: "Resolved", width: 10 },
    { header: "Avg accept (min)", width: 12 },
    { header: "Avg response (min)", width: 13 },
    { header: "Avg resolution (min)", width: 14 },
  ];
  styleHead(wt.getRow(1));
  s.teams.forEach((t) => wt.addRow([t.code, t.name, t.handled, t.resolved, mins(t.avgAccept), mins(t.avgResponse), mins(t.avgResolution)]));

  // --- By tower
  const wk = wb.addWorksheet("By tower", { views: [{ state: "frozen", ySplit: 1 }] });
  wk.columns = [
    { header: "Tower no", width: 11 },
    { header: "Tower name", width: 30 },
    { header: "Region", width: 20 },
    { header: "Incidents", width: 10 },
    { header: "Avg resolution (min)", width: 14 },
  ];
  styleHead(wk.getRow(1));
  s.towers.forEach((t) => wk.addRow([t.number, t.name, t.region, t.incidents, mins(t.avgResolution)]));

  // --- By region
  const wr = wb.addWorksheet("By region", { views: [{ state: "frozen", ySplit: 1 }] });
  wr.columns = [
    { header: "Region", width: 24 },
    { header: "Incidents", width: 10 },
    { header: "Avg response (min)", width: 14 },
  ];
  styleHead(wr.getRow(1));
  s.regions.forEach((x) => wr.addRow([x.region, x.incidents, mins(x.avgResponse)]));

  // --- Over time
  const wd = wb.addWorksheet(s.bucketUnit === "day" ? "By day" : s.bucketUnit === "week" ? "By week" : "By month");
  wd.columns = [{ header: s.bucketUnit === "day" ? "Day" : s.bucketUnit === "week" ? "Week starting" : "Month", width: 18 }, { header: "Incidents", width: 10 }];
  styleHead(wd.getRow(1));
  s.buckets.forEach((b) => wd.addRow([b.label, b.count]));

  // --- Answers (one line per question)
  const wa = wb.addWorksheet("Resolution answers", { views: [{ state: "frozen", ySplit: 1 }] });
  wa.columns = [
    { header: "Incident", width: 18 },
    { header: "Tower no", width: 11 },
    { header: "Question", width: 38 },
    { header: "Answer", width: 60 },
  ];
  styleHead(wa.getRow(1));
  rows.forEach((r) => r.answers.forEach((a) => wa.addRow([r.incident_number, r.tower_number, a.question, answerText(a.value)])));
  wa.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export const periodText = (r: Range) => (r.from === "2000-01-01" ? `all time, up to ${r.to}` : r.from === r.to ? r.from : `${r.from} to ${r.to}`);

// ---------------------------------------------------------------------------
// PDF: period report
// ---------------------------------------------------------------------------
const NAVY: [number, number, number] = [11, 27, 51];
const BLUE: [number, number, number] = [29, 78, 216];
const GREY: [number, number, number] = [100, 116, 139];

type Doc = import("jspdf").jsPDF;

function pageFooters(doc: Doc, left: string) {
  const n = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(pdfText(left), 10, h - 6);
    doc.text(`Page ${i} of ${n}`, w - 10, h - 6, { align: "right" });
  }
}

export async function exportPdf(rows: ReportRow[], s: Summary, range: Range, region: string | null): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const gen = `${istStamp(new Date().toISOString())} IST`;

  // title band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(pdfText(`${BRAND}`), 10, 11);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("Incident and Rapid Response Team report", 10, 18);
  doc.setFontSize(9);
  doc.text(pdfText(`Period: ${periodText(range)}   |   Region: ${region ?? "All regions"}   |   Generated ${gen}`), 10, 23.5);

  // KPI boxes
  const kpis: [string, string][] = [
    ["Incidents", String(s.total)],
    ["Resolved", s.total ? `${s.resolved} (${s.resolvedPct}%)` : "-"],
    ["Cancelled", String(s.cancelled)],
    ["Avg response", fmtDuration(s.avgResponse)],
    ["Avg resolution", fmtDuration(s.avgResolution)],
    ["Accepted by 1st team", s.firstOfferPct === null ? "-" : `${s.firstOfferPct}%`],
  ];
  const bw = (W - 20 - 5 * 4) / 6;
  kpis.forEach(([label, val], i) => {
    const x = 10 + i * (bw + 4);
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, 31, bw, 20, 2, 2, "FD");
    doc.setTextColor(...GREY);
    doc.setFontSize(8);
    doc.text(pdfText(label.toUpperCase()), x + 3, 37);
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(pdfText(val), x + 3, 46);
    doc.setFont("helvetica", "normal");
  });

  // time line: small bar chart drawn with rectangles
  let y = 58;
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Incidents per ${s.bucketUnit}`, 10, y);
  doc.setFont("helvetica", "normal");
  const chartX = 10, chartY = y + 3, chartW = W - 20, chartH = 38;
  const max = Math.max(1, ...s.buckets.map((b) => b.count));
  doc.setDrawColor(226, 232, 240);
  doc.line(chartX, chartY + chartH, chartX + chartW, chartY + chartH);
  const n = Math.max(1, s.buckets.length);
  const slot = chartW / n;
  const bar = Math.min(10, slot * 0.7);
  doc.setFillColor(...BLUE);
  doc.setFontSize(7);
  s.buckets.forEach((b, i) => {
    const bh = (b.count / max) * (chartH - 6);
    const bx = chartX + i * slot + (slot - bar) / 2;
    if (b.count > 0) {
      doc.setFillColor(...BLUE); // text colours share the PDF fill state, so set it again for every bar
      doc.rect(bx, chartY + chartH - bh, bar, bh, "F");
    }
    if (b.count > 0 && n <= 40) {
      doc.setTextColor(...NAVY);
      doc.text(String(b.count), bx + bar / 2, chartY + chartH - bh - 1, { align: "center" });
    }
    if (n <= 16 || i % Math.ceil(n / 16) === 0) {
      doc.setTextColor(...GREY);
      doc.text(pdfText(b.label), bx + bar / 2, chartY + chartH + 4, { align: "center" });
    }
  });
  y = chartY + chartH + 10;

  const common = {
    styles: { fontSize: 8, cellPadding: 1.8, textColor: [30, 41, 59] as [number, number, number] },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    margin: { left: 10, right: 10, bottom: 12 },
  };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  const title = (t: string, yy: number) => {
    if (yy > 190) {
      doc.addPage();
      yy = 16;
    }
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(pdfText(t), 10, yy);
    doc.setFont("helvetica", "normal");
    return yy + 2;
  };

  // by region + by team
  let ty = title("Incidents by region", y);
  autoTable(doc, {
    ...common,
    startY: ty,
    head: [["Region", "Incidents", "Avg response"]],
    body: s.regions.map((r) => [pdfText(r.region), r.incidents, fmtDuration(r.avgResponse)]),
    tableWidth: 120,
  });
  ty = title("RRT team performance", lastY() + 8);
  autoTable(doc, {
    ...common,
    startY: ty,
    head: [["Team", "Name", "Handled", "Resolved", "Avg accept", "Avg response", "Avg resolution"]],
    body: s.teams.map((t) => [t.code, pdfText(t.name), t.handled, t.resolved, fmtDuration(t.avgAccept), fmtDuration(t.avgResponse), fmtDuration(t.avgResolution)]),
  });
  ty = title("Towers with the most incidents (top 15)", lastY() + 8);
  autoTable(doc, {
    ...common,
    startY: ty,
    head: [["Tower", "Name", "Region", "Incidents", "Avg resolution"]],
    body: s.towers.slice(0, 15).map((t) => [t.number, pdfText(t.name), pdfText(t.region), t.incidents, fmtDuration(t.avgResolution)]),
  });

  // incident list
  doc.addPage();
  ty = title(`Incident list (${rows.length})`, 16);
  autoTable(doc, {
    ...common,
    startY: ty,
    head: [["Incident", "Status", "Tower", "Region", "Triggered (IST)", "Team", "Offers", "Accept", "Response", "Resolution", "Photos"]],
    body: rows.map((r) => [
      r.incident_number,
      STATUS_TEXT[r.status],
      pdfText(`${r.tower_number} ${r.tower_name}`),
      pdfText(r.region ?? ""),
      istStamp(r.triggered_at).slice(0, 16),
      r.team_code ?? "-",
      r.offers_count,
      fmtDuration(r.accept_seconds),
      fmtDuration(r.response_seconds),
      fmtDuration(r.resolution_seconds),
      r.photo_count,
    ]),
    columnStyles: { 2: { cellWidth: 52 } },
  });

  pageFooters(doc, `${BRAND} | times in India Standard Time | generated ${gen}`);
  return doc.output("blob");
}

// ---------------------------------------------------------------------------
// PDF: one incident with its photos
// ---------------------------------------------------------------------------
async function toJpegDataUrl(url: string, maxEdge = 1100): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((ok, bad) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => bad(new Error("decode"));
        i.src = obj;
      });
      const w0 = img.naturalWidth || 640;
      const h0 = img.naturalHeight || 400;
      const k = Math.min(1, maxEdge / Math.max(w0, h0));
      const c = document.createElement("canvas");
      c.width = Math.round(w0 * k);
      c.height = Math.round(h0 * k);
      const g = c.getContext("2d");
      if (!g) return null;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return { data: c.toDataURL("image/jpeg", 0.82), w: c.width, h: c.height };
    } finally {
      URL.revokeObjectURL(obj);
    }
  } catch {
    return null;
  }
}

export async function exportIncidentPdf(incidentId: string): Promise<{ blob: Blob; name: string }> {
  const sb = supabaseBrowser();
  const [i, o, a, p] = await Promise.all([
    sb.from("v_incident_detail").select("*").eq("id", incidentId).maybeSingle(),
    sb.from("v_incident_offers").select("*").eq("incident_id", incidentId).order("sequence_no"),
    sb.from("incident_answers").select("*").eq("incident_id", incidentId).order("answered_at"),
    sb.from("incident_photos").select("id, incident_id, question_id, kind, storage_path, file_name, mime_type, created_at").eq("incident_id", incidentId).order("created_at"),
  ]);
  if (i.error) throw i.error;
  if (!i.data) throw new Error("Incident not found");
  const inc = i.data as IncidentDetail;
  const offers = (o.data ?? []) as IncidentOffer[];
  const answers = (a.data ?? []) as IncidentAnswer[];
  const photos = ((p.data ?? []) as IncidentPhoto[]).filter((x) => x.mime_type.startsWith("image/") && !/heic|heif/i.test(x.mime_type));
  const otherFiles = ((p.data ?? []) as IncidentPhoto[]).filter((x) => !photos.includes(x));

  const shots: { data: string; w: number; h: number; caption: string }[] = [];
  if (photos.length) {
    const { data: signed } = await sb.storage.from("incident-media").createSignedUrls(photos.slice(0, 12).map((x) => x.storage_path), 600);
    const by = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    for (const ph of photos.slice(0, 12)) {
      const u = by.get(ph.storage_path);
      if (!u) continue;
      const j = await toJpegDataUrl(u);
      if (j) shots.push({ ...j, caption: ph.file_name ?? "photo" });
    }
  }

  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(pdfText(BRAND), 10, 11);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(pdfText(`Incident report  ${inc.incident_number}`), 10, 19);
  doc.setFontSize(9);
  doc.text(pdfText(`Status: ${STATUS_TEXT[inc.status]}   |   Generated ${istStamp(new Date().toISOString())} IST`), 10, 25);

  const common = {
    styles: { fontSize: 9, cellPadding: 1.8, textColor: [30, 41, 59] as [number, number, number] },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" as const },
    margin: { left: 10, right: 10, bottom: 14 },
  };
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30;
  const title = (t: string, yy: number) => {
    if (yy > H - 40) {
      doc.addPage();
      yy = 16;
    }
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(pdfText(t), 10, yy);
    doc.setFont("helvetica", "normal");
    return yy + 2;
  };

  let y = title("Tower and team", 36);
  autoTable(doc, {
    ...common,
    startY: y,
    theme: "grid",
    body: [
      ["Tower", pdfText(`${inc.tower_number} - ${inc.tower_name}`)],
      ["Region", pdfText(inc.region ?? "")],
      ["Location", `${inc.tower_lat.toFixed(5)}, ${inc.tower_lng.toFixed(5)}`],
      ["RRT team", pdfText(inc.team_code ? `${inc.team_code} ${inc.team_name ?? ""}` : "none assigned")],
      ["Triggered by", pdfText(inc.triggered_by_name ?? "-")],
    ],
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 32, fillColor: [241, 245, 249] } },
  });

  y = title("Timeline (India time)", lastY() + 8);
  autoTable(doc, {
    ...common,
    startY: y,
    head: [["Step", "Time", "Duration from alarm"]],
    body: [
      ["Alarm raised", fmtDateTime(inc.triggered_at), "-"],
      ["Accepted by team", fmtDateTime(inc.accepted_at), fmtDuration(inc.accept_seconds)],
      [inc.reached_manually ? "Reached (marked by control room)" : "Reached the tower", fmtDateTime(inc.reached_at), fmtDuration(inc.response_seconds)],
      ["Resolved", fmtDateTime(inc.resolved_at), fmtDuration(inc.resolution_seconds)],
      ...(inc.cancelled_at ? [["Cancelled", fmtDateTime(inc.cancelled_at), pdfText(inc.cancel_reason ?? "")]] : []),
    ].map((r) => r.map((c) => pdfText(c))),
  });
  autoTable(doc, {
    ...common,
    startY: lastY() + 3,
    theme: "plain",
    body: [[`Travel time ${fmtDuration(inc.travel_seconds)}   |   On-site time ${fmtDuration(inc.onsite_seconds)}   |   Offers made ${inc.offers_count}`]],
    styles: { fontSize: 9, textColor: GREY },
  });

  y = title("Offers (escalation)", lastY() + 6);
  autoTable(doc, {
    ...common,
    startY: y,
    head: [["#", "Team", "Distance", "Offered", "Answer", "Reply time"]],
    body: offers.map((x) => [
      x.sequence_no,
      pdfText(`${x.team_code} ${x.team_name}`),
      fmtDistance(x.distance_km * 1000),
      fmtDateTime(x.offered_at).slice(-8),
      pdfText(x.status === "REJECTED" && x.response_reason ? `Rejected (${x.response_reason})` : x.status.charAt(0) + x.status.slice(1).toLowerCase()),
      x.response_seconds === null ? "-" : fmtDuration(x.response_seconds),
    ]),
  });

  y = title("Resolution report", lastY() + 8);
  if (answers.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text("No resolution report has been filed.", 10, y + 5);
    (doc as unknown as { lastAutoTable?: unknown }).lastAutoTable = { finalY: y + 6 };
  } else {
    autoTable(doc, {
      ...common,
      startY: y,
      head: [["Question", "Answer"]],
      body: answers.map((x) => [pdfText(x.question_label), pdfText(answerText(x.value))]),
      columnStyles: { 0: { cellWidth: 70, fontStyle: "bold" } },
    });
  }

  if (shots.length || otherFiles.length) {
    doc.addPage();
    let py = 16;
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Photos (${photos.length}${otherFiles.length ? `, plus ${otherFiles.length} other file(s)` : ""})`, 10, py);
    doc.setFont("helvetica", "normal");
    py += 5;
    const cw = (W - 20 - 6) / 2;
    const maxH = 82;
    let col = 0;
    let rowH = 0;
    for (const sh of shots) {
      const k = Math.min(cw / sh.w, maxH / sh.h);
      const iw = sh.w * k;
      const ih = sh.h * k;
      if (py + ih + 8 > H - 14) {
        doc.addPage();
        py = 16;
        col = 0;
        rowH = 0;
      }
      const x = 10 + col * (cw + 6);
      doc.addImage(sh.data, "JPEG", x, py, iw, ih);
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      doc.text(pdfText(sh.caption).slice(0, 60), x, py + ih + 3.5);
      rowH = Math.max(rowH, ih + 7);
      col += 1;
      if (col === 2) {
        col = 0;
        py += rowH + 2;
        rowH = 0;
      }
    }
    if (photos.length > shots.length) {
      if (col !== 0) py += rowH + 2;
      doc.setFontSize(8);
      doc.setTextColor(...GREY);
      doc.text(`${photos.length - shots.length} photo(s) could not be included. Open the incident on screen to see them.`, 10, Math.min(py + 4, H - 16));
    }
  }

  pageFooters(doc, `${BRAND} | ${inc.incident_number} | times in India Standard Time`);
  return { blob: doc.output("blob"), name: `PERS_${inc.incident_number}.pdf` };
}
