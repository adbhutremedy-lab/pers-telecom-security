"use client";

import { useEffect, useState } from "react";
import { BellRing, Download, LogOut, MapPin, Smartphone, SunMedium } from "lucide-react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push";
import { cleanError } from "@/lib/format";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import type { GpsError } from "@/hooks/useGps";
import type { MyTeam } from "@/lib/types";

export interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Props {
  team: MyTeam;
  gpsError: GpsError;
  gpsAccuracy: number | null;
  wakeLock: boolean;
  installEvent: InstallEvent | null;
  onInstalled: () => void;
}

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: "This browser cannot show alerts when the app is closed.",
  "not-configured": "Closed-app alerts are not switched on for this system yet. The alert still rings while the app is open.",
  denied: "Alerts are blocked. Open the phone's site settings for this app and allow Notifications.",
  on: "Alerts are ON. A new incident will wake this phone even if the app is closed.",
  off: "Alerts are OFF. Turn them on so a new incident can wake this phone.",
};

export default function AccountTab({ team, gpsError, gpsAccuracy, wakeLock, installEvent, onInstalled }: Props) {
  const profile = useProfile();
  const toast = useToast();
  const router = useRouter();
  const [push, setPush] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

  useEffect(() => {
    void getPushState().then(setPush);
  }, []);

  const togglePush = async () => {
    setBusy(true);
    try {
      if (push === "on") await disablePush();
      else await enablePush();
      setPush(await getPushState());
    } catch (e) {
      toast.push({ kind: "error", title: "Could not change alerts", body: cleanError(e) });
      setPush(await getPushState());
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  const row = "flex items-start gap-3 rounded-2xl bg-white/5 p-4";

  return (
    <div className="space-y-3 p-4" data-testid="account-tab">
      <div className={row}>
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
        <div>
          <p className="font-semibold">
            {team.code} · {team.name}
          </p>
          <p className="text-sm text-slate-300">{profile.full_name}</p>
          <p className="text-xs text-slate-400">
            {[team.vehicle_model, team.vehicle_plate, team.region].filter(Boolean).join(" · ") || "No vehicle details"}
          </p>
        </div>
      </div>

      <div className={row}>
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
        <div className="text-sm">
          <p className="font-semibold">Location</p>
          <p className="text-slate-300">
            {gpsError === "denied"
              ? "Location is blocked. Allow Location for this app in the phone's site settings."
              : gpsError === "unavailable"
                ? "No GPS signal. Go outside or near a window."
                : gpsError === "unsupported"
                  ? "This phone cannot give a location."
                  : gpsAccuracy != null
                    ? `Working. Accuracy about ${Math.round(gpsAccuracy)} m.`
                    : "Starts when you go online."}
          </p>
        </div>
      </div>

      <div className={row}>
        <SunMedium className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
        <div className="text-sm">
          <p className="font-semibold">Screen stays on</p>
          <p className="text-slate-300">
            {wakeLock ? "Yes, while you are online (so GPS keeps working)." : "Only while you are online and the app is open on screen."}
          </p>
        </div>
      </div>

      <div className={row}>
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">Alerts when the app is closed</p>
          <p className="text-slate-300">{PUSH_TEXT[push]}</p>
          {(push === "on" || push === "off") && (
            <button
              onClick={togglePush}
              disabled={busy}
              data-testid="push-toggle"
              className={clsx(
                "mt-3 h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60",
                push === "on" ? "bg-white/10 text-white" : "bg-brand-600 text-white",
              )}
            >
              {push === "on" ? "Turn alerts off" : "Turn alerts on"}
            </button>
          )}
        </div>
      </div>

      {!standalone && (
        <div className={row}>
          <Download className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Install on this phone</p>
            <p className="text-slate-300">Install the app so it opens full screen from the home screen.</p>
            {installEvent ? (
              <button
                onClick={async () => {
                  await installEvent.prompt();
                  const c = await installEvent.userChoice;
                  if (c.outcome === "accepted") onInstalled();
                }}
                data-testid="install-app"
                className="mt-3 h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white"
              >
                Install app
              </button>
            ) : (
              <p className="mt-1 text-xs text-slate-400">In Chrome: menu (three dots) → Install app / Add to Home screen.</p>
            )}
          </div>
        </div>
      )}

      <button
        onClick={signOut}
        data-testid="sign-out"
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-sm font-semibold hover:bg-white/20"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>
      {team.is_online_enabled && (
        <p className="text-center text-xs text-slate-500">Signing out does not take the team offline until the control room notices (about 45 seconds). Go offline first.</p>
      )}
    </div>
  );
}
