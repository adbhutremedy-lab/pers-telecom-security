import { supabaseBrowser } from "@/lib/supabase/client";
import type { IncidentStatus } from "@/lib/types";

/** One incident as the reports see it (view v_report_incidents). */
export interface ReportRow {
  incident_id: string;
  incident_number: string;
  tower_number: string;
  tower_name: string;
  region: string | null;
  tower_lat: number;
  tower_lng: number;
  status: IncidentStatus;
  triggered_at: string;
  team_code: string | null;
  assigned_rrt: string | null;
  accepted_at: string | null;
  reached_at: string | null;
  reached_manually: boolean;
  resolved_at: string | null;
  cancel_reason: string | null;
  accept_seconds: number | null;
  travel_seconds: number | null;
  response_seconds: number | null;
  onsite_seconds: number | null;
  resolution_seconds: number | null;
  offers_count: number;
  first_offer_accepted: boolean;
  answers: { question: string; type: string; value: unknown }[];
  photo_count: number;
}

const COLS =
  "incident_id, incident_number, tower_number, tower_name, region, tower_lat, tower_lng, status, triggered_at, team_code, assigned_rrt, accepted_at, reached_at, reached_manually, resolved_at, cancel_reason, accept_seconds, travel_seconds, response_seconds, onsite_seconds, resolution_seconds, offers_count, first_offer_accepted, answers, photo_count";

export const MAX_ROWS = 10000;

// ---- India-time date helpers (no daylight saving in India) ----------------
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-10-01" for an instant, in India time. */
export const istDay = (d: Date | string | number) => ymd.format(new Date(d));
export const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
export const addDays = (day: string, n: number) => istDay(new Date(istStart(day).getTime() + n * 86400000 + 43200000));

export interface Range {
  from: string; // YYYY-MM-DD (India), inclusive
  to: string; // YYYY-MM-DD (India), inclusive
}

export type PresetId = "today" | "yesterday" | "week" | "last7" | "last30" | "month" | "lastmonth" | "all" | "custom";

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week (Mon-Sun)" },
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom dates" },
];

export function presetRange(id: PresetId, now = new Date()): Range | null {
  const today = istDay(now);
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "week": {
      const dow = (new Date(`${today}T12:00:00+05:30`).getUTCDay() + 6) % 7; // Monday = 0
      const from = addDays(today, -dow);
      return { from, to: addDays(from, 6) };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "month": {
      const first = `${y}-${pad(m)}-01`;
      const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
      return { from: first, to: addDays(nextFirst, -1) };
    }
    case "lastmonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const first = `${py}-${pad(pm)}-01`;
      return { from: first, to: addDays(`${y}-${pad(m)}-01`, -1) };
    }
    case "all":
      return { from: "2000-01-01", to: today };
    default:
      return null;
  }
}

/** Reads every incident in the range (the web API returns 1000 rows per request, so this pages). */
export async function fetchReportRows(range: Range, region: string | null): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const sb = supabaseBrowser();
  const fromIso = istStart(range.from).toISOString();
  const toIso = istStart(addDays(range.to, 1)).toISOString();
  const rows: ReportRow[] = [];
  const page = 1000;
  for (let off = 0; off < MAX_ROWS; off += page) {
    let q = sb
      .from("v_report_incidents")
      .select(COLS)
      .gte("triggered_at", fromIso)
      .lt("triggered_at", toIso)
      .order("triggered_at", { ascending: false })
      .range(off, off + page - 1);
    if (region) q = q.eq("region", region);
    const { data, error } = await q;
    if (error) throw error;
    const part = (data ?? []) as unknown as ReportRow[];
    rows.push(...part);
    if (part.length < page) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

// ---- summary -----------------------------------------------------------------
const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export interface TeamStat {
  code: string;
  name: string;
  handled: number;
  resolved: number;
  avgAccept: number | null;
  avgResponse: number | null;
  avgResolution: number | null;
}
export interface TowerStat {
  number: string;
  name: string;
  region: string;
  incidents: number;
  avgResolution: number | null;
}
export interface RegionStat {
  region: string;
  incidents: number;
  avgResponse: number | null;
}
export interface Bucket {
  key: string; // sortable key
  label: string;
  count: number;
}

export interface Summary {
  total: number;
  resolved: number;
  cancelled: number;
  inProgress: number;
  resolvedPct: number | null;
  avgAccept: number | null;
  avgTravel: number | null;
  avgResponse: number | null;
  avgOnsite: number | null;
  avgResolution: number | null;
  firstOfferPct: number | null;
  multiOffer: number; // incidents that needed more than one offer
  teams: TeamStat[];
  towers: TowerStat[];
  regions: RegionStat[];
  buckets: Bucket[];
  bucketUnit: "day" | "week" | "month";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export function summarize(rows: ReportRow[], range: Range): Summary {
  const resolved = rows.filter((r) => r.status === "RESOLVED");
  const cancelled = rows.filter((r) => r.status === "CANCELLED");
  const inProgress = rows.filter((r) => ["OPEN", "ASSIGNED", "REACHED"].includes(r.status));
  const assigned = rows.filter((r) => r.accepted_at);

  // teams
  const tm = new Map<string, ReportRow[]>();
  for (const r of rows) if (r.team_code) tm.set(r.team_code, [...(tm.get(r.team_code) ?? []), r]);
  const teams: TeamStat[] = [...tm.entries()]
    .map(([code, rs]) => ({
      code,
      name: rs[0].assigned_rrt ?? code,
      handled: rs.length,
      resolved: rs.filter((x) => x.status === "RESOLVED").length,
      avgAccept: avg(rs.map((x) => x.accept_seconds)),
      avgResponse: avg(rs.map((x) => x.response_seconds)),
      avgResolution: avg(rs.map((x) => x.resolution_seconds)),
    }))
    .sort((a, b) => b.handled - a.handled || a.code.localeCompare(b.code));

  // towers
  const tw = new Map<string, ReportRow[]>();
  for (const r of rows) tw.set(r.tower_number, [...(tw.get(r.tower_number) ?? []), r]);
  const towers: TowerStat[] = [...tw.entries()]
    .map(([number, rs]) => ({
      number,
      name: rs[0].tower_name,
      region: rs[0].region ?? "",
      incidents: rs.length,
      avgResolution: avg(rs.map((x) => x.resolution_seconds)),
    }))
    .sort((a, b) => b.incidents - a.incidents || a.number.localeCompare(b.number));

  // regions
  const rg = new Map<string, ReportRow[]>();
  for (const r of rows) rg.set(r.region ?? "(none)", [...(rg.get(r.region ?? "(none)") ?? []), r]);
  const regions: RegionStat[] = [...rg.entries()]
    .map(([region, rs]) => ({ region, incidents: rs.length, avgResponse: avg(rs.map((x) => x.response_seconds)) }))
    .sort((a, b) => b.incidents - a.incidents || a.region.localeCompare(b.region));

  // time buckets
  // "All time" starts at the first incident instead of the year 2000
  let start = range.from;
  if (range.from === "2000-01-01") start = rows.length ? istDay(rows[rows.length - 1].triggered_at) : range.to;
  const span = Math.max(1, Math.round((istStart(range.to).getTime() - istStart(start).getTime()) / 86400000) + 1);
  const unit: Summary["bucketUnit"] = span <= 45 ? "day" : span <= 200 ? "week" : "month";
  const keyOf = (day: string): { key: string; label: string } => {
    if (unit === "day") return { key: day, label: labelDay(day) };
    if (unit === "week") {
      const dow = (new Date(`${day}T12:00:00+05:30`).getUTCDay() + 6) % 7;
      const mon = addDays(day, -dow);
      return { key: mon, label: `Wk ${labelDay(mon)}` };
    }
    return { key: day.slice(0, 7), label: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}` };
  };
  const counts = new Map<string, Bucket>();
  // fill empty buckets between start and end so gaps are visible
  for (let d = start, guard = 0; d <= range.to && guard < 4000; d = addDays(d, 1), guard++) {
    const k = keyOf(d);
    if (!counts.has(k.key)) counts.set(k.key, { key: k.key, label: k.label, count: 0 });
  }
  for (const r of rows) {
    const k = keyOf(istDay(r.triggered_at));
    const b = counts.get(k.key) ?? { key: k.key, label: k.label, count: 0 };
    b.count += 1;
    counts.set(k.key, b);
  }
  const buckets = [...counts.values()].sort((a, b) => a.key.localeCompare(b.key));

  const accepted = rows.filter((r) => r.accepted_at);
  return {
    total: rows.length,
    resolved: resolved.length,
    cancelled: cancelled.length,
    inProgress: inProgress.length,
    resolvedPct: rows.length ? Math.round((1000 * resolved.length) / rows.length) / 10 : null,
    avgAccept: avg(rows.map((r) => r.accept_seconds)),
    avgTravel: avg(rows.map((r) => r.travel_seconds)),
    avgResponse: avg(rows.map((r) => r.response_seconds)),
    avgOnsite: avg(rows.map((r) => r.onsite_seconds)),
    avgResolution: avg(rows.map((r) => r.resolution_seconds)),
    firstOfferPct: assigned.length ? Math.round((1000 * accepted.filter((r) => r.first_offer_accepted).length) / assigned.length) / 10 : null,
    multiOffer: rows.filter((r) => r.offers_count > 1).length,
    teams,
    towers,
    regions,
    buckets,
    bucketUnit: unit,
  };
}

export function answerText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => answerText(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const STATUS_TEXT: Record<IncidentStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  REACHED: "Reached",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};
