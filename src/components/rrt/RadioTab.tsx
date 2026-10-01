"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Volume2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import MessageBubble from "@/components/radio/MessageBubble";
import PttButton from "@/components/radio/PttButton";
import { cleanError } from "@/lib/format";
import { MAX_TEXT, radioPlayer, sendText, sendVoice, usePlayer, type Clip, type RadioMessage } from "@/lib/radio";

interface Props {
  messages: RadioMessage[];
  teamId: string;
  loaded: boolean;
  onPlayed: (m: RadioMessage) => void;
  onSent: () => void;
}

/** The phone's "radio": a chat with the control room plus a big push-to-talk button. */
export default function RadioTab({ messages, teamId, loaded, onPlayed, onSent }: Props) {
  const toast = useToast();
  const player = usePlayer();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await sendText(t, { type: "CONTROL_ROOM" });
      setText("");
      onSent();
    } catch (e) {
      toast.push({ kind: "error", title: "Message not sent", body: cleanError(e) });
    } finally {
      setBusy(false);
    }
  }
  async function voice(clip: Clip) {
    await sendVoice(clip, { type: "CONTROL_ROOM" });
    onSent();
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 11rem)" }} data-testid="radio-tab">
      <div className="border-b border-white/10 px-4 py-2 text-center text-xs text-slate-400">Control Room · messages and voice</div>
      {player.blocked && (
        <button onClick={() => radioPlayer.retryBlocked()} className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl bg-amber-500/20 px-3 py-2 text-sm text-amber-100" data-testid="tap-to-hear">
          <Volume2 className="h-4 w-4" /> Tap here to hear the waiting voice message
        </button>
      )}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-3" data-testid="thread">
        {!loaded ? null : messages.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No messages yet. Hold the microphone button to talk to the control room, or type a message.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_team_id === teamId;
            return <MessageBubble key={m.id} msg={m} mine={mine} tone="dark" showSender={!mine} onPlayed={onPlayed} />;
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="space-y-3 border-t border-white/10 bg-ink-900 px-3 pb-2 pt-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
            rows={2}
            placeholder="Type a message to the control room"
            aria-label="Message text"
            data-testid="text-input"
            className="min-h-[3rem] flex-1 resize-none rounded-xl border border-white/20 bg-ink-900 px-3 py-2 text-base text-white outline-none placeholder:text-slate-500 focus:border-brand-500"
          />
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            data-testid="send-text"
            aria-label="Send message"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-600 disabled:opacity-40"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        <PttButton tone="dark" toLabel="the control room" onSend={voice} onError={(m) => toast.push({ kind: "error", title: "Voice not sent", body: m })} />
      </div>
    </div>
  );
}
