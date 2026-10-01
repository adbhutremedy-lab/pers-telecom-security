"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileContext";
import { useToast } from "@/components/Toast";
import { useMessages } from "@/hooks/useMessages";
import { radioPlayer, type RadioMessage, type Receipt } from "@/lib/radio";
import { beep } from "@/lib/sound";
import type { TeamStatus } from "@/lib/types";

export interface RadioTeam {
  id: string;
  code: string;
  name: string;
  status: TeamStatus;
  is_active: boolean;
  is_simulated: boolean;
}
export const ALL = "ALL";

interface Ctx {
  messages: RadioMessage[];
  receipts: Receipt[];
  teams: RadioTeam[];
  loaded: boolean;
  /** unread messages FROM teams, per channel (team id) and in total */
  unread: { total: number; byChannel: Record<string, number> };
  markSeen: (channel: string) => void;
  setActive: (channel: string | null) => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  refresh: () => Promise<void>;
}
const RadioCtx = createContext<Ctx | null>(null);

/** null when the signed-in person is not allowed to use the radio (operators). */
export const useRadio = () => useContext(RadioCtx);

const lsGet = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode: fine */
  }
};

export function RadioProvider({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const toast = useToast();
  const [teams, setTeams] = useState<RadioTeam[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [autoplay, setAutoplayState] = useState(true);
  const active = useRef<string | null>(null);
  const teamsRef = useRef<RadioTeam[]>([]);
  teamsRef.current = teams;
  const autoRef = useRef(true);
  autoRef.current = autoplay;

  useEffect(() => {
    try {
      const s = JSON.parse(lsGet(`pers.radio.seen.${profile.id}`) ?? "null");
      if (s && typeof s === "object") setSeen(s);
      else {
        const init = { _since: new Date().toISOString() };
        setSeen(init);
        lsSet(`pers.radio.seen.${profile.id}`, JSON.stringify(init));
      }
    } catch {
      setSeen({ _since: new Date().toISOString() });
    }
    setAutoplayState(lsGet("pers.radio.autoplay") !== "off");
    const retry = () => radioPlayer?.retryBlocked();
    document.addEventListener("pointerdown", retry);
    return () => document.removeEventListener("pointerdown", retry);
  }, [profile.id]);

  const onIncoming = useCallback(
    (m: RadioMessage) => {
      if (!m.sender_team_id) return; // sent from the control room
      const viewing = active.current === m.sender_team_id && document.visibilityState === "visible";
      if (m.kind === "VOICE" && m.audio_path && autoRef.current) radioPlayer?.enqueue({ id: m.id, path: m.audio_path });
      if (!viewing) {
        beep("ok");
        toast.push({ kind: "info", title: m.sender_label, body: m.kind === "TEXT" ? m.body ?? "" : `Voice message (${Math.round(m.audio_seconds ?? 0)} s)`, ms: 9000 });
      }
    },
    [toast],
  );

  const { messages, receipts, loaded, refresh } = useMessages(profile.id, onIncoming);

  const loadTeams = useCallback(async () => {
    const { data } = await supabaseBrowser().from("rrt_teams").select("id, code, name, status, is_active, is_simulated").eq("is_active", true).order("code");
    if (data) setTeams(data as RadioTeam[]);
  }, []);
  useEffect(() => {
    void loadTeams();
    const id = window.setInterval(() => void loadTeams(), 10000);
    return () => window.clearInterval(id);
  }, [loadTeams]);

  const unread = useMemo(() => {
    const since = seen._since ?? "";
    const byChannel: Record<string, number> = {};
    let total = 0;
    for (const m of messages) {
      if (!m.sender_team_id) continue;
      const mark = seen[m.sender_team_id] ?? since;
      if (m.created_at > mark) {
        byChannel[m.sender_team_id] = (byChannel[m.sender_team_id] ?? 0) + 1;
        total++;
      }
    }
    return { total, byChannel };
  }, [messages, seen]);

  const markSeen = useCallback(
    (channel: string) => {
      setSeen((cur) => {
        const next = { ...cur, [channel]: new Date(Date.now() + 1000).toISOString() };
        lsSet(`pers.radio.seen.${profile.id}`, JSON.stringify(next));
        return next;
      });
    },
    [profile.id],
  );
  const setActive = useCallback((c: string | null) => {
    active.current = c;
  }, []);
  const setAutoplay = useCallback((v: boolean) => {
    setAutoplayState(v);
    lsSet("pers.radio.autoplay", v ? "on" : "off");
    if (!v) radioPlayer?.clearQueue();
  }, []);

  const value = useMemo<Ctx>(
    () => ({ messages, receipts, teams, loaded, unread, markSeen, setActive, autoplay, setAutoplay, refresh }),
    [messages, receipts, teams, loaded, unread, markSeen, setActive, autoplay, setAutoplay, refresh],
  );
  return <RadioCtx.Provider value={value}>{children}</RadioCtx.Provider>;
}
