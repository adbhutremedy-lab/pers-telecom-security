# PERS — Phase 2 Deploy Guide (for a non-technical assistant)

Goal: put the control-room website on the internet (Vercel), connected to your Supabase database and Mapbox map, and prove it works.
Time: about 45 minutes. Nothing here can damage the database. If a step looks different on your screen, stop and send the lead developer a screenshot.

**Golden rule:** never paste the Supabase **secret key** (`sb_secret_…`) or the database password anywhere in this guide. The website in Phase 2 does not need them.

---

## PART 1 — Add the 70 missing towers (5 min)

Phase 1 installed 30 towers. The brief asks for 100, so one more small script adds GGN-031 … GGN-100.

1. Supabase → your project → **SQL Editor** → **New query**.
2. On your computer open `C:\PERS\supabase\seed\seed_04_more_towers.sql` in Notepad, select all (Ctrl+A), copy (Ctrl+C).
3. Paste into the SQL Editor and press **Run**. You should see *Success. No rows returned*.
4. Check: new query → type `select count(*) from towers;` → Run → result must be **100**.

Running it twice does no harm.

- [ ] towers count = 100

---

## PART 2 — Put the project on GitHub (10 min)

You created a private repository `pers-telecom-security` in Phase 1 Part 9. It is empty. We now upload the project.

**Easiest way — upload in the browser**

1. Open the repository page on GitHub → click **uploading an existing file** (link in the middle of the page) — or **Add file → Upload files**.
2. Open the folder `C:\PERS` in File Explorer. Select **everything inside it** (Ctrl+A) **except** these, which must NOT be uploaded:
   - `node_modules` (if it exists; it should not)
   - `.next` (if it exists)
   - any file starting with `.env` (except `.env.example`, which is fine)
   - `pers-keys.txt`
   - the PDF document (optional, harmless)
3. Drag the selection into the GitHub page. Wait until every file shows a green tick. (GitHub accepts up to 100 files per drag. If it complains, upload `src` first, then everything else in a second round.)
4. Scroll down → **Commit changes**.
5. Check: the repository page now shows `package.json`, `src`, `supabase`, `docs`, `README.md`.

- [ ] repository contains package.json and the src folder
- [ ] no `.env` file and no keys are in the repository

---

## PART 3 — Get the three values you need (5 min)

Open your private `pers-keys.txt`. You need exactly three lines:

| Name used by the website | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API → **Project URL** (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`). Older projects call it *anon* — that works too |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox → Access tokens → public token (`pk.…`) |

If a key starts with `sb_secret_` or `sk.`, **stop — that is the wrong one**.

---

## PART 4 — Deploy on Vercel (10 min)

1. Open https://vercel.com → **Add New… → Project**.
2. Find `pers-telecom-security` in the list → **Import**. (If it is not listed: *Adjust GitHub App Permissions* → allow that repository.)
3. Leave **Framework Preset = Next.js**, **Root Directory** as it is, build settings untouched.
4. Open **Environment Variables**. Add the three, one at a time (Name, Value, **Add**):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_MAPBOX_TOKEN`
5. Press **Deploy**. Wait 2–4 minutes. Fireworks screen = success. Click the preview picture to open the website; note its address, e.g. `https://pers-telecom-security.vercel.app` (copy it into `pers-keys.txt`).

**Common mistakes (all seen in real life — check these first if login says "not configured" or an error):**

- The three names must be spelled **exactly**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN` (capital letters, underscores; "SUPABASE" with an A, not "SUPERBASE").
- The Supabase URL is only `https://xxxx.supabase.co`. Nothing after `.co` (no `/rest/v1/`). The website now strips extra parts by itself, but keep it clean.
- Vercel may warn that `NEXT_PUBLIC` values are visible in the browser. That is fine for these three — they are meant to be public. Do **not** rename them.
- After any change to a variable you must **Redeploy** (Deployments → latest → ⋯ → Redeploy). Without it nothing changes.
- Test in a private (incognito) window, so an old copy of the page is not shown.

If the build fails: open the failed deployment → copy the last 20 lines of the log → send them to the lead developer.

If you ever **change** an environment variable: Vercel → Project → Deployments → the latest one → **⋯ → Redeploy**. (The values are baked in at build time; the change does nothing until you redeploy.)

- [ ] Vercel shows "Ready"  - [ ] website address saved

---

## PART 5 — Tell Supabase and Mapbox the website address (5 min)

**Supabase** → Authentication → **URL Configuration**:
- **Site URL** → your Vercel address (`https://pers-telecom-security.vercel.app`) → **Save**.
- **Redirect URLs** → Add URL → `https://pers-telecom-security.vercel.app/**` → Save.

**Mapbox** → Access tokens → **Create a token**:
- Name `pers-demo`; leave the default public scopes ticked; under **URL restrictions** add your Vercel address (and `http://localhost:3000` only if the lead developer runs it locally).
- **Create token**, copy the new `pk.…` token → in Vercel replace `NEXT_PUBLIC_MAPBOX_TOKEN` (Settings → Environment Variables → ⋯ → Edit) → **Redeploy**.
- Then delete the old default token in Mapbox so nobody else can use it.

Do the Mapbox restriction last, after Part 6 passes — it is easy to mistype the address and think the map is broken.

---

## PART 6 — First-login smoke test (10 min)

Open the website. You should see the login page titled **PERS Telecom Security**.

| # | Do this | You should see |
|---|---|---|
| 1 | Sign in `adbhutremedy@gmail.com` / `PersDemo@2026` | The **Dashboard**: seven number tiles and a map of Gurugram with coloured team markers |
| 2 | Look at the map | Towers as dots (zoom in to split the clusters), 10 teams. Teams RRT-02…10 are green |
| 3 | Left menu → **Towers** | 100 towers; search for `Cyber` finds Cyber Hub Tower |
| 4 | Left menu → **RRT Teams** | 10 teams; RRT-01 is shown OFFLINE until the phone goes online (Phase 3) |
| 5 | Left menu → **Incidents** | 54 historical incidents; click one → timeline, offers and the resolution report |
| 6 | Left menu → **Demo Controller** | Autopilot switch, speed and delay settings |
| 7 | Sign out; sign in `operator1@pers.example` | Same dashboard, but **no Demo Controller** in the menu |
| 8 | Sign out; sign in `rrt01@pers.example` | The phone app (big GO ONLINE button), not the dashboard (Phase 3) |

If the map area is grey/blank: the Mapbox token is wrong or restricted to the wrong address (Part 5). If login says "profile": run the Phase 1 Part 5 check.

- [ ] all 8 rows behave as described

---

## PART 7 — The demo without the real phone (Phase 2 only)

1. Sign in as the Super Admin → **Demo Controller**.
2. Switch **Autopilot ON** and **keep this browser tab open** — the simulated teams are driven by this tab. Closing it stops them (they just stand still).
3. Go to **Dashboard** → click any tower → **Trigger incident**.
4. Watch: the nearest green team gets an offer; after the delay set in the Demo Controller it accepts, turns yellow, drives along the roads to the tower, turns blue on arrival, then the incident resolves with a generated photo and the team goes green again.
5. Click the incident → the full timeline and resolution report.
6. Quick shortcut: Demo Controller → **Create demo tower next to a team** → it creates a tower 30 m from a team and triggers it, so the whole cycle takes seconds.
7. Between rehearsals press **Reset demo** (removes demo incidents, parks the teams at base).

The real phone (RRT-01) is never moved by the Demo Controller. If it is OFFLINE it is simply skipped in dispatch.

---

## Good to know

- **Vercel Hobby (free) is for personal, non-commercial use only.** A demo to a telecom customer is commercial; the safe choice is Vercel Pro (about US$20 for one seat, cancel after). Decide before the demo.
- **Supabase Free pauses** after about a week without use: open the dashboard the day before and click *Restore project* if it says Paused.
- **Mapbox free allowance** is far above demo use (about 50,000 map loads and 100,000 route requests a month).
- **Demo passwords** (`PersDemo@2026`) must be changed for real people after the demo.
- Live updates use Supabase Realtime with an automatic refresh every 10–30 seconds as a back-up, so the screen stays correct even if the live connection drops.

## What is next (needs the lead developer's go-ahead)

| Phase | Result |
|---|---|
| 3 | RRT mobile app (installable PWA on the Android phone): siren alert with 30-second countdown, accept/reject, navigation, live GPS, resolution form, photos, push notifications — **done, see `PHASE3_PHONE_GUIDE.md`** |
| 4 | Reports (PDF / Excel / CSV), Admin panel (towers, teams, users, forms, Excel import), final rehearsal |
