import clsx from "clsx";

export default function StatTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string | undefined;
  accent: string; // tailwind bg colour class for the left bar
  hint?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-slate-200">
      <span className={clsx("absolute inset-y-0 left-0 w-1.5", accent)} aria-hidden />
      <p className="pl-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 pl-1 text-3xl font-semibold tabular-nums text-slate-900">{value ?? "–"}</p>
      {hint && <p className="pl-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
