"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TowerBadge, inputCls } from "./ui";
import type { TowerSearchHit } from "@/lib/types";

/** Type-ahead tower search (database function search_towers). */
export default function TowerPicker({ onPick }: { onPick: (t: TowerSearchHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TowerSearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      return;
    }
    setBusy(true);
    const id = window.setTimeout(async () => {
      const { data } = await supabaseBrowser().rpc("search_towers", { p_query: term, p_limit: 8 });
      setHits((data as TowerSearchHit[]) ?? []);
      setBusy(false);
    }, 250);
    return () => window.clearTimeout(id);
  }, [q]);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input autoFocus className={inputCls + " pl-9"} placeholder="Type a tower number or site name, e.g. GGN-001 or Cyber Hub" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search towers" />
      </div>
      <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
        {hits.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">{busy ? "Searching…" : q.trim() ? "No tower found" : "Start typing to search"}</li>}
        {hits.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
              <span>
                <span className="block text-sm font-semibold text-slate-900">{t.tower_number}</span>
                <span className="block text-xs text-slate-500">
                  {t.site_name} · {t.region}
                </span>
              </span>
              <TowerBadge status={t.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
