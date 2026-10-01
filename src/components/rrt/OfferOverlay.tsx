"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MapPin, X } from "lucide-react";
import { startSiren, stopSiren } from "@/lib/sound";
import type { PhoneOffer } from "@/lib/types";

interface Props {
  offer: PhoneOffer;
  serverNow: () => number;
  busy: "accept" | "reject" | null;
  onAccept: () => void;
  onReject: () => void;
}

const R = 54;
const C = 2 * Math.PI * R;

/** Full-screen incident alert: siren, vibration, 30 second countdown, ACCEPT / REJECT. */
export default function OfferOverlay({ offer, serverNow, busy, onAccept, onReject }: Props) {
  const total = Math.max(1, (new Date(offer.expires_at).getTime() - new Date(offer.offered_at).getTime()) / 1000);
  const [left, setLeft] = useState(() => Math.max(0, (new Date(offer.expires_at).getTime() - serverNow()) / 1000));

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, (new Date(offer.expires_at).getTime() - serverNow()) / 1000));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [offer.expires_at, serverNow]);

  // The siren plays only while this alert is on screen and still open.
  const over = left <= 0;
  useEffect(() => {
    if (over) {
      stopSiren();
      return;
    }
    startSiren();
    return () => stopSiren();
  }, [offer.id, over]);

  const secs = Math.ceil(left);
  const frac = Math.min(1, left / total);
  const urgent = left <= 10;

  return (
    <div role="alertdialog" aria-label="Incident alert" className="fixed inset-0 z-[90] flex flex-col bg-red-700 text-white" data-testid="offer-overlay">
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-10 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-100">Incident alert</p>
        <p className="mt-1 text-xs text-red-200">{offer.incident_number}</p>

        <div className="relative mx-auto mt-6 h-36 w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="9" />
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={urgent ? "#fde047" : "#fff"}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              style={{ transition: "stroke-dashoffset .2s linear" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div>
              <p className="text-5xl font-extrabold tabular-nums" data-testid="offer-secs">{secs}</p>
              <p className="-mt-1 text-[11px] uppercase tracking-wider text-red-100">seconds</p>
            </div>
          </div>
        </div>

        <h1 className="mt-6 text-2xl font-extrabold leading-tight">{offer.tower_name}</h1>
        <p className="mt-1 text-lg font-semibold text-red-100">Tower {offer.tower_number}</p>
        <div className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full bg-black/25 px-4 py-2 text-base font-semibold">
          <MapPin className="h-5 w-5" />
          {offer.distance_km < 1 ? `${Math.round(offer.distance_km * 1000)} m away` : `${offer.distance_km.toFixed(1)} km away`}
          {offer.region ? <span className="text-red-100">· {offer.region}</span> : null}
        </div>
        {over && <p className="mt-6 text-base font-semibold text-yellow-200">Time is up. This alert has passed to the next team.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 bg-black/20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={onReject}
          disabled={busy !== null || over}
          className="flex h-16 items-center justify-center gap-2 rounded-2xl border-2 border-white/70 text-lg font-bold text-white disabled:opacity-40"
          data-testid="offer-reject"
        >
          {busy === "reject" ? <Loader2 className="h-6 w-6 animate-spin" /> : <X className="h-6 w-6" />} Reject
        </button>
        <button
          onClick={onAccept}
          disabled={busy !== null || over}
          className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-green-500 text-lg font-extrabold text-white shadow-lg disabled:opacity-40"
          data-testid="offer-accept"
        >
          {busy === "accept" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Check className="h-6 w-6" />} Accept
        </button>
      </div>
    </div>
  );
}
