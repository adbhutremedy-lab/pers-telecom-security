"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MESSAGE_COLUMNS, type RadioMessage, type Receipt } from "@/lib/radio";

const KEEP = 300;

/**
 * Live list of the messages the signed-in person may see (the database decides),
 * plus the read/heard receipts. Uses Supabase Realtime and a 4-second refresh as a back-up.
 * `onIncoming` is called for every message that arrives after the first load.
 */
export function useMessages(userId: string, onIncoming?: (m: RadioMessage) => void) {
  const [messages, setMessages] = useState<RadioMessage[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const newest = useRef<string | null>(null);
  const first = useRef(true);
  const cb = useRef(onIncoming);
  cb.current = onIncoming;

  const addMessages = useCallback((rows: RadioMessage[]) => {
    const fresh = rows.filter((r) => !seen.current.has(r.id));
    if (fresh.length === 0) return;
    fresh.forEach((r) => seen.current.add(r.id));
    fresh.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = fresh[fresh.length - 1].created_at;
    if (!newest.current || last > newest.current) newest.current = last;
    setMessages((cur) => [...cur, ...fresh].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-KEEP));
    if (!first.current) fresh.forEach((m) => cb.current?.(m));
  }, []);

  const loadReceipts = useCallback(async () => {
    const { data } = await supabaseBrowser().from("message_receipts").select("message_id, team_id, heard_at").order("heard_at", { ascending: false }).limit(1000);
    if (data) setReceipts(data as Receipt[]);
  }, []);

  const poll = useCallback(async () => {
    const sb = supabaseBrowser();
    let q = sb.from("messages").select(MESSAGE_COLUMNS);
    if (newest.current) q = q.gt("created_at", newest.current).order("created_at", { ascending: true }).limit(100);
    else q = q.order("created_at", { ascending: false }).limit(KEEP);
    const { data } = await q;
    if (data) addMessages(data as RadioMessage[]);
    if (first.current) {
      first.current = false;
      setLoaded(true);
    }
    await loadReceipts();
  }, [addMessages, loadReceipts]);

  useEffect(() => {
    void poll();
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`messages-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => addMessages([p.new as RadioMessage]))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_receipts" }, () => void loadReceipts())
      .subscribe();
    const id = window.setInterval(() => void poll(), 4000);
    const onVis = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      void sb.removeChannel(ch);
    };
  }, [userId, poll, addMessages, loadReceipts]);

  return { messages, receipts, loaded, refresh: poll };
}
