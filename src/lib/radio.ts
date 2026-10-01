"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export const MAX_VOICE_SECONDS = 30;
export const MIN_VOICE_SECONDS = 0.5;
export const MAX_TEXT = 500;
export const VOICE_BUCKET = "voice-messages";

export type MessageKind = "TEXT" | "VOICE";
export type TargetType = "TEAM" | "ALL_ONLINE" | "CONTROL_ROOM";

export interface RadioMessage {
  id: string;
  kind: MessageKind;
  body: string | null;
  audio_path: string | null;
  audio_seconds: number | null;
  audio_mime: string | null;
  sender_id: string | null;
  sender_label: string;
  sender_team_id: string | null;
  target_type: TargetType;
  target_team_id: string | null;
  recipient_team_ids: string[];
  created_at: string;
}
export interface Receipt {
  message_id: string;
  team_id: string;
  heard_at: string;
}
export const MESSAGE_COLUMNS =
  "id, kind, body, audio_path, audio_seconds, audio_mime, sender_id, sender_label, sender_team_id, target_type, target_team_id, recipient_team_ids, created_at";

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* try next */
    }
  }
  return "";
}

export const extFor = (mime: string) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");
/** The storage bucket only wants the plain type, without ";codecs=…". */
export const plainMime = (mime: string) => (mime.split(";")[0] || "audio/webm").trim();

export interface Clip {
  blob: Blob;
  seconds: number;
  mime: string;
}
export type RecState = "idle" | "starting" | "recording";

/** Push-to-talk recorder. start() on press, stop() on release (resolves with the clip, or null when too short). */
export function useRecorder(onAutoStop?: (clip: Clip | null) => void) {
  const [state, setState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const t0 = useRef(0);
  const tick = useRef<number | null>(null);
  const releaseTimer = useRef<number | null>(null);
  const cancelled = useRef(false);
  const resolver = useRef<((c: Clip | null) => void) | null>(null);
  const wantStop = useRef(false);
  const autoStopRef = useRef(onAutoStop);
  autoStopRef.current = onAutoStop;

  const dropStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (mime: string) => {
      if (tick.current) window.clearInterval(tick.current);
      tick.current = null;
      const secs = (Date.now() - t0.current) / 1000;
      const blob = new Blob(chunks.current, { type: mime || "audio/webm" });
      chunks.current = [];
      recRef.current = null;
      setState("idle");
      setSeconds(0);
      const clip: Clip | null = cancelled.current || secs < MIN_VOICE_SECONDS || blob.size < 200 ? null : { blob, seconds: Math.min(secs, MAX_VOICE_SECONDS + 0.5), mime: mime || "audio/webm" };
      const r = resolver.current;
      resolver.current = null;
      if (r) r(clip);
      else autoStopRef.current?.(clip);
      if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
      releaseTimer.current = window.setTimeout(dropStream, 20000); // keep the microphone ready for a quick second press
    },
    [dropStream],
  );

  const start = useCallback(async () => {
    if (state !== "idle") return false;
    setError(null);
    cancelled.current = false;
    wantStop.current = false;
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    setState("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("unsupported");
      if (!streamRef.current || streamRef.current.getTracks().every((t) => t.readyState === "ended")) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      }
      if (wantStop.current) {
        // the finger was lifted while the permission prompt / microphone was starting
        setState("idle");
        return false;
      }
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => finish(rec.mimeType || mime);
      recRef.current = rec;
      t0.current = Date.now();
      rec.start(250);
      setState("recording");
      setSeconds(0);
      tick.current = window.setInterval(() => {
        const s = (Date.now() - t0.current) / 1000;
        setSeconds(s);
        if (s >= MAX_VOICE_SECONDS && recRef.current?.state === "recording") recRef.current.stop();
      }, 100);
      return true;
    } catch (e) {
      setState("idle");
      const name = (e as { name?: string })?.name ?? "";
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone is blocked. Allow the microphone for this site in the browser settings."
          : name === "NotFoundError"
            ? "No microphone found on this device."
            : "Voice recording is not available in this browser.",
      );
      return false;
    }
  }, [state, finish]);

  const stop = useCallback((): Promise<Clip | null> => {
    wantStop.current = true;
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state !== "recording") return resolve(null);
      resolver.current = resolve;
      rec.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    wantStop.current = true;
    const rec = recRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }, []);

  useEffect(
    () => () => {
      if (tick.current) window.clearInterval(tick.current);
      if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
      try {
        if (recRef.current && recRef.current.state === "recording") {
          cancelled.current = true;
          recRef.current.stop();
        }
      } catch {
        /* ignore */
      }
      dropStream();
    },
    [dropStream],
  );

  return { state, seconds, error, start, stop, cancel, clearError: () => setError(null) };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
export interface SendTarget {
  type: TargetType;
  teamId?: string | null;
}

export async function sendText(text: string, target: SendTarget) {
  const { data, error } = await supabaseBrowser().rpc("send_message", {
    p_kind: "TEXT",
    p_text: text,
    p_audio_path: null,
    p_audio_seconds: null,
    p_audio_mime: null,
    p_target_type: target.type,
    p_target_team_id: target.teamId ?? null,
  });
  if (error) throw error;
  return data as { id: string; recipients: number };
}

export async function sendVoice(clip: Clip, target: SendTarget) {
  const sb = supabaseBrowser();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Please sign in again.");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, "0")).join("");
  const path = `${uid}/${Date.now().toString(36)}${rand}.${extFor(clip.mime)}`;
  const mime = plainMime(clip.mime);
  const up = await sb.storage.from(VOICE_BUCKET).upload(path, clip.blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await sb.rpc("send_message", {
    p_kind: "VOICE",
    p_text: null,
    p_audio_path: path,
    p_audio_seconds: Math.round(clip.seconds * 10) / 10,
    p_audio_mime: mime,
    p_target_type: target.type,
    p_target_team_id: target.teamId ?? null,
  });
  if (error) throw error;
  return data as { id: string; recipients: number };
}

// ---------------------------------------------------------------------------
// Playback: one shared player so two clips never talk over each other
// ---------------------------------------------------------------------------
interface PlayerState {
  playingId: string | null;
  blocked: boolean; // the browser refused to auto-play (needs a tap)
  queueLength: number;
}
interface QueueItem {
  id: string;
  path: string;
  onStart?: () => void;
}

const urlCache = new Map<string, { url: string; exp: number }>();
export async function voiceUrl(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabaseBrowser().storage.from(VOICE_BUCKET).createSignedUrls([path], 3600);
  const row = data?.[0];
  if (error || !row?.signedUrl) throw error ?? new Error("Could not open the voice file.");
  urlCache.set(path, { url: row.signedUrl, exp: Date.now() + 3_500_000 });
  return row.signedUrl;
}

class RadioPlayer {
  private audio: HTMLAudioElement | null = null;
  private queue: QueueItem[] = [];
  private hold = false;
  private listeners = new Set<() => void>();
  private snap: PlayerState = { playingId: null, blocked: false, queueLength: 0 };
  /** called when a clip starts playing */
  onStarted: ((id: string) => void) | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.snap;
  private set(p: Partial<PlayerState>) {
    this.snap = { ...this.snap, ...p, queueLength: this.queue.length };
    this.listeners.forEach((l) => l());
  }

  setHold(h: boolean) {
    this.hold = h;
    if (!h && !this.snap.playingId) void this.next();
  }

  /** Play right now (user tapped). */
  async playNow(id: string, path: string, onStart?: () => void) {
    this.stopCurrent();
    this.queue = this.queue.filter((q) => q.id !== id);
    await this.run({ id, path, onStart }, true);
  }

  /** Auto-play: waits for the clip in front of it and for any hold. */
  enqueue(item: QueueItem) {
    if (this.queue.some((q) => q.id === item.id) || this.snap.playingId === item.id) return;
    this.queue.push(item);
    this.set({});
    if (!this.snap.playingId && !this.hold) void this.next();
  }

  private async next() {
    if (this.hold || this.snap.playingId) return;
    const item = this.queue.shift();
    this.set({});
    if (item) await this.run(item, false);
  }

  private async run(item: QueueItem, user: boolean) {
    try {
      const url = await voiceUrl(item.path);
      const a = new Audio(url);
      a.preload = "auto";
      this.audio = a;
      a.onended = () => {
        this.audio = null;
        this.set({ playingId: null });
        void this.next();
      };
      a.onerror = () => {
        this.audio = null;
        this.set({ playingId: null });
        void this.next();
      };
      this.set({ playingId: item.id });
      await a.play();
      this.set({ blocked: false });
      item.onStart?.();
      this.onStarted?.(item.id);
    } catch (e) {
      this.audio = null;
      const blocked = !user && (e as { name?: string })?.name === "NotAllowedError";
      this.set({ playingId: null, blocked: blocked || this.snap.blocked });
      if (blocked) this.queue.unshift(item); // keep it for the next tap
      this.set({});
      if (!blocked) void this.next();
    }
  }

  /** Called from any tap: retry clips the browser refused to auto-play. */
  retryBlocked() {
    if (this.snap.blocked) {
      this.set({ blocked: false });
      void this.next();
    }
  }

  private stopCurrent() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    this.set({ playingId: null });
  }
  stop() {
    this.stopCurrent();
  }
  clearQueue() {
    this.queue = [];
    this.set({});
  }
}

export const radioPlayer = typeof window !== "undefined" ? new RadioPlayer() : (null as unknown as RadioPlayer);

const SERVER_SNAP: PlayerState = { playingId: null, blocked: false, queueLength: 0 };
export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    radioPlayer ? radioPlayer.subscribe : () => () => {},
    radioPlayer ? radioPlayer.getSnapshot : () => SERVER_SNAP,
    () => SERVER_SNAP,
  );
}
