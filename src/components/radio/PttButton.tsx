"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Loader2 } from "lucide-react";
import clsx from "clsx";
import { MAX_VOICE_SECONDS, useRecorder, type Clip } from "@/lib/radio";
import { beep } from "@/lib/sound";

interface Props {
  /** Called with the recorded clip; should upload + send, and throw on failure. */
  onSend: (clip: Clip) => Promise<void>;
  disabled?: boolean;
  /** what the voice goes to, shown under the button, e.g. "RRT-01" or "all online teams" */
  toLabel: string;
  tone?: "light" | "dark";
  onError?: (msg: string) => void;
}

const CANCEL_PX = 90;

/** Hold to talk, release to send. Slide up (or press Escape) to cancel. Space / Enter also work. */
export default function PttButton({ onSend, disabled, toLabel, tone = "light", onError }: Props) {
  const [sending, setSending] = useState(false);
  const [willCancel, setWillCancel] = useState(false);
  const startY = useRef(0);
  const down = useRef(false);
  const rec = useRecorder(async (clip) => {
    // reached the maximum length while still holding
    if (clip) await deliver(clip);
  });

  useEffect(() => {
    if (rec.error) onError?.(rec.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.error]);

  async function deliver(clip: Clip) {
    setSending(true);
    try {
      await onSend(clip);
      beep("ok");
    } catch (e) {
      onError?.((e as { message?: string })?.message ?? "Could not send the voice message.");
    } finally {
      setSending(false);
    }
  }

  async function begin() {
    if (disabled || sending || down.current) return;
    down.current = true;
    setWillCancel(false);
    const ok = await rec.start();
    if (ok) navigator.vibrate?.(25);
  }
  async function end(cancel: boolean) {
    if (!down.current) return;
    down.current = false;
    if (cancel) {
      rec.cancel();
      setWillCancel(false);
      return;
    }
    const clip = await rec.stop();
    if (clip) await deliver(clip);
  }

  const recording = rec.state === "recording";
  const dark = tone === "dark";
  return (
    <div className="flex flex-col items-center gap-2 select-none" data-testid="ptt">
      <button
        type="button"
        data-testid="ptt-button"
        aria-label={`Hold to talk to ${toLabel}`}
        disabled={disabled}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          startY.current = e.clientY;
          void begin();
        }}
        onPointerMove={(e) => {
          if (!down.current) return;
          setWillCancel(startY.current - e.clientY > CANCEL_PX);
        }}
        onPointerUp={(e) => {
          void end(startY.current - e.clientY > CANCEL_PX);
        }}
        onPointerCancel={() => void end(true)}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            void begin();
          } else if (e.key === "Escape") void end(true);
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            void end(false);
          }
        }}
        style={{ touchAction: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none" }}
        className={clsx(
          "grid h-28 w-28 place-items-center rounded-full border-8 text-white shadow-lg outline-none transition focus-visible:ring-4 focus-visible:ring-brand-400 disabled:opacity-50",
          recording ? (willCancel ? "scale-95 border-slate-300 bg-slate-500" : "scale-105 border-red-300/70 bg-red-600") : dark ? "border-white/20 bg-brand-600" : "border-brand-100 bg-brand-600",
        )}
      >
        {sending || rec.state === "starting" ? <Loader2 className="h-9 w-9 animate-spin" /> : <Mic className={clsx("h-10 w-10", recording && "animate-pulse")} />}
      </button>
      <div className={clsx("min-h-[2.5rem] text-center text-xs", dark ? "text-slate-300" : "text-slate-500")} aria-live="polite" data-testid="ptt-hint">
        {recording ? (
          <span className={clsx("font-semibold", willCancel ? (dark ? "text-slate-200" : "text-slate-600") : "text-red-500")}>
            {willCancel ? "Release to cancel" : `Recording ${rec.seconds.toFixed(1)} s / ${MAX_VOICE_SECONDS} s · release to send`}
          </span>
        ) : sending ? (
          "Sending…"
        ) : (
          <>
            Hold to talk to <b>{toLabel}</b>
            <br />
            Slide up to cancel
          </>
        )}
      </div>
    </div>
  );
}
