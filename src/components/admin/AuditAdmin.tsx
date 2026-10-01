"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Button, Spinner } from "@/components/ui";
import { cleanError } from "@/lib/format";

interface Row {
  id: number;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  created_at: string;
}
const ENTITY: Record<string, string> = { towers: "Tower", users: "User", custom_forms: "Form", custom_questions: "Form question", settings: "Setting" };
const VERB: Record<string, string> = { INSERT: "added", UPDATE: "changed", DELETE: "deleted" };

function describe(r: Row): string {
  const o = (r.after ?? r.before) as Record<string, unknown> | null;
  const name = o && (o.tower_number ?? o.site_name ?? o.full_name ?? o.name ?? o.label ?? o.key ?? o.email);
  return `${ENTITY[r.entity] ?? r.entity} ${name ? `“${String(name)}” ` : ""}${VERB[r.action] ?? r.action.toLowerCase()}`;
}
const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function AuditAdmin() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabaseBrowser().from("audit_logs").select("id, actor_email, action, entity, entity_id, before, after, created_at").order("id", { ascending: false }).limit(200);
    if (error) toast.push({ kind: "error", title: "Could not load the log", body: cleanError(error) });
    setRows((data ?? []) as Row[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3" data-testid="admin-audit">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">The latest 200 changes to towers, users, forms and settings. Times are India time.</p>
        <Button tone="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>
      {rows === null ? (
        <div className="grid place-items-center p-12"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" data-testid="audit-row">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{stamp(r.created_at)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.actor_email ?? "system"}</td>
                  <td className="px-3 py-2">{describe(r)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
