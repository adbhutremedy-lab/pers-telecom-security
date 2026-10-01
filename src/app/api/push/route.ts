import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import webpush from "web-push";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

// Push relay: the database calls this address when a team gets an alert. We look up the team's
// phones, send the alert through the phones' push service, and report back which phones are gone.
// The shared secret (PUSH_WEBHOOK_SECRET) proves the call came from the database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  notification_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  incident_id: string | null;
  assignment_id: string | null;
  expires_at: string | null;
}

interface Target {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${name} failed (${res.status})`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function POST(req: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET ?? "";
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!secret || !publicKey || !privateKey) {
    return NextResponse.json({ ok: false, error: "push is not configured" }, { status: 503 });
  }

  const given = req.headers.get("x-pers-secret") ?? "";
  if (!given || !same(given, secret)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let b: Body;
  try {
    b = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  if (!b?.user_id || !b?.notification_id) return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });

  try {
    const targets = (await rpc<Target[]>("push_targets", { p_secret: secret, p_user_id: b.user_id })) ?? [];
    if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    webpush.setVapidDetails("mailto:noreply@pers.example", publicKey, privateKey);

    const ttl = b.expires_at ? Math.max(5, Math.min(120, Math.round((Date.parse(b.expires_at) - Date.now()) / 1000))) : 60;
    const payload = JSON.stringify({
      title: b.title,
      body: b.body ?? "",
      type: b.type,
      tag: b.assignment_id ?? b.incident_id ?? b.notification_id,
      url: "/rrt",
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all(
      targets.map(async (t) => {
        try {
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
            TTL: ttl,
            urgency: b.type === "INCIDENT_OFFER" ? "high" : "normal",
          });
          sent += 1;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(t.endpoint);
        }
      }),
    );

    await rpc("push_report", { p_secret: secret, p_notification_id: b.notification_id, p_sent: sent, p_dead: dead });
    return NextResponse.json({ ok: true, sent, removed: dead.length });
  } catch {
    return NextResponse.json({ ok: false, error: "relay error" }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "pers-push-relay" });
}
