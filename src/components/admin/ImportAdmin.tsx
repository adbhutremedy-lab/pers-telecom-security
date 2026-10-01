"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Button, Spinner } from "@/components/ui";
import { cleanError } from "@/lib/format";

type Kind = "towers" | "teams";
interface Spec {
  title: string;
  rpc: "admin_import_towers" | "admin_import_teams";
  max: number;
  columns: { key: string; required: boolean; aliases: string[]; example: string }[];
  note: string;
  exampleRows: string[][];
}
const SPECS: Record<Kind, Spec> = {
  towers: {
    title: "Towers",
    rpc: "admin_import_towers",
    max: 2000,
    note: "A tower whose number already exists is updated; new numbers are added. Archived towers come back.",
    columns: [
      { key: "tower_number", required: true, aliases: ["tower_number", "tower_no", "tower_id", "tower", "site_id", "id"], example: "GGN-0101" },
      { key: "site_name", required: true, aliases: ["site_name", "site", "name", "tower_name"], example: "DLF Phase 3 Rooftop" },
      { key: "lat", required: true, aliases: ["lat", "latitude"], example: "28.4942" },
      { key: "lng", required: true, aliases: ["lng", "lon", "long", "longitude"], example: "77.0888" },
      { key: "region", required: true, aliases: ["region", "zone", "area"], example: "Gurugram South" },
      { key: "status", required: false, aliases: ["status", "state"], example: "ACTIVE" },
      { key: "address", required: false, aliases: ["address", "location"], example: "Sector 24, Gurugram" },
    ],
    exampleRows: [["GGN-0101", "DLF Phase 3 Rooftop", "28.4942", "77.0888", "Gurugram South", "ACTIVE", "Sector 24, Gurugram"]],
  },
  teams: {
    title: "Response teams",
    rpc: "admin_import_teams",
    max: 500,
    note: "A team whose code already exists is updated (its live status is not touched); new codes are added. Empty cells keep the old value. Logins are made on the Users tab.",
    columns: [
      { key: "code", required: true, aliases: ["code", "team_code", "team", "team_id"], example: "RRT-11" },
      { key: "name", required: true, aliases: ["name", "team_name"], example: "Gurugram Rapid Team 11" },
      { key: "mobile", required: false, aliases: ["mobile", "phone", "mobile_number"], example: "+91 98100 00011" },
      { key: "vehicle_plate", required: false, aliases: ["vehicle_plate", "plate", "number_plate"], example: "HR26 AB 1111" },
      { key: "vehicle_model", required: false, aliases: ["vehicle_model", "vehicle", "model"], example: "Mahindra Bolero" },
      { key: "region", required: false, aliases: ["region", "zone", "area"], example: "Gurugram South" },
      { key: "home_lat", required: false, aliases: ["home_lat", "base_lat", "base_latitude", "lat", "latitude"], example: "28.4595" },
      { key: "home_lng", required: false, aliases: ["home_lng", "base_lng", "base_longitude", "lng", "lon", "longitude"], example: "77.0266" },
    ],
    exampleRows: [["RRT-11", "Gurugram Rapid Team 11", "+91 98100 00011", "HR26 AB 1111", "Mahindra Bolero", "Gurugram South", "28.4595", "77.0266"]],
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Excel cells can hold rich text, formulas, links, dates: turn each into plain text. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    if ("error" in o) return "";
    return "";
  }
  return String(v).trim();
}

function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

interface DryResult {
  total: number;
  to_insert: number;
  to_update: number;
  errors: { row: number; message: string; tower_number?: string; code?: string }[];
  applied: boolean;
}
interface Parsed {
  fileName: string;
  objects: Record<string, string>[];
  sheetRows: number[]; // original spreadsheet row number of each object
  missing: string[];
  ignored: string[];
}

export default function ImportAdmin() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("towers");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [check, setCheck] = useState<DryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const spec = SPECS[kind];

  function reset() {
    setParsed(null);
    setCheck(null);
    setDone(null);
    setErr(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function template() {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(spec.title);
    ws.addRow(spec.columns.map((c) => c.key));
    for (const r of spec.exampleRows) ws.addRow(r);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 22));
    const notes = wb.addWorksheet("How to fill");
    notes.addRow(["Column", "Needed?", "Example"]);
    for (const c of spec.columns) notes.addRow([c.key, c.required ? "required" : "optional", c.example]);
    notes.addRow([]);
    notes.addRow([spec.note]);
    notes.getRow(1).font = { bold: true };
    notes.columns = [{ width: 18 }, { width: 12 }, { width: 28 }];
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pers-${kind}-template.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function onFile(file: File) {
    reset();
    setBusy(true);
    try {
      let grid: string[][];
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".xlsx")) {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) throw new Error("The workbook has no sheets.");
        grid = [];
        ws.eachRow({ includeEmpty: true }, (row, n) => {
          const vals: string[] = [];
          for (let c = 1; c <= Math.max(row.cellCount, 1); c++) vals.push(cellText(row.getCell(c).value));
          grid[n - 1] = vals;
        });
        for (let i = 0; i < grid.length; i++) grid[i] ??= [];
      } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
        grid = parseCsv(await file.text());
      } else {
        throw new Error("Please choose an Excel (.xlsx) or CSV (.csv) file. Older .xls files: open them in Excel and Save As .xlsx.");
      }
      if (grid.length < 2) throw new Error("The file needs a header row and at least one data row.");

      const headers = grid[0].map(norm);
      const colIndex: Record<string, number> = {};
      for (const c of spec.columns) {
        const i = headers.findIndex((h) => c.aliases.includes(h));
        if (i >= 0) colIndex[c.key] = i;
      }
      const missing = spec.columns.filter((c) => c.required && colIndex[c.key] === undefined).map((c) => c.key);
      const used = new Set(Object.values(colIndex));
      const ignored = grid[0].filter((h, i) => h.trim() && !used.has(i));

      const objects: Record<string, string>[] = [];
      const sheetRows: number[] = [];
      for (let r = 1; r < grid.length; r++) {
        const line = grid[r] ?? [];
        if (line.every((x) => !x || !x.trim())) continue;
        const o: Record<string, string> = {};
        for (const c of spec.columns) o[c.key] = colIndex[c.key] === undefined ? "" : (line[colIndex[c.key]] ?? "").trim();
        objects.push(o);
        sheetRows.push(r + 1);
      }
      if (objects.length === 0) throw new Error("The file has a header but no data rows.");
      if (objects.length > spec.max) throw new Error(`This file has ${objects.length} rows. At most ${spec.max} per import: split it into smaller files.`);
      const p: Parsed = { fileName: file.name, objects, sheetRows, missing, ignored };
      setParsed(p);
      if (missing.length === 0) await runCheck(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck(p: Parsed) {
    const { data, error } = await supabaseBrowser().rpc(spec.rpc, { p_rows: p.objects, p_dry_run: true });
    if (error) return setErr(cleanError(error));
    setCheck(data as DryResult);
  }

  async function apply() {
    if (!parsed) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabaseBrowser().rpc(spec.rpc, { p_rows: parsed.objects, p_dry_run: false });
    setBusy(false);
    if (error) return setErr(cleanError(error));
    const r = data as DryResult;
    const msg = `${r.to_insert} added, ${r.to_update} updated.`;
    toast.push({ kind: "success", title: `${spec.title} imported`, body: msg });
    reset();
    setDone(msg);
  }

  const clean = !!check && check.errors.length === 0 && parsed?.missing.length === 0;
  const preview = parsed?.objects.slice(0, 5) ?? [];

  return (
    <div className="space-y-4" data-testid="admin-import">
      <p className="text-sm text-slate-600">Add many towers or teams at once from an Excel or CSV file. The file is checked first and nothing is saved until every row is correct.</p>

      <div className="flex gap-2" role="tablist" aria-label="What to import">
        {(Object.keys(SPECS) as Kind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            data-testid={`import-kind-${k}`}
            onClick={() => { setKind(k); reset(); }}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium ring-1 ${kind === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
          >
            {SPECS[k].title}
          </button>
        ))}
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="font-semibold text-slate-900">Step 1 · Get the template</h3>
        <p className="mt-1 text-sm text-slate-600">{spec.note}</p>
        <p className="mt-1 text-xs text-slate-500">Columns: {spec.columns.map((c) => c.key + (c.required ? "*" : "")).join(", ")} (* = required)</p>
        <Button tone="outline" className="mt-3" onClick={() => void template()} data-testid="dl-template"><Download className="h-4 w-4" /> Download Excel template</Button>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h3 className="font-semibold text-slate-900">Step 2 · Choose your filled file</h3>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:bg-slate-50">
          <Upload className="h-5 w-5" />
          <span>{parsed ? parsed.fileName : "Click to choose an .xlsx or .csv file"}</span>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="sr-only" data-testid="import-file" aria-label="Choose file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </label>
        {busy && !check && <div className="mt-3"><Spinner /></div>}
        {err && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        {done && <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800" data-testid="import-done">Done: {done}</p>}
      </section>

      {parsed && (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="import-preview">
          <h3 className="font-semibold text-slate-900">Step 3 · Check</h3>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><FileSpreadsheet className="h-4 w-4" /> {parsed.objects.length} rows read from {parsed.fileName}</p>
          {parsed.missing.length > 0 && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              The file has no column for: <b>{parsed.missing.join(", ")}</b>. Check the header row, or start again from the template.
            </p>
          )}
          {parsed.ignored.length > 0 && <p className="mt-2 text-xs text-slate-500">Columns not used: {parsed.ignored.join(", ")}</p>}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase text-slate-500">
                <tr>{spec.columns.map((c) => <th key={c.key} className="px-2 py-1">{c.key}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((o, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {spec.columns.map((c) => <td key={c.key} className="px-2 py-1">{o[c.key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.objects.length > preview.length && <p className="mt-1 text-xs text-slate-500">…and {parsed.objects.length - preview.length} more rows</p>}
          </div>

          {check && (
            <div className="mt-4 space-y-2" data-testid="import-result">
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded bg-teal-50 px-2 py-1 text-teal-800">{check.to_insert} to add</span>
                <span className="rounded bg-sky-50 px-2 py-1 text-sky-800">{check.to_update} to update</span>
                <span className={`rounded px-2 py-1 ${check.errors.length ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{check.errors.length} with problems</span>
              </div>
              {check.errors.length > 0 && (
                <ul className="max-h-60 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="import-errors">
                  {check.errors.slice(0, 100).map((e, i) => (
                    <li key={i}>Row {parsed.sheetRows[e.row - 2] ?? e.row}{e.tower_number || e.code ? ` (${e.tower_number ?? e.code})` : ""}: {e.message}</li>
                  ))}
                  {check.errors.length > 100 && <li>…and {check.errors.length - 100} more</li>}
                </ul>
              )}
              {check.errors.length > 0 ? (
                <p className="text-sm text-slate-600">Fix these rows in your file, then choose it again. Nothing has been saved.</p>
              ) : (
                <Button onClick={apply} busy={busy} disabled={!clean} data-testid="import-apply">Import {check.total} {kind === "towers" ? "towers" : "teams"}</Button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
