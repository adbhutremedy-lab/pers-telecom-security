"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronLeft, FileUp, ImagePlus, Loader2, Trash2 } from "lucide-react";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase/client";
import { prepareFile } from "@/lib/photo";
import { cleanError } from "@/lib/format";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import type { CustomQuestion, IncidentDetail, UploadedFile } from "@/lib/types";
import type { Fix } from "@/hooks/useGps";

interface Props {
  job: IncidentDetail;
  fix: Fix | null;
  onClose: () => void;
  onResolved: (result: { incident_number: string; resolution_seconds: number | null }) => void;
}

type Answers = Record<string, unknown>;

const draftKey = (id: string) => `pers-draft-${id}`;
const loadDraft = (id: string): Answers => {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) ?? "{}") as Answers;
  } catch {
    return {};
  }
};
const saveDraft = (id: string, a: Answers) => {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(a));
  } catch {
    /* drafts are a convenience only */
  }
};
export const clearDraft = (id: string) => {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
};

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The resolution form: questions come from the database (Admin can change them), photos are uploaded as soon as they are chosen. */
export default function ResolveForm({ job, fix, onClose, onResolved }: Props) {
  const profile = useProfile();
  const toast = useToast();
  const sb = supabaseBrowser();

  const [questions, setQuestions] = useState<CustomQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>(() => loadDraft(job.id));
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    saveDraft(job.id, answers);
  }, [answers, job.id]);

  // load questions + files already uploaded for this incident
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        let formId = job.form_id;
        if (!formId) {
          const f = await sb.from("custom_forms").select("id").eq("is_default", true).eq("is_active", true).limit(1);
          if (f.error) throw f.error;
          formId = (f.data?.[0]?.id as string | undefined) ?? null;
        }
        if (!formId) throw new Error("No resolution form is configured. Ask the control room.");
        const [q, p] = await Promise.all([
          sb
            .from("custom_questions")
            .select("id, form_id, position, label, help_text, type, is_required, options, scale_min, scale_max, min_files, max_files, multiline, is_active")
            .eq("form_id", formId)
            .eq("is_active", true)
            .order("position", { ascending: true }),
          sb.from("incident_photos").select("id, question_id, storage_path, file_name, mime_type, kind").eq("incident_id", job.id),
        ]);
        if (q.error) throw q.error;
        if (off) return;
        setQuestions((q.data ?? []) as unknown as CustomQuestion[]);
        const existing = (p.data ?? []) as UploadedFile[];
        setFiles(existing);
        const imgs = existing.filter((f) => f.mime_type.startsWith("image/"));
        if (imgs.length) {
          const s = await sb.storage.from("incident-media").createSignedUrls(imgs.map((i) => i.storage_path), 3600);
          if (!off && s.data) {
            const map: Record<string, string> = {};
            s.data.forEach((d, i) => {
              if (d.signedUrl) map[imgs[i].id] = d.signedUrl;
            });
            setThumbs((t) => ({ ...map, ...t }));
          }
        }
      } catch (e) {
        if (!off) setLoadError(cleanError(e));
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, job.form_id]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const setAnswer = useCallback((id: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setInvalid((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  const filesFor = (qid: string) => files.filter((f) => f.question_id === qid);

  async function addFiles(q: CustomQuestion, list: FileList | null) {
    if (!list || list.length === 0) return;
    const room = Math.max(0, q.max_files - filesFor(q.id).length);
    const picked = Array.from(list).slice(0, room);
    if (picked.length < list.length) toast.push({ kind: "warning", title: `At most ${q.max_files} file(s) here`, body: "Extra files were skipped." });
    for (const file of picked) {
      setUploading((u) => ({ ...u, [q.id]: (u[q.id] ?? 0) + 1 }));
      let path = "";
      try {
        const prep = await prepareFile(file);
        path = `${job.incident_number}/${crypto.randomUUID()}.${prep.ext}`;
        const up = await sb.storage.from("incident-media").upload(path, prep.blob, { contentType: prep.mime, upsert: false });
        if (up.error) throw new Error(up.error.message);
        const ins = await sb
          .from("incident_photos")
          .insert({
            incident_id: job.id,
            question_id: q.id,
            kind: q.type === "FILE" ? "FILE" : "PHOTO",
            storage_path: path,
            file_name: file.name.slice(0, 120),
            mime_type: prep.mime,
            original_format: prep.originalFormat,
            size_bytes: prep.blob.size,
            lat: fix?.lat ?? null,
            lng: fix?.lng ?? null,
            uploaded_by: profile.id,
          })
          .select("id, question_id, storage_path, file_name, mime_type, kind");
        if (ins.error) throw new Error(ins.error.message);
        const row = (ins.data as UploadedFile[] | null)?.[0];
        if (!row) throw new Error("The file was uploaded but could not be saved. Try again.");
        if (prep.mime.startsWith("image/") && !prep.mime.includes("heic") && !prep.mime.includes("heif")) {
          const u = URL.createObjectURL(prep.blob);
          urls.current.push(u);
          setThumbs((t) => ({ ...t, [row.id]: u }));
        }
        setFiles((f) => [...f, row]);
        setInvalid((s) => {
          const n = new Set(s);
          n.delete(q.id);
          return n;
        });
      } catch (e) {
        if (path) void sb.storage.from("incident-media").remove([path]);
        toast.push({ kind: "error", title: "Upload failed", body: cleanError(e) });
      } finally {
        setUploading((u) => ({ ...u, [q.id]: Math.max(0, (u[q.id] ?? 1) - 1) }));
      }
    }
  }

  async function removeFile(f: UploadedFile) {
    setFiles((list) => list.filter((x) => x.id !== f.id));
    const d = await sb.from("incident_photos").delete().eq("id", f.id);
    if (d.error) {
      setFiles((list) => [...list, f]);
      toast.push({ kind: "error", title: "Could not remove the file", body: cleanError(d.error) });
      return;
    }
    void sb.storage.from("incident-media").remove([f.storage_path]);
  }

  const busyUploading = Object.values(uploading).some((n) => n > 0);

  const need = useCallback((q: CustomQuestion) => (q.type === "PHOTO" || q.type === "FILE" ? Math.max(q.min_files, q.is_required ? 1 : 0) : q.is_required ? 1 : 0), []);

  async function submit() {
    if (!questions) return;
    setFormError(null);
    const bad = new Set<string>();
    for (const q of questions) {
      if (q.type === "PHOTO" || q.type === "FILE") {
        if (filesFor(q.id).length < need(q)) bad.add(q.id);
      } else if (q.is_required && isEmpty(answers[q.id])) bad.add(q.id);
    }
    setInvalid(bad);
    if (bad.size > 0) {
      setFormError(`Please complete ${bad.size} required question${bad.size > 1 ? "s" : ""} (marked in red).`);
      const first = questions.find((q) => bad.has(q.id));
      if (first) document.getElementById(`q-${first.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (busyUploading) {
      setFormError("A photo is still uploading. Wait a moment.");
      return;
    }
    const payload = questions
      .filter((q) => q.type !== "PHOTO" && q.type !== "FILE" && !isEmpty(answers[q.id]))
      .map((q) => ({ question_id: q.id, value: typeof answers[q.id] === "string" ? (answers[q.id] as string).trim() : answers[q.id] }));

    setSubmitting(true);
    const { data, error } = await sb.rpc("resolve_incident", { p_incident_id: job.id, p_answers: payload });
    setSubmitting(false);
    if (error) {
      setFormError(cleanError(error));
      return;
    }
    clearDraft(job.id);
    const r = (data ?? {}) as { incident_number?: string; resolution_seconds?: number | null };
    onResolved({ incident_number: r.incident_number ?? job.incident_number, resolution_seconds: r.resolution_seconds ?? null });
  }

  const requiredCount = useMemo(() => (questions ?? []).filter((q) => need(q) > 0).length, [questions, need]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink-900 text-white" data-testid="resolve-form">
      <header className="flex items-center gap-2 border-b border-white/10 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Back" className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-base font-bold">Resolution report</p>
          <p className="truncate text-xs text-slate-300">
            {job.incident_number} · {job.tower_number} {job.tower_name}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {job.status === "ASSIGNED" && (
          <p className="mb-4 rounded-xl bg-yellow-400/15 px-3 py-2 text-sm text-yellow-100">
            The system has not detected you at the tower yet. If you submit now, your arrival is recorded as manual.
          </p>
        )}
        {loadError && <p className="rounded-xl bg-red-500/20 px-3 py-3 text-sm text-red-100">{loadError}</p>}
        {!questions && !loadError && (
          <div className="grid place-items-center py-16 text-slate-300">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        )}

        {questions && (
          <div className="space-y-5">
            <p className="text-xs text-slate-400">{requiredCount} required question{requiredCount === 1 ? "" : "s"}</p>
            {questions.map((q, idx) => {
              const bad = invalid.has(q.id);
              const v = answers[q.id];
              const mine = filesFor(q.id);
              return (
                <section key={q.id} id={`q-${q.id}`} className={clsx("rounded-2xl border p-4", bad ? "border-red-400 bg-red-500/10" : "border-white/10 bg-ink-800")}>
                  <h2 className="text-base font-semibold leading-snug">
                    <span className="mr-1 text-slate-400">{idx + 1}.</span>
                    {q.label}
                    {need(q) > 0 && <span className="ml-1 text-red-300">*</span>}
                  </h2>
                  {q.help_text && <p className="mt-0.5 text-sm text-slate-400">{q.help_text}</p>}

                  <div className="mt-3">
                    {q.type === "YES_NO" && (
                      <div className="grid grid-cols-2 gap-3">
                        {[true, false].map((b) => (
                          <button
                            key={String(b)}
                            type="button"
                            onClick={() => setAnswer(q.id, b)}
                            aria-pressed={v === b}
                            className={clsx("h-14 rounded-xl border-2 text-lg font-bold", v === b ? (b ? "border-green-400 bg-green-500 text-white" : "border-red-400 bg-red-500 text-white") : "border-white/20 text-slate-200")}
                          >
                            {b ? "Yes" : "No"}
                          </button>
                        ))}
                      </div>
                    )}

                    {q.type === "RATING" && (
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: (q.scale_max ?? 5) - (q.scale_min ?? 1) + 1 }, (_, k) => (q.scale_min ?? 1) + k).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setAnswer(q.id, n)}
                            aria-pressed={v === n}
                            className={clsx("h-12 min-w-12 flex-1 rounded-xl border-2 text-lg font-bold", v === n ? "border-brand-500 bg-brand-600 text-white" : "border-white/20 text-slate-200")}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    )}

                    {q.type === "TEXT" && (
                      <textarea
                        value={typeof v === "string" ? v : ""}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                        rows={q.multiline ? 4 : 2}
                        maxLength={4000}
                        placeholder="Type here"
                        className="w-full rounded-xl border border-white/20 bg-ink-900 px-3 py-3 text-base text-white outline-none placeholder:text-slate-500 focus:border-brand-500"
                      />
                    )}

                    {q.type === "DROPDOWN" && (
                      <select
                        value={typeof v === "string" ? v : ""}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                        className="h-12 w-full rounded-xl border border-white/20 bg-ink-900 px-3 text-base text-white outline-none focus:border-brand-500"
                      >
                        <option value="">Choose…</option>
                        {q.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    )}

                    {q.type === "MULTI_SELECT" && (
                      <div className="flex flex-wrap gap-2">
                        {q.options.map((o) => {
                          const arr = Array.isArray(v) ? (v as string[]) : [];
                          const on = arr.includes(o);
                          return (
                            <button
                              key={o}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setAnswer(q.id, on ? arr.filter((x) => x !== o) : [...arr, o])}
                              className={clsx("min-h-11 rounded-full border-2 px-4 text-sm font-semibold", on ? "border-brand-500 bg-brand-600 text-white" : "border-white/20 text-slate-200")}
                            >
                              {o}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {(q.type === "PHOTO" || q.type === "FILE") && (
                      <div>
                        <div className="grid grid-cols-3 gap-2">
                          {mine.map((f) => (
                            <div key={f.id} className="relative aspect-square overflow-hidden rounded-xl border border-white/15 bg-ink-900" data-testid="photo-thumb">
                              {thumbs[f.id] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumbs[f.id]} alt={f.file_name ?? "photo"} className="h-full w-full object-cover" />
                              ) : (
                                <div className="grid h-full place-items-center p-2 text-center text-[11px] text-slate-300">{f.file_name ?? "file"}</div>
                              )}
                              <button
                                type="button"
                                onClick={() => void removeFile(f)}
                                aria-label="Remove file"
                                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                          {(uploading[q.id] ?? 0) > 0 && (
                            <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-white/30 text-slate-300">
                              <Loader2 className="h-6 w-6 animate-spin" />
                            </div>
                          )}
                        </div>
                        {mine.length < q.max_files && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {q.type === "PHOTO" ? (
                              <>
                                <label className="inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-semibold text-white">
                                  <Camera className="h-5 w-5" /> Take photo
                                  <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="photo-camera" onChange={(e) => { void addFiles(q, e.target.files); e.target.value = ""; }} />
                                </label>
                                <label className="inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-white/25 px-4 text-base font-semibold text-slate-100">
                                  <ImagePlus className="h-5 w-5" /> Gallery
                                  <input type="file" accept="image/*" multiple className="sr-only" data-testid="photo-gallery" onChange={(e) => { void addFiles(q, e.target.files); e.target.value = ""; }} />
                                </label>
                              </>
                            ) : (
                              <label className="inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-base font-semibold text-white">
                                <FileUp className="h-5 w-5" /> Choose file
                                <input type="file" multiple className="sr-only" onChange={(e) => { void addFiles(q, e.target.files); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                        )}
                        <p className="mt-2 text-xs text-slate-400">
                          {mine.length} of {q.max_files} added{need(q) > 0 ? ` · at least ${need(q)} needed` : ""}
                        </p>
                      </div>
                    )}
                  </div>
                  {bad && <p className="mt-2 text-sm font-medium text-red-300">This is required.</p>}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <footer className="border-t border-white/10 bg-ink-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {formError && (
          <p role="alert" className="mb-3 rounded-xl bg-red-500/20 px-3 py-2 text-sm text-red-100" data-testid="form-error">
            {formError}
          </p>
        )}
        <button
          onClick={() => void submit()}
          disabled={!questions || submitting || busyUploading}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-green-600 text-lg font-extrabold text-white disabled:opacity-50"
          data-testid="submit-resolve"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-6 w-6" />}
          {busyUploading ? "Uploading photo…" : "Submit and resolve"}
        </button>
      </footer>
    </div>
  );
}
