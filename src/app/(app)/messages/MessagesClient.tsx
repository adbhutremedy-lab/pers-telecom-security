"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone, Send, Square, Volume2 } from "lucide-react";
import clsx from "clsx";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { Button, PageHeader, Spinner } from "@/components/ui";
import MessageBubble from "@/components/radio/MessageBubble";
import PttButton from "@/components/radio/PttButton";
import { ALL, useRadio, type RadioTeam } from "@/components/radio/RadioContext";
import { TEAM_COLOR, TEAM_LABEL } from "@/lib/constants";
import { cleanError } from "@/lib/format";
import { MAX_TEXT, radioPlayer, sendText, sendVoice, usePlayer, type Clip, type RadioMessage } from "@/lib/radio";

export default function MessagesClient({ initialTeam }: { initialTeam: string | null }) {
  const radio = useRadio();
  const profile = useProfile();
  const toast = useToast();
  const player = usePlayer();
  const [channel, setChannel] = useState<string>(initialTeam ?? ALL);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const teams = useMemo(() => [...(radio?.teams ?? [])].sort((a, b) => Number(a.is_simulated) - Number(b.is_simulated) || a.code.localeCompare(b.code)), [radio?.teams]);
  const team = channel === ALL ? null : teams.find((t) => t.id === channel) ?? null;
  const onlineWithPhone = teams.filter((t) => !t.is_simulated && t.status !== "OFFLINE");

  useEffect(() => {
    radio?.setActive(channel);
    radio?.markSeen(channel);
    return () => radio?.setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const thread = useMemo<RadioMessage[]>(() => {
    const all = radio?.messages ?? [];
    if (channel === ALL) return all.filter((m) => m.target_type === "ALL_ONLINE");
    return all.filter((m) => m.target_team_id === channel || m.sender_team_id === channel || (m.target_type === "ALL_ONLINE" && m.recipient_team_ids.includes(channel)));
  }, [radio?.messages, channel]);

  // keep the newest message in view and mark the channel as seen while we look at it
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
    if (thread.length) radio?.markSeen(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.length, channel]);

  if (!radio) return null;

  const codeOf = (id: string) => teams.find((t) => t.id === id)?.code ?? "team";
  const heardOf = (m: RadioMessage) => radio.receipts.filter((r) => r.message_id === m.id).map((r) => codeOf(r.team_id));

  const noPhone = team?.is_simulated === true;
  const nobody = channel === ALL && onlineWithPhone.length === 0;
  const blockReason = noPhone ? `${team!.code} is a simulated demo team: it has no phone to receive messages.` : nobody ? "No team with a phone is online right now." : null;
  const target = channel === ALL ? ({ type: "ALL_ONLINE" } as const) : ({ type: "TEAM", teamId: channel } as const);
  const toLabel = channel === ALL ? `${onlineWithPhone.length} online team${onlineWithPhone.length === 1 ? "" : "s"}` : team?.code ?? "team";

  async function submitText() {
    const t = text.trim();
    if (!t || busy || blockReason) return;
    setBusy(true);
    try {
      const r = await sendText(t, target);
      setText("");
      void radio!.refresh();
      if (channel === ALL) toast.push({ kind: "success", title: `Sent to ${r.recipients} online team${r.recipients === 1 ? "" : "s"}` });
    } catch (e) {
      toast.push({ kind: "error", title: "Message not sent", body: cleanError(e) });
    } finally {
      setBusy(false);
    }
  }
  async function submitVoice(clip: Clip) {
    if (blockReason) throw new Error(blockReason);
    const r = await sendVoice(clip, target);
    void radio!.refresh();
    if (channel === ALL) toast.push({ kind: "success", title: `Voice sent to ${r.recipients} online team${r.recipients === 1 ? "" : "s"}` });
  }

  const ChannelItem = ({ id, title, sub, dot, badge, icon }: { id: string; title: string; sub?: string; dot?: string; badge: number; icon?: React.ReactNode }) => (
    <button
      onClick={() => setChannel(id)}
      data-testid={`channel-${id === ALL ? "all" : teams.find((t) => t.id === id)?.code}`}
      className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", channel === id ? "bg-brand-50 ring-1 ring-brand-500" : "hover:bg-slate-100")}
    >
      {icon ?? <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: dot }} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{title}</span>
        {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
      </span>
      {badge > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white" data-testid="channel-unread">{badge}</span>}
    </button>
  );

  return (
    <div className="flex h-full flex-col p-3 lg:p-5" data-testid="messages">
      <PageHeader
        title="Messages"
        subtitle="Text and push-to-talk voice to one team or to every online team"
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4" checked={radio.autoplay} onChange={(e) => radio.setAutoplay(e.target.checked)} data-testid="autoplay" />
            Play incoming voice automatically
          </label>
        }
      />
      {player.blocked && (
        <button onClick={() => radioPlayer.retryBlocked()} className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" data-testid="tap-to-hear">
          <Volume2 className="h-4 w-4" /> A voice message is waiting. Click here to hear it (the browser needs one click first).
        </button>
      )}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_1fr]">
        <aside className="min-h-0 overflow-auto rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-200" aria-label="Channels">
          <ChannelItem id={ALL} title="All online teams" sub={`${onlineWithPhone.length} with a phone online`} badge={0} icon={<Megaphone className="h-4 w-4 shrink-0 text-brand-600" />} />
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Teams</p>
          {teams.map((t: RadioTeam) => (
            <ChannelItem key={t.id} id={t.id} title={`${t.code} · ${t.name}`} sub={`${TEAM_LABEL[t.status]}${t.is_simulated ? " · simulated, no phone" : ""}`} dot={TEAM_COLOR[t.status]} badge={radio.unread.byChannel[t.id] ?? 0} />
          ))}
        </aside>

        <section className="flex min-h-0 flex-col rounded-xl bg-slate-50 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 rounded-t-xl">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-900" data-testid="channel-title">{channel === ALL ? "All online teams" : team ? `${team.code} · ${team.name}` : "Team"}</h2>
              <p className="truncate text-xs text-slate-500">
                {channel === ALL
                  ? onlineWithPhone.length ? `Goes to: ${onlineWithPhone.map((t) => t.code).join(", ")}` : "Nobody online with a phone"
                  : team ? TEAM_LABEL[team.status] : ""}
              </p>
            </div>
            {player.playingId && (
              <Button tone="outline" onClick={() => { radioPlayer.stop(); radioPlayer.clearQueue(); }} data-testid="stop-audio"><Square className="h-4 w-4" /> Stop audio</Button>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4" data-testid="thread">
            {!radio.loaded ? (
              <div className="grid place-items-center p-10"><Spinner /></div>
            ) : thread.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-500">No messages yet. Type below or hold the microphone button to talk.</p>
            ) : (
              thread.map((m) => {
                const fromTeam = !!m.sender_team_id;
                return (
                  <MessageBubble
                    key={m.id}
                    msg={m}
                    mine={!fromTeam}
                    showSender={fromTeam || m.sender_id !== profile.id}
                    heardBy={!fromTeam ? heardOf(m) : undefined}
                    recipientCodes={!fromTeam ? m.recipient_team_ids.map(codeOf) : undefined}
                  />
                );
              })
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-200 bg-white p-3 rounded-b-xl">
            {blockReason && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="block-reason">{blockReason}</p>}
            {team && !team.is_simulated && team.status === "OFFLINE" && (
              <p className="mb-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{team.code} is offline. It will see your message when it next opens the app.</p>
            )}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void submitText();
                    }
                  }}
                  rows={3}
                  placeholder={`Message to ${toLabel}…  (Enter to send, Shift+Enter for a new line)`}
                  disabled={!!blockReason}
                  aria-label="Message text"
                  data-testid="text-input"
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100"
                />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-slate-400">{text.length}/{MAX_TEXT}</span>
                  <Button onClick={submitText} busy={busy} disabled={!text.trim() || !!blockReason} data-testid="send-text"><Send className="h-4 w-4" /> Send</Button>
                </div>
              </div>
              <PttButton toLabel={toLabel} disabled={!!blockReason} onSend={submitVoice} onError={(m) => toast.push({ kind: "error", title: "Voice not sent", body: m })} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
