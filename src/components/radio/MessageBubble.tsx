"use client";

import { Check, CheckCheck, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { fmtTime } from "@/lib/format";
import { radioPlayer, usePlayer, type RadioMessage } from "@/lib/radio";

interface Props {
  msg: RadioMessage;
  mine: boolean;
  tone?: "light" | "dark";
  /** teams that read / played it (only for messages sent by the control room) */
  heardBy?: string[];
  /** codes of the teams it was addressed to, for "heard by 1 of 3" */
  recipientCodes?: string[];
  onPlayed?: (m: RadioMessage) => void;
  showSender?: boolean;
}

const BARS = [6, 12, 8, 16, 10, 18, 7, 14, 9, 17, 11, 6, 13, 8, 15, 10];

export default function MessageBubble({ msg, mine, tone = "light", heardBy, recipientCodes, onPlayed, showSender }: Props) {
  const player = usePlayer();
  const playing = player.playingId === msg.id;
  const dark = tone === "dark";
  const total = recipientCodes?.length ?? 0;
  const heard = heardBy?.length ?? 0;

  function toggle() {
    if (!msg.audio_path) return;
    if (playing) radioPlayer.stop();
    else void radioPlayer.playNow(msg.id, msg.audio_path, () => onPlayed?.(msg));
  }

  return (
    <div className={clsx("flex", mine ? "justify-end" : "justify-start")} data-testid="msg" data-kind={msg.kind} data-mine={mine ? "1" : "0"}>
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm",
          mine ? "rounded-br-md bg-brand-600 text-white" : dark ? "rounded-bl-md bg-white/10 text-white" : "rounded-bl-md bg-white text-slate-900 ring-1 ring-slate-200",
        )}
      >
        {showSender && !mine && <p className={clsx("mb-0.5 text-xs font-semibold", dark ? "text-sky-300" : "text-brand-700")}>{msg.sender_label}</p>}
        {msg.kind === "TEXT" ? (
          <p className="whitespace-pre-wrap break-words text-sm" data-testid="msg-text">{msg.body}</p>
        ) : (
          <button type="button" onClick={toggle} data-testid="msg-play" aria-label={playing ? "Stop" : "Play voice message"} className="flex items-center gap-3">
            <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-full", mine ? "bg-white/20" : dark ? "bg-white/15" : "bg-brand-600 text-white")}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
            </span>
            <span className="flex h-8 items-center gap-[3px]" aria-hidden>
              {BARS.map((h, i) => (
                <span key={i} style={{ height: h }} className={clsx("w-[3px] rounded-full", playing ? "animate-pulse" : "", mine ? "bg-white/80" : dark ? "bg-white/60" : "bg-brand-500")} />
              ))}
            </span>
            <span className="text-xs tabular-nums opacity-90">{(msg.audio_seconds ?? 0).toFixed(0)} s</span>
          </button>
        )}
        <p className={clsx("mt-1 flex items-center justify-end gap-1 text-[11px]", mine ? "text-white/70" : dark ? "text-slate-400" : "text-slate-400")}>
          {mine && msg.target_type === "ALL_ONLINE" && <span>to all online · </span>}
          {fmtTime(msg.created_at)}
          {mine && recipientCodes && total > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5" data-testid="msg-status" title={heard ? `${msg.kind === "VOICE" ? "Played" : "Read"} by ${heardBy!.join(", ")}` : "Sent"}>
              {heard > 0 ? <CheckCheck className="h-3.5 w-3.5 text-sky-200" /> : <Check className="h-3.5 w-3.5" />}
              {total > 1 || heard > 0 ? `${heard}/${total}` : ""}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
