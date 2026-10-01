"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { cleanError } from "@/lib/format";
import { Button, Field, Modal, TowerBadge, inputCls } from "./ui";
import { useToast } from "./Toast";
import type { TowerStatus } from "@/lib/types";

export interface TriggerTarget {
  id: string;
  tower_number: string;
  site_name: string;
  region: string;
  status: TowerStatus;
}

const RESULT_TEXT: Record<string, string> = {
  OFFERED: "Offer sent to the nearest available team.",
  EXHAUSTED: "No team is available right now. The system will keep retrying and you can assign a team by hand.",
};

export default function TriggerIncidentModal({
  tower,
  source,
  onClose,
  onDone,
}: {
  tower: TriggerTarget | null;
  source: "MAP_MENU" | "CREATE_FORM";
  onClose: () => void;
  onDone?: (incidentId: string) => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!tower) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabaseBrowser().rpc("trigger_incident", {
      p_tower_id: tower.id,
      p_source: source,
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      setError(cleanError(error));
      return;
    }
    const res = data as { id: string; incident_number: string; dispatch_result?: string };
    toast.push({
      kind: res.dispatch_result === "EXHAUSTED" ? "warning" : "success",
      title: `Incident ${res.incident_number} created`,
      body: RESULT_TEXT[res.dispatch_result ?? ""] ?? undefined,
    });
    setNotes("");
    onDone?.(res.id);
    onClose();
  }

  return (
    <Modal
      open={!!tower}
      title="Trigger incident"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button tone="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="danger" onClick={submit} busy={busy}>
            <AlertTriangle className="h-4 w-4" /> Trigger incident
          </Button>
        </>
      }
    >
      {tower && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-900">{tower.tower_number}</p>
              <TowerBadge status={tower.status} />
            </div>
            <p className="text-sm text-slate-600">{tower.site_name}</p>
            <p className="text-xs text-slate-500">{tower.region}</p>
          </div>
          <p className="text-sm text-slate-600">
            The nearest available RRT will receive an alert and has <strong>30 seconds</strong> to accept. If it does not, the next nearest team is alerted automatically.
          </p>
          <Field label="Notes (optional)">
            <textarea className={inputCls} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Door-open alarm reported by NOC" />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
