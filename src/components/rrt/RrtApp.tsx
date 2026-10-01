"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, MessagesSquare, Power, Radio, Satellite, ShieldCheck, Siren, UserRound, WifiOff } from "lucide-react";
import clsx from "clsx";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { useRrtData } from "@/hooks/useRrtData";
import { useGps } from "@/hooks/useGps";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useServerClock } from "@/hooks/useServerClock";
import { cleanError, fmtDuration } from "@/lib/format";
import { registerServiceWorker } from "@/lib/push";
import { beep, unlockAudio } from "@/lib/sound";
import { useMessages } from "@/hooks/useMessages";
import { radioPlayer, type RadioMessage } from "@/lib/radio";
import { TEAM_COLOR, TEAM_LABEL } from "@/lib/constants";
import type { NotificationType } from "@/lib/types";
import OfferOverlay from "./OfferOverlay";
import JobScreen from "./JobScreen";
import ResolveForm from "./ResolveForm";
import HistoryTab from "./HistoryTab";
import AccountTab, { type InstallEvent } from "./AccountTab";
import RadioTab from "./RadioTab";

type Tab = "job" | "radio" | "history" | "account";

const GPS_STALE_MS = 90_000;

/** The whole RRT phone app: standby / online toggle, incident alert, active job, report, history, account. */
export default function RrtApp({ teamId }: { teamId: string }) {
  const profile = useProfile();
  const toast = useToast();
  const serverNow = useServerClock();
  const { team, offers, job, loaded, error, refetch } = useRrtData(teamId);

  const [tab, setTab] = useState<Tab>("job");
  const [wantGps, setWantGps] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [offerBusy, setOfferBusy] = useState<"accept" | "reject" | null>(null);
  const [reporting, setReporting] = useState(false);
  const [done, setDone] = useState<{ incident_number: string; resolution_seconds: number | null } | null>(null);
  const [historyKey, setHistoryKey] = useState("0");
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [onlineNet, setOnlineNet] = useState(true);

  const online = team?.is_online_enabled ?? false;
  const gpsOn = wantGps || online || job !== null;
  const { fix, fixRef, error: gpsError } = useGps(gpsOn);
  const wake = useWakeLock(online || job !== null);

  // ---- radio: messages from the control room ----------------------------------
  const tabRef = useRef<Tab>("job");
  tabRef.current = tab;
  const markHeard = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await supabaseBrowser().rpc("messages_mark_heard", { p_ids: ids });
  }, []);
  const onIncoming = useCallback(
    (m: RadioMessage) => {
      if (m.sender_team_id) return; // my own message
      navigator.vibrate?.([180, 90, 180]);
      beep("ok");
      if (m.kind === "VOICE" && m.audio_path) {
        radioPlayer?.enqueue({ id: m.id, path: m.audio_path, onStart: () => void markHeard([m.id]) });
      }
      if (!(tabRef.current === "radio" && document.visibilityState === "visible")) {
        toast.push({ kind: "info", title: "Control Room", body: m.kind === "TEXT" ? m.body ?? "" : `Voice message (${Math.round(m.audio_seconds ?? 0)} s)`, ms: 8000 });
      }
    },
    [markHeard, toast],
  );
  const radio = useMessages(profile.id, onIncoming);
  const heardIds = new Set(radio.receipts.filter((r) => r.team_id === teamId).map((r) => r.message_id));
  const unheard = radio.messages.filter((m) => !m.sender_team_id && !heardIds.has(m.id));
  const unreadCount = unheard.length;
  // text messages count as read when the Radio tab is open
  useEffect(() => {
    if (tab !== "radio") return;
    const ids = unheard.filter((m) => m.kind === "TEXT").map((m) => m.id);
    if (ids.length) void markHeard(ids).then(() => radio.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, unheard.length]);
  // never talk over the incident siren: voice waits while an offer is on screen
  const offerOnScreen = online && !reporting && offers.length > 0;
  useEffect(() => {
    radioPlayer?.setHold(offerOnScreen);
  }, [offerOnScreen]);
  useEffect(() => {
    const retry = () => radioPlayer?.retryBlocked();
    document.addEventListener("pointerdown", retry);
    return () => {
      document.removeEventListener("pointerdown", retry);
      radioPlayer?.clearQueue();
      radioPlayer?.stop();
    };
  }, []);

  // ---- service worker, install prompt, connectivity -------------------
  useEffect(() => {
    void registerServiceWorker();
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    const up = () => setOnlineNet(true);
    const down = () => setOnlineNet(false);
    setOnlineNet(navigator.onLine);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ---- send my location (every 5 s on a job, 10 s otherwise) ----------
  const lastPost = useRef(0);
  const jobStatus = useRef<string | null>(null);
  jobStatus.current = job?.status ?? null;
  const hasFix = fix !== null;
  const sending = online || job !== null;
  useEffect(() => {
    if (!sending) return;
    const send = async () => {
      const f = fixRef.current;
      if (!f || Date.now() - f.ts > GPS_STALE_MS) return;
      if (Date.now() - lastPost.current < 3500) return;
      lastPost.current = Date.now();
      const { data, error: err } = await supabaseBrowser().rpc("post_location", {
        p_lat: f.lat,
        p_lng: f.lng,
        p_speed_kmh: f.speedKmh,
        p_heading: f.heading,
        p_accuracy_m: Math.round(f.accuracy),
      });
      if (err) return;
      const st = (data as { incident_status?: string | null } | null)?.incident_status ?? null;
      if (st !== jobStatus.current) void refetch();
    };
    void send();
    const id = window.setInterval(() => void send(), job ? 5000 : 10000);
    return () => window.clearInterval(id);
  }, [sending, job, hasFix, fixRef, refetch]);

  // ---- alerts that arrive as notifications ------------------------------
  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`rrt-notif-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` },
        (p) => {
          const n = p.new as { type: NotificationType; title: string; body: string | null; assignment_id: string | null; payload?: { kind?: string } };
          if (n.payload?.kind === "message") return; // the radio shows messages itself
          void refetch();
          if (n.type === "INCIDENT_OFFER") {
            if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
              void navigator.serviceWorker?.ready.then((reg) =>
                reg.showNotification(n.title, {
                  body: n.body ?? undefined,
                  tag: n.assignment_id ?? "offer",
                  requireInteraction: true,
                  icon: "/icons/icon-192.png",
                  badge: "/icons/badge-96.png",
                  data: { url: "/rrt" },
                } as NotificationOptions),
              );
            }
            return;
          }
          toast.push({ kind: n.type === "INCIDENT_CANCELLED" || n.type === "TEAM_OFFLINE" ? "warning" : "info", title: n.title, body: n.body ?? undefined });
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  // ---- the job disappeared without me finishing it -----------------------
  const prevJob = useRef<string | null>(null);
  const finishedHere = useRef<string | null>(null);
  useEffect(() => {
    const cur = job?.id ?? null;
    if (prevJob.current && !cur && finishedHere.current !== prevJob.current) {
      toast.push({ kind: "warning", title: "Incident closed", body: "The control room cancelled or closed this incident." });
      setReporting(false);
    }
    prevJob.current = cur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  // When a job starts, bring the Job tab forward.
  useEffect(() => {
    if (job) setTab("job");
  }, [job?.id]);

  // ---- actions --------------------------------------------------------------
  const goOnline = async (next: boolean) => {
    if (toggling) return;
    if (!next && job) {
      toast.push({ kind: "warning", title: "You are on an incident", body: "Finish the report first, then go offline." });
      return;
    }
    setToggling(true);
    try {
      if (next) {
        unlockAudio(); // lets the siren play later
        setWantGps(true);
      }
      const { error: err } = await supabaseBrowser().rpc("set_team_online", { p_online: next });
      if (err) throw err;
      if (!next) setWantGps(false);
      await refetch();
    } catch (e) {
      toast.push({ kind: "error", title: next ? "Could not go online" : "Could not go offline", body: cleanError(e) });
    } finally {
      setToggling(false);
    }
  };

  const accept = async (id: string) => {
    setOfferBusy("accept");
    try {
      const { error: err } = await supabaseBrowser().rpc("accept_offer", { p_assignment_id: id });
      if (err) throw err;
      toast.push({ kind: "success", title: "Accepted", body: "Drive to the tower. Your position is being shared." });
      setTab("job");
    } catch (e) {
      toast.push({ kind: "error", title: "Could not accept", body: cleanError(e) });
    } finally {
      setOfferBusy(null);
      void refetch();
    }
  };

  const reject = async (id: string) => {
    setOfferBusy("reject");
    try {
      const { error: err } = await supabaseBrowser().rpc("reject_offer", { p_assignment_id: id, p_reason: null });
      if (err) throw err;
    } catch (e) {
      toast.push({ kind: "error", title: "Could not reject", body: cleanError(e) });
    } finally {
      setOfferBusy(null);
      void refetch();
    }
  };

  // ---- screens ------------------------------------------------------------
  if (!loaded) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-900 text-white">
        {error ? (
          <div className="max-w-xs space-y-3 p-6 text-center">
            <p className="font-semibold">Could not load your team</p>
            <p className="text-sm text-slate-300">{error}</p>
            <button onClick={() => void refetch()} className="rounded-xl bg-white/10 px-4 py-2 text-sm">
              Try again
            </button>
          </div>
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
        )}
      </div>
    );
  }

  if (!team) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-900 p-6 text-center text-white">
        <p className="max-w-xs text-sm text-slate-300">Your login is not linked to a team. Ask the control room to link it.</p>
      </div>
    );
  }

  const offer = online && !reporting ? offers[0] : undefined;
  const statusColor = TEAM_COLOR[team.status];
  const gpsFresh = fix !== null && Date.now() - fix.ts < GPS_STALE_MS;

  return (
    <div className="flex min-h-dvh flex-col bg-ink-900 text-white" data-testid="rrt-app">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-ink-900/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" /> PERS · RRT
            </p>
            <p className="truncate text-lg font-bold" data-testid="team-name">
              {team.code} · {team.name}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold" data-testid="team-status">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusColor }} />
              {online || team.status !== "OFFLINE" ? TEAM_LABEL[team.status] : "Offline"}
            </span>
            {gpsOn && (
              <span
                data-testid="gps-pill"
                className={clsx(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  gpsFresh ? "bg-green-500/20 text-green-200" : "bg-red-500/20 text-red-200",
                )}
              >
                <Satellite className="h-3 w-3" /> {gpsFresh ? `GPS ±${Math.round(fix!.accuracy)} m` : "No GPS"}
              </span>
            )}
          </div>
        </div>
        {!onlineNet && (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-100" data-testid="net-banner">
            <WifiOff className="h-4 w-4" /> No internet. Alerts and location are paused until you are back online.
          </p>
        )}
      </header>

      <main className="flex-1 pb-24">
        {tab === "job" && job && <JobScreen job={job} fix={fix} onReport={() => setReporting(true)} />}

        {tab === "job" && !job && (
          <div className="space-y-5 p-4" data-testid="standby">
            {!team.is_active && (
              <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200">This team is deactivated. Contact the control room.</p>
            )}
            <div className="flex flex-col items-center gap-4 rounded-3xl bg-white/5 px-4 py-8 text-center">
              <button
                onClick={() => void goOnline(!online)}
                disabled={toggling || !team.is_active}
                data-testid="online-toggle"
                aria-pressed={online}
                className={clsx(
                  "grid h-40 w-40 place-items-center rounded-full border-8 text-lg font-bold shadow-xl transition active:scale-95 disabled:opacity-60",
                  online ? "border-green-300/60 bg-green-600" : "border-slate-500/40 bg-slate-600",
                )}
              >
                {toggling ? (
                  <Loader2 className="h-10 w-10 animate-spin" />
                ) : (
                  <span className="flex flex-col items-center gap-1">
                    <Power className="h-9 w-9" />
                    {online ? "ONLINE" : "GO ONLINE"}
                  </span>
                )}
              </button>
              <p className="max-w-xs text-sm text-slate-300">
                {online
                  ? "You are on duty. Keep this app open. When an incident comes, the phone will ring."
                  : "Tap to go on duty. The control room can send you incidents only while you are online."}
              </p>
              {online && (
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Radio className="h-3.5 w-3.5" />
                  {gpsFresh ? "Sharing your location" : gpsError === "denied" ? "Location is blocked — allow it in site settings" : "Waiting for GPS…"}
                </p>
              )}
              {online && (
                <button onClick={() => void goOnline(false)} disabled={toggling} className="text-sm text-slate-400 underline" data-testid="go-offline">
                  Go offline
                </button>
              )}
            </div>
            {gpsError === "denied" && (
              <p className="rounded-xl bg-red-500/15 p-3 text-sm text-red-200" data-testid="gps-denied">
                Location is blocked for this app. Open the phone's site settings for this app, set Location to Allow, then reopen the app.
              </p>
            )}
          </div>
        )}

        {tab === "radio" && (
          <RadioTab
            messages={radio.messages}
            teamId={team.id}
            loaded={radio.loaded}
            onPlayed={(m) => void markHeard([m.id]).then(() => radio.refresh())}
            onSent={() => void radio.refresh()}
          />
        )}
        {tab === "history" && <HistoryTab teamId={team.id} refreshKey={historyKey} />}
        {tab === "account" && (
          <AccountTab
            team={team}
            gpsError={gpsError}
            gpsAccuracy={fix?.accuracy ?? null}
            wakeLock={wake}
            installEvent={installEvent}
            onInstalled={() => setInstallEvent(null)}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-white/10 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        {(
          [
            ["job", "Job", Siren],
            ["radio", "Radio", MessagesSquare],
            ["history", "History", ClipboardList],
            ["account", "Account", UserRound],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            data-testid={`tab-${id}`}
            className={clsx("relative flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium", tab === id ? "text-white" : "text-slate-400")}
          >
            <Icon className="h-6 w-6" />
            {label}
            {id === "job" && job && <span className="absolute right-[32%] top-2 h-2.5 w-2.5 rounded-full bg-amber-400" />}
            {id === "radio" && unreadCount > 0 && (
              <span data-testid="radio-unread" className="absolute right-[28%] top-1.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[1.1rem]">{unreadCount}</span>
            )}
          </button>
        ))}
      </nav>

      {offer && <OfferOverlay offer={offer} serverNow={serverNow} busy={offerBusy} onAccept={() => void accept(offer.id)} onReject={() => void reject(offer.id)} />}

      {reporting && job && (
        <ResolveForm
          job={job}
          fix={fix}
          onClose={() => setReporting(false)}
          onResolved={(r) => {
            finishedHere.current = job.id;
            setReporting(false);
            setDone(r);
            setHistoryKey(String(Date.now()));
            void refetch();
          }}
        />
      )}

      {done && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-ink-900 p-6 text-center text-white" data-testid="done-screen">
          <div className="max-w-xs space-y-4">
            <CheckCircle2 className="mx-auto h-20 w-20 text-green-400" />
            <h2 className="text-2xl font-bold">Incident resolved</h2>
            <p className="text-slate-300">
              {done.incident_number} is closed
              {done.resolution_seconds != null ? ` after ${fmtDuration(done.resolution_seconds)}` : ""}. Thank you. You are back on standby.
            </p>
            <button
              onClick={() => {
                setDone(null);
                setTab("job");
              }}
              data-testid="done-ok"
              className="h-14 w-full rounded-2xl bg-brand-600 text-base font-semibold"
            >
              Back to standby
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
