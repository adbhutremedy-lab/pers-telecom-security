"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui";
import TowersAdmin from "./TowersAdmin";
import TeamsAdmin from "./TeamsAdmin";
import UsersAdmin from "./UsersAdmin";
import FormsAdmin from "./FormsAdmin";
import SettingsAdmin from "./SettingsAdmin";
import ImportAdmin from "./ImportAdmin";
import AuditAdmin from "./AuditAdmin";

const TABS = [
  { id: "towers", label: "Towers", C: TowersAdmin },
  { id: "teams", label: "Teams", C: TeamsAdmin },
  { id: "users", label: "Users", C: UsersAdmin },
  { id: "forms", label: "Forms", C: FormsAdmin },
  { id: "settings", label: "Settings", C: SettingsAdmin },
  { id: "import", label: "Excel import", C: ImportAdmin },
  { id: "audit", label: "Change log", C: AuditAdmin },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminClient() {
  const [tab, setTab] = useState<TabId>("towers");
  const Active = TABS.find((t) => t.id === tab)!.C;
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <PageHeader title="Admin" subtitle="Towers, teams, people, forms and rules" />
      <div role="tablist" aria-label="Admin sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-medium ${tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
