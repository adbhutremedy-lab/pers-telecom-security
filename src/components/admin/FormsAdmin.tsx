"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, Field, Modal, Spinner, inputCls } from "@/components/ui";
import { cleanError } from "@/lib/format";

type QType = "YES_NO" | "RATING" | "TEXT" | "DROPDOWN" | "MULTI_SELECT" | "PHOTO" | "FILE";
const TYPE_LABEL: Record<QType, string> = {
  YES_NO: "Yes / No",
  RATING: "Rating (stars or scale)",
  TEXT: "Text answer",
  DROPDOWN: "Pick one from a list",
  MULTI_SELECT: "Pick several from a list",
  PHOTO: "Photos",
  FILE: "File upload",
};
interface FormRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_default: boolean;
  version: number;
}
interface Question {
  id: string;
  form_id: string;
  position: number;
  label: string;
  help_text: string | null;
  type: QType;
  is_required: boolean;
  scale_min: number | null;
  scale_max: number | null;
  options: string[];
  multiline: boolean;
  min_files: number;
  max_files: number;
}
interface QEdit {
  id?: string;
  label: string;
  help_text: string;
  type: QType;
  is_required: boolean;
  scale_min: string;
  scale_max: string;
  options: string;
  multiline: boolean;
  min_files: string;
  max_files: string;
}
const BLANK_Q: QEdit = { label: "", help_text: "", type: "YES_NO", is_required: false, scale_min: "1", scale_max: "5", options: "", multiline: false, min_files: "0", max_files: "5" };

export default function FormsAdmin() {
  const toast = useToast();
  const me = useProfile();
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [qs, setQs] = useState<Question[] | null>(null);
  const [formEdit, setFormEdit] = useState<{ id?: string; name: string; description: string; dupOf?: string } | null>(null);
  const [qEdit, setQEdit] = useState<QEdit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadForms = useCallback(async () => {
    const sb = supabaseBrowser();
    const [f, q] = await Promise.all([
      sb.from("custom_forms").select("id, name, description, is_active, is_default, version").order("created_at"),
      sb.from("custom_questions").select("form_id"),
    ]);
    if (f.error) toast.push({ kind: "error", title: "Could not load forms", body: cleanError(f.error) });
    const list = (f.data ?? []) as FormRow[];
    setForms(list);
    const c: Record<string, number> = {};
    for (const r of (q.data ?? []) as { form_id: string }[]) c[r.form_id] = (c[r.form_id] ?? 0) + 1;
    setCounts(c);
    setSel((cur) => (cur && list.some((x) => x.id === cur) ? cur : list.find((x) => x.is_default)?.id ?? list[0]?.id ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQs = useCallback(async (formId: string) => {
    const { data, error } = await supabaseBrowser()
      .from("custom_questions")
      .select("id, form_id, position, label, help_text, type, is_required, scale_min, scale_max, options, multiline, min_files, max_files")
      .eq("form_id", formId)
      .order("position");
    if (error) toast.push({ kind: "error", title: "Could not load questions", body: cleanError(error) });
    setQs(((data ?? []) as Question[]).map((x) => ({ ...x, options: Array.isArray(x.options) ? x.options : [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);
  useEffect(() => {
    setQs(null);
    if (sel) void loadQs(sel);
  }, [sel, loadQs]);

  const current = forms?.find((f) => f.id === sel) ?? null;

  async function saveForm() {
    if (!formEdit) return;
    setErr(null);
    const name = formEdit.name.trim();
    if (!name) return setErr("Give the form a name.");
    setBusy(true);
    const sb = supabaseBrowser();
    let newId: string | null = null;
    if (formEdit.dupOf) {
      const { data, error } = await sb.rpc("admin_duplicate_form", { p_form_id: formEdit.dupOf, p_name: name });
      setBusy(false);
      if (error) return setErr(cleanError(error));
      newId = (data as string) ?? null;
    } else if (formEdit.id) {
      const { error } = await sb.from("custom_forms").update({ name, description: formEdit.description.trim() || null }).eq("id", formEdit.id);
      setBusy(false);
      if (error) return setErr(cleanError(error));
    } else {
      const { data, error } = await sb.from("custom_forms").insert({ name, description: formEdit.description.trim() || null, created_by: me.id }).select("id");
      setBusy(false);
      if (error) return setErr(cleanError(error));
      newId = (data as { id: string }[] | null)?.[0]?.id ?? null;
    }
    toast.push({ kind: "success", title: formEdit.dupOf ? "Form copied" : formEdit.id ? "Form saved" : "Form created", body: name });
    setFormEdit(null);
    if (newId) setSel(newId);
    void loadForms();
  }

  async function setDefault(f: FormRow) {
    const { error } = await supabaseBrowser().from("custom_forms").update({ is_default: true, is_active: true }).eq("id", f.id);
    if (error) return toast.push({ kind: "error", title: "Could not set default", body: cleanError(error) });
    toast.push({ kind: "success", title: "Default form changed", body: `New incidents will use "${f.name}"` });
    void loadForms();
  }
  async function toggleActive(f: FormRow) {
    if (f.is_default && f.is_active) return toast.push({ kind: "error", title: "This is the default form", body: "Make another form the default first, then deactivate this one." });
    const { error } = await supabaseBrowser().from("custom_forms").update({ is_active: !f.is_active }).eq("id", f.id);
    if (error) return toast.push({ kind: "error", title: "Could not change form", body: cleanError(error) });
    void loadForms();
  }

  async function saveQuestion() {
    if (!qEdit || !sel) return;
    setErr(null);
    const label = qEdit.label.trim();
    if (!label) return setErr("Write the question.");
    const base: Record<string, unknown> = {
      label,
      help_text: qEdit.help_text.trim() || null,
      type: qEdit.type,
      is_required: qEdit.is_required,
      scale_min: null,
      scale_max: null,
      options: [],
      multiline: false,
      min_files: 0,
      max_files: 5,
    };
    if (qEdit.type === "RATING") {
      const a = Number(qEdit.scale_min);
      const b = Number(qEdit.scale_max);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a >= b) return setErr("For a rating, the lowest number must be smaller than the highest (for example 1 and 5).");
      if (b - a > 20) return setErr("A rating can have at most 21 steps.");
      base.scale_min = a;
      base.scale_max = b;
    }
    if (qEdit.type === "DROPDOWN" || qEdit.type === "MULTI_SELECT") {
      const opts = [...new Set(qEdit.options.split("\n").map((s) => s.trim()).filter(Boolean))];
      if (opts.length < 2) return setErr("Type at least two choices, one per line.");
      base.options = opts;
    }
    if (qEdit.type === "TEXT") base.multiline = qEdit.multiline;
    if (qEdit.type === "PHOTO" || qEdit.type === "FILE") {
      const mn = Number(qEdit.min_files);
      const mx = Number(qEdit.max_files);
      if (!Number.isInteger(mn) || !Number.isInteger(mx) || mn < 0 || mx < 1 || mx < mn || mx > 20) return setErr("Files: 'at least' must be 0 or more, and 'at most' between 1 and 20 and not below 'at least'.");
      base.min_files = mn;
      base.max_files = mx;
    }
    setBusy(true);
    const sb = supabaseBrowser();
    const res = qEdit.id
      ? await sb.from("custom_questions").update(base).eq("id", qEdit.id)
      : await sb.from("custom_questions").insert({ ...base, form_id: sel, position: (qs ?? []).reduce((m, x) => Math.max(m, x.position), 0) + 1 });
    setBusy(false);
    if (res.error) return setErr(cleanError(res.error));
    toast.push({ kind: "success", title: qEdit.id ? "Question saved" : "Question added" });
    setQEdit(null);
    void loadQs(sel);
    void loadForms();
  }

  async function move(i: number, dir: -1 | 1) {
    if (!qs || !sel) return;
    const j = i + dir;
    if (j < 0 || j >= qs.length) return;
    const ids = qs.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const { error } = await supabaseBrowser().rpc("admin_reorder_questions", { p_form_id: sel, p_ids: ids });
    if (error) return toast.push({ kind: "error", title: "Could not reorder", body: cleanError(error) });
    void loadQs(sel);
  }

  async function remove(q: Question) {
    if (!sel) return;
    if (!window.confirm(`Delete the question "${q.label}"?\n\nAnswers already saved on past incidents are kept.`)) return;
    const { error } = await supabaseBrowser().from("custom_questions").delete().eq("id", q.id);
    if (error) return toast.push({ kind: "error", title: "Could not delete", body: cleanError(error) });
    void loadQs(sel);
    void loadForms();
  }

  function openQ(q?: Question) {
    setErr(null);
    setQEdit(
      q
        ? { id: q.id, label: q.label, help_text: q.help_text ?? "", type: q.type, is_required: q.is_required, scale_min: String(q.scale_min ?? 1), scale_max: String(q.scale_max ?? 5), options: q.options.join("\n"), multiline: q.multiline, min_files: String(q.min_files), max_files: String(q.max_files) }
        : { ...BLANK_Q },
    );
  }

  if (forms === null) return <div className="grid place-items-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-3" data-testid="admin-forms">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">The resolution form the RRT member fills in when an incident is resolved. The default form is used for every new incident.</p>
        <Button onClick={() => { setErr(null); setFormEdit({ name: "", description: "" }); }} data-testid="add-form"><Plus className="h-4 w-4" /> New form</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <ul className="space-y-2" aria-label="Forms">
          {forms.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => setSel(f.id)}
                data-testid="form-item"
                className={`w-full rounded-xl p-3 text-left ring-1 transition ${sel === f.id ? "bg-brand-50 ring-brand-500" : "bg-white ring-slate-200 hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{f.name}</span>
                  {f.is_default && <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800"><Star className="h-3 w-3" /> default</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{counts[f.id] ?? 0} questions · version {f.version}{!f.is_active && " · deactivated"}</div>
              </button>
            </li>
          ))}
        </ul>

        {current && (
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{current.name}</h2>
                {current.description && <p className="text-sm text-slate-500">{current.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button tone="outline" onClick={() => { setErr(null); setFormEdit({ id: current.id, name: current.name, description: current.description ?? "" }); }}><Pencil className="h-4 w-4" /> Rename</Button>
                <Button tone="outline" data-testid="dup-form" onClick={() => { setErr(null); setFormEdit({ name: `${current.name} (copy)`, description: current.description ?? "", dupOf: current.id }); }}><Copy className="h-4 w-4" /> Duplicate</Button>
                {!current.is_default && <Button tone="outline" data-testid="make-default" onClick={() => void setDefault(current)}><Star className="h-4 w-4" /> Make default</Button>}
                <Button tone="outline" onClick={() => void toggleActive(current)}>{current.is_active ? "Deactivate" : "Activate"}</Button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Questions</h3>
              <Button onClick={() => openQ()} data-testid="add-question"><Plus className="h-4 w-4" /> Add question</Button>
            </div>
            {qs === null ? (
              <div className="grid place-items-center p-8"><Spinner /></div>
            ) : qs.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No questions yet.</p>
            ) : (
              <ol className="mt-2 divide-y divide-slate-100" data-testid="question-list">
                {qs.map((q, i) => (
                  <li key={q.id} className="flex items-start gap-3 py-2.5" data-testid="question-row">
                    <span className="mt-0.5 w-6 shrink-0 text-center text-sm font-semibold text-slate-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{q.label}{q.is_required && <span className="ml-1 text-red-600" title="Required">*</span>}</div>
                      <div className="text-xs text-slate-500">
                        {TYPE_LABEL[q.type]}
                        {q.type === "RATING" && ` · ${q.scale_min} to ${q.scale_max}`}
                        {(q.type === "DROPDOWN" || q.type === "MULTI_SELECT") && ` · ${q.options.join(", ")}`}
                        {(q.type === "PHOTO" || q.type === "FILE") && ` · ${q.min_files}–${q.max_files} files`}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => void move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Move question ${i + 1} down`} disabled={i === qs.length - 1} onClick={() => void move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button tone="ghost" className="px-2 py-1" aria-label={`Edit question ${i + 1}`} onClick={() => openQ(q)}><Pencil className="h-4 w-4" /></Button>
                      <Button tone="ghost" className="px-2 py-1 text-red-600" aria-label={`Delete question ${i + 1}`} onClick={() => void remove(q)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      <Modal
        open={!!formEdit}
        title={formEdit?.dupOf ? "Duplicate form" : formEdit?.id ? "Rename form" : "New form"}
        onClose={() => setFormEdit(null)}
        footer={<><Button tone="outline" onClick={() => setFormEdit(null)}>Cancel</Button><Button onClick={saveForm} busy={busy} data-testid="save-form">Save</Button></>}
      >
        {formEdit && (
          <div className="space-y-3">
            <Field label="Form name"><input className={inputCls} value={formEdit.name} onChange={(e) => setFormEdit({ ...formEdit, name: e.target.value })} aria-label="Form name" /></Field>
            {!formEdit.dupOf && <Field label="Description (optional)"><input className={inputCls} value={formEdit.description} onChange={(e) => setFormEdit({ ...formEdit, description: e.target.value })} aria-label="Form description" /></Field>}
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!qEdit}
        wide
        title={qEdit?.id ? "Edit question" : "Add question"}
        onClose={() => setQEdit(null)}
        footer={<><Button tone="outline" onClick={() => setQEdit(null)}>Cancel</Button><Button onClick={saveQuestion} busy={busy} data-testid="save-question">Save</Button></>}
      >
        {qEdit && (
          <div className="space-y-3">
            <Field label="Question"><input className={inputCls} value={qEdit.label} onChange={(e) => setQEdit({ ...qEdit, label: e.target.value })} aria-label="Question" /></Field>
            <Field label="Help text (optional)" hint="Small grey line shown under the question on the phone"><input className={inputCls} value={qEdit.help_text} onChange={(e) => setQEdit({ ...qEdit, help_text: e.target.value })} aria-label="Help text" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Answer type">
                <select className={inputCls} value={qEdit.type} onChange={(e) => setQEdit({ ...qEdit, type: e.target.value as QType })} aria-label="Answer type">
                  {(Object.keys(TYPE_LABEL) as QType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </Field>
              <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={qEdit.is_required} onChange={(e) => setQEdit({ ...qEdit, is_required: e.target.checked })} aria-label="Required" /> Required
              </label>
            </div>
            {qEdit.type === "RATING" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lowest number"><input className={inputCls} inputMode="numeric" value={qEdit.scale_min} onChange={(e) => setQEdit({ ...qEdit, scale_min: e.target.value })} aria-label="Lowest number" /></Field>
                <Field label="Highest number"><input className={inputCls} inputMode="numeric" value={qEdit.scale_max} onChange={(e) => setQEdit({ ...qEdit, scale_max: e.target.value })} aria-label="Highest number" /></Field>
              </div>
            )}
            {(qEdit.type === "DROPDOWN" || qEdit.type === "MULTI_SELECT") && (
              <Field label="Choices" hint="One choice per line, at least two">
                <textarea className={inputCls} rows={5} value={qEdit.options} onChange={(e) => setQEdit({ ...qEdit, options: e.target.value })} aria-label="Choices" />
              </Field>
            )}
            {qEdit.type === "TEXT" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={qEdit.multiline} onChange={(e) => setQEdit({ ...qEdit, multiline: e.target.checked })} /> Long answer (several lines)
              </label>
            )}
            {(qEdit.type === "PHOTO" || qEdit.type === "FILE") && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="At least (files)"><input className={inputCls} inputMode="numeric" value={qEdit.min_files} onChange={(e) => setQEdit({ ...qEdit, min_files: e.target.value })} aria-label="At least files" /></Field>
                <Field label="At most (files)"><input className={inputCls} inputMode="numeric" value={qEdit.max_files} onChange={(e) => setQEdit({ ...qEdit, max_files: e.target.value })} aria-label="At most files" /></Field>
              </div>
            )}
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
