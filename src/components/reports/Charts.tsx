"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Bucket } from "@/lib/reports/data";

const BAR = "#2563eb"; // brand blue, single hue: all of these charts show one measure (magnitude)

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Incidents per day / week / month. Hover or focus a column for its value. */
export function ColumnChart({ data, unit, title }: { data: Bucket[]; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 760;
  const H = 230;
  const L = 34;
  const R = 8;
  const T = 12;
  const B = 28;
  const max = niceMax(Math.max(1, ...data.map((d) => d.count)));
  const n = Math.max(1, data.length);
  const slot = (W - L - R) / n;
  const bw = Math.max(3, Math.min(28, slot - 2 - (slot > 14 ? 4 : 0)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 100) / 100).filter((v, i, a) => a.indexOf(v) === i);
  const labelEvery = Math.max(1, Math.ceil(n / 14));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-slate-500 underline hover:text-slate-800">
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-1.5">{unit}</th><th className="px-3 py-1.5 text-right">Incidents</th></tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-slate-100"><td className="px-3 py-1">{d.label}</td><td className="px-3 py-1 text-right tabular-nums">{d.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: ${data.reduce((a, d) => a + d.count, 0)} incidents`} data-testid="chart-columns">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
                <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">{t}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = L + i * slot + (slot - bw) / 2;
              const h = (H - T - B) * (d.count / max);
              return (
                <g key={d.key}>
                  <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${d.count} incidents`} />
                  {d.count > 0 && <path d={`M${x},${y(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill={BAR} opacity={hover === null || hover === i ? 1 : 0.55} pointerEvents="none" />}
                  {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#64748b">{d.label}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
              style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%`, top: 0 }}
              role="status"
            >
              {data[hover].label}: <b>{data[hover].count}</b> incident{data[hover].count === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  right?: string;
  hint?: string;
}

/** Horizontal bars, longest first. Values are written next to the bar (no legend needed: one series). */
export function BarList({ title, items, empty = "No data in this period", testId }: { title: string; items: BarItem[]; empty?: string; testId?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div data-testid={testId}>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((i) => (
            <li key={i.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm" title={i.hint}>
              <span className="truncate text-slate-700">{i.label}</span>
              <span className="h-3.5 rounded-r bg-slate-100">
                <span className="block h-full rounded-r" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: BAR }} />
              </span>
              <span className="min-w-[3.5rem] text-right tabular-nums text-slate-700">
                {i.value}
                {i.right && <span className="ml-1 text-xs text-slate-400">{i.right}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Resolved: "#16a34a",
  "In progress": "#f59e0b",
  Cancelled: "#94a3b8",
};

/** One stacked bar with a legend: Resolved / In progress / Cancelled. */
export function StatusBar({ resolved, inProgress, cancelled }: { resolved: number; inProgress: number; cancelled: number }) {
  const parts = [
    { label: "Resolved", n: resolved },
    { label: "In progress", n: inProgress },
    { label: "Cancelled", n: cancelled },
  ];
  const total = resolved + inProgress + cancelled;
  return (
    <div data-testid="chart-status">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Outcome</h3>
      <div className="flex h-5 overflow-hidden rounded bg-slate-100" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {total > 0 &&
          parts
            .filter((p) => p.n > 0)
            .map((p) => (
              <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: STATUS_COLOR[p.label], marginRight: 2 }} title={`${p.label}: ${p.n}`} />
            ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className={clsx("h-3 w-3 rounded-sm")} style={{ background: STATUS_COLOR[p.label] }} />
            <span className="text-slate-700">{p.label}</span>
            <b className="tabular-nums text-slate-900">{p.n}</b>
            {total > 0 && <span className="text-xs text-slate-400">{Math.round((100 * p.n) / total)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
