"use client";

import { useState } from "react";
import { BellRing, Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";

interface Generated {
  pub: string;
  priv: string;
  secret: string;
  origin: string;
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function generate(): Promise<Generated> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  return { pub: b64url(rawPub), priv: jwk.d ?? "", secret: b64url(secretBytes), origin: window.location.origin };
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">{label}</p>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-2.5 text-xs text-slate-100">{value}</pre>
        <Button
          tone="outline"
          className="shrink-0 px-2.5 py-1.5 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setOk(true);
              window.setTimeout(() => setOk(false), 2000);
            } catch {
              /* user can select the text by hand */
            }
          }}
        >
          {ok ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {ok ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** One-time helper that makes the three values needed to switch on closed-app alerts. Nothing is saved or sent anywhere. */
export default function PushSetupCard() {
  const [g, setG] = useState<Generated | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" data-testid="push-setup">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-slate-900">
        <BellRing className="h-5 w-5 text-slate-400" /> Phone alerts when the app is closed (optional)
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Makes the RRT phone ring even when the app is closed or the screen is locked. Follow <strong>Part 6</strong> of the Phase 3 phone guide. This box only
        makes the three secret values; it does not store them anywhere, so copy them into Vercel and Supabase straight away.
      </p>
      {!g ? (
        <Button
          onClick={async () => {
            try {
              setErr(null);
              setG(await generate());
            } catch {
              setErr("This browser could not create the keys. Use Chrome on a computer.");
            }
          }}
        >
          <KeyRound className="h-4 w-4" /> Create the alert keys
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
            These values are shown only now. Closing or refreshing this page loses them (you can simply make new ones, but then you must change Vercel and Supabase again).
            Never send them in a chat or email.
          </p>
          <p className="text-sm font-semibold text-slate-800">Step A — Vercel → Project → Settings → Environment Variables → add these three:</p>
          <CopyBox label="Name: NEXT_PUBLIC_VAPID_PUBLIC_KEY   (value below)" value={g.pub} />
          <CopyBox label="Name: VAPID_PRIVATE_KEY   (value below)" value={g.priv} />
          <CopyBox label="Name: PUSH_WEBHOOK_SECRET   (value below)" value={g.secret} />
          <p className="text-sm font-semibold text-slate-800">Step B — then Redeploy in Vercel (Deployments → latest → ⋯ → Redeploy).</p>
          <p className="text-sm font-semibold text-slate-800">Step C — Supabase → SQL Editor → New query → paste this → Run:</p>
          <CopyBox
            label="SQL"
            value={`insert into app.push_config (id, url, secret)\nvalues (true, '${g.origin}/api/push', '${g.secret}')\non conflict (id) do update\n  set url = excluded.url, secret = excluded.secret, updated_at = now();`}
          />
          <Button tone="ghost" onClick={() => setG(null)}>
            Hide these values
          </Button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
    </section>
  );
}
