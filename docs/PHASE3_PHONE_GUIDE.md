# PERS — Phase 3 Guide: the RRT phone app (for a non-technical assistant)

Goal: put the Rapid Response Team app on the real Android phone (team **RRT-01 Alpha Team**), so that it rings, shows the route, shares its GPS and files the resolution report with photos.
Time: about 45 minutes (+ 15 minutes for the optional "alert when the app is closed" part).
Nothing here can damage the database. If a screen looks different, stop and send the lead developer a screenshot.

**Golden rule (same as before):** never paste the Supabase **secret key** (`sb_secret_…`) or the database password anywhere. This phase does not need them.

What is new in Phase 3

| For the phone user | For the control room |
|---|---|
| Big GO ONLINE button, live GPS | RRT-01 turns green on the map, moves live |
| Full-screen red alert with siren, vibration and a 30-second countdown; Accept / Reject | Sees "alert sent to RRT-01", then who accepted and how fast |
| Job screen: tower, distance, arrival time, map with route, "Open in Google Maps" | The route and arrival time appear on the incident page |
| Arrival detected automatically within 50 m | Incident turns "Reached" by itself |
| Resolution report (yes/no, drop-down, text, rating, photos from camera or gallery) | Full report with the photos on the incident page |
| History of finished jobs, install on the home screen | — |

---

## PART 1 — Upload the new files to GitHub (10 min)

The project on your computer, `C:\PERS`, now contains the Phase 3 files. GitHub must get them so that Vercel can rebuild.

1. Open your GitHub repository `pers-telecom-security` in the browser.
2. Click **Add file → Upload files**.
3. Open `C:\PERS` in File Explorer. Select **everything inside it** (Ctrl+A) **except** `node_modules`, `.next`, any file starting with `.env` (the file `.env.example` is fine) and `pers-keys.txt`. Drag the selection into the GitHub page.
   Files that already exist are replaced automatically. New folders appear: `public` (icons, the app manifest, the alert service worker) and `src/app/api`.
4. Wait until every file shows a green tick. If GitHub complains about too many files, upload in two rounds: first the folders `public` and `src`, then everything else.
5. Scroll down → **Commit changes**.
6. Check on the repository page: the folder **`public`** exists, and inside `public` there is `manifest.webmanifest` and `sw.js`.

- [ ] `public/manifest.webmanifest` and `public/sw.js` are visible on GitHub
- [ ] no `.env` file, no keys in the repository

The most important new or changed files, in case GitHub shows a short list:
`public/` (8 files incl. `icons/`), `src/app/rrt/layout.tsx`, `src/app/rrt/page.tsx`, `src/app/api/push/route.ts`, `src/components/rrt/` (7 files), `src/components/PushSetupCard.tsx`, `src/hooks/` (4 new), `src/lib/` (photo, push, sound, env, types), `src/middleware.ts`, `src/lib/supabase/middleware.ts`, `next.config.ts`, `package.json`, `package-lock.json`, `supabase/migrations/0011_phone_support_and_push.sql`, `supabase/PASTE_3_phase3_phone_support.sql`.

---

## PART 2 — Update the database (5 min)

1. Supabase → your project → **SQL Editor → New query**.
2. On your computer open `C:\PERS\supabase\PASTE_3_phase3_phone_support.sql` in Notepad, select all (Ctrl+A), copy (Ctrl+C).
3. Paste into the SQL Editor → **Run**. You should see *Success. No rows returned*. (A pink/yellow "notice" about `pg_net` is explained below; it is not an error.)
4. Check: new query → `select public.server_time();` → Run → it shows the current date and time.

Running it twice does no harm.

**If the notice says "pg_net could not be enabled":** Supabase → **Database → Extensions** → search `pg_net` → switch it **on** → run the file again. Only needed for the optional Part 6.

- [ ] `select public.server_time();` shows a time

---

## PART 3 — Let Vercel rebuild (5 min)

1. The commit in Part 1 starts a new build by itself. Open Vercel → your project → **Deployments**. The top line changes from *Building* to **Ready** (2–4 minutes).
2. If it says **Error**: open it, copy the last 20 lines of the log, send them to the lead developer.
3. Open `https://pers-telecom-security.vercel.app` in a **private window** and sign in as `adbhutremedy@gmail.com`. The Dashboard must still work as before.

- [ ] Latest deployment is Ready and the dashboard still works

---

## PART 4 — Put the app on the Android phone (15 min)

Use **Chrome** on the phone (not Samsung Internet, not an in-app browser). Android 8 or newer, Internet (4G or Wi-Fi), GPS switched on.

1. On the phone open Chrome and go to `https://pers-telecom-security.vercel.app`.
2. Sign in as `rrt01@pers.example` / `PersDemo@2026`. You must see the dark screen **PERS · RRT** with a grey **GO ONLINE** button — not the dashboard.
3. **Install it:** tap the Chrome menu (three dots, top right) → **Install app** (or *Add to Home screen*) → **Install**. A PERS icon appears on the home screen. (Or open the **Account** tab in the app: it shows an *Install app* button.)
4. From now on open the app **from the home-screen icon** (it opens full-screen, without the address bar).
5. Allow the permissions when asked:
   - **Location → Allow** (while using the app). If you ever tapped *Don't allow*: Chrome menu → *Settings → Site settings → Location* → find the PERS address → *Allow*.
   - **Notifications → Allow** (only asked in Part 6).
6. **Make the phone keep working (important for the demo):**
   - Settings → Display → **Screen timeout** → 10 minutes (the app also keeps the screen on while you are online).
   - Settings → Apps → **Chrome** (or the installed **PERS** app) → Battery → **Unrestricted** / *Don't optimise*.
   - Media volume **up**: the siren plays through the media volume. Turn off *Do not disturb*.
   - Keep the phone **charging** during a long demo.
7. Tap **GO ONLINE**. Within about 10 seconds the top-right badges show **Online** (green) and **GPS ±xx m** (green).
8. On the laptop: Dashboard → the RRT-01 marker turns **green** at the phone's real position.

- [ ] app installed, opens from the icon
- [ ] Online + GPS badge green on the phone, RRT-01 green on the laptop map

If the GPS badge stays red: go outside or next to a window, check Location is Allowed, and that phone Location is switched on (swipe down → Location).

---

## PART 5 — The demo script (do it once as a rehearsal)

You need: the laptop signed in as the **Super Admin**, and the phone online (Part 4).

**A. Quick demo (30 seconds, works anywhere)**

1. Laptop → **Demo Controller**. Make sure **Autopilot** is OFF (or ON — it never moves the real phone).
2. In the box *Demo tower next to a team* choose **RRT-01 Alpha Team (real phone)**, distance **30 m**, tick *Trigger an incident there now* → **Create demo tower**.
3. **Phone:** the screen turns red, the siren sounds, the phone vibrates, a 30-second ring counts down. Tap **Accept**.
4. The phone shows *Go to the tower*, distance and arrival time. Within a few seconds it says **You have reached the tower** (the tower is only 30 m away).
5. Tap **Finish & report** → answer the questions → **Add a photo** (Take photo or Gallery) → **Submit and resolve**. A green tick screen appears.
6. Laptop → open the incident: the full timeline (alert → accepted → reached → resolved) and the resolution report with the phone photo. The team is green again.

**B. Full demo (walk or drive — the real thing)**

1. Same box, but distance **300 m** (or more). The tower is created that far north of the phone.
2. Accept on the phone. It shows the route on the map and arrival time. Tap **Open in Google Maps** for turn-by-turn voice navigation (Google Maps opens separately; come back to PERS afterwards).
3. Walk/drive to the tower. The laptop map shows the blue-dot journey live. Within 50 m the phone says **You have reached the tower** and the control room turns **Reached**.
4. File the report as above.

**C. Reject / no answer**

Trigger again, tap **Reject** (or do nothing for 30 seconds). The alert goes to the next nearest team; in the incident page you see "Rejected" or "Expired" in the list of offers.

**D. With the 9 simulated teams** (the "busy control room" look)

Turn the Autopilot ON and trigger incidents on real towers. Simulated teams respond and move; the real phone only rings when it is the nearest available team. Press **Reset demo** between rehearsals (the phone must be *Offline* or idle; tap **Go offline** in the app afterwards).

**Phone rules to remember**

- The alert rings only while the phone is **Online** and the app is **open** (or Part 6 is switched on).
- If the phone has no GPS for 45 seconds the control room automatically shows it **Offline** and does not send it alerts.
- You cannot go offline while on an incident — finish the report first.
- If the report is half-filled and the app is closed, the answers are kept on the phone (drafts); photos are already saved.

---

## PART 6 — OPTIONAL: alerts even when the app is closed or the phone is locked (15 min)

Without this part the phone rings only while the app is open on screen (this is enough for a demo where the phone is in your hand). With it, a new incident also wakes the phone as a notification. It uses free services only. If any step confuses you, skip it — nothing else depends on it.

1. Laptop, signed in as **Super Admin** → **Demo Controller** → scroll down to **Phone alerts when the app is closed** → **Create the alert keys**.
   Three boxes appear (public key, private key, secret). **They are shown once. Never send them in chat or email.**
2. **Vercel** → your project → **Settings → Environment Variables**. Add three variables, one at a time (Name, Value, **Add**) — copy each value with the *Copy* button:
   - Name `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → the first box
   - Name `VAPID_PRIVATE_KEY` → the second box
   - Name `PUSH_WEBHOOK_SECRET` → the third box
   (Vercel may warn about the `NEXT_PUBLIC` name; that one is meant to be public. Leave the name as it is.)
3. Vercel → **Deployments** → latest → **⋯ → Redeploy**. Wait for **Ready**.
4. Supabase → **SQL Editor → New query** → paste the SQL shown in step C of the same card on the Demo Controller → **Run** (*Success. No rows returned*).
   *Do this on the page you used in step 1 — do not refresh it before copying, or the values are lost; you can then simply create new ones and repeat steps 2–4.*
5. **Phone:** open the app → **Account** tab → **Alerts when the app is closed** → **Turn alerts on** → **Allow** the notification question. The text turns to *Alerts are ON*.
6. Test: lock the phone's screen (leave the app installed), trigger an incident for RRT-01 (Part 5 A). The phone should show a notification "Incident Alert" within a few seconds; tap it to open the app and the red alert.

Notes: lock-screen alerts are delivered by Google's push service; a phone in deep battery-saving may delay them by a minute. Keep the app on *Unrestricted* battery. Closed-app delivery cannot ring the siren (Android shows a normal notification sound); the siren plays once the app is opened.

- [ ] (optional) notification appears on the locked phone

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Phone shows the dashboard instead of the phone app | You are signed in with a control-room account. Sign out → sign in as `rrt01@pers.example` |
| "Your login is not linked to a response team" | Run the Phase 1 Part 5 check (user ↔ team link) or tell the lead developer |
| GO ONLINE works but the laptop still shows RRT-01 red | GPS badge is red on the phone: allow Location, go near a window. It turns green after the first position |
| No siren | Media volume up, tap GO ONLINE once (the sound is unlocked by that tap), Do-not-disturb off |
| Map on the job screen is grey | Mapbox token problem — see Phase 2 Part 5/6. The distance, arrival time and Google Maps button still work |
| "Upload failed" when adding a photo | Check internet; the incident must still be active (Assigned/Reached). Tell the lead developer if it repeats |
| Alert does not arrive | Is the phone **Online** (green)? Is another team nearer? (Laptop incident page → list of offers). Is the phone's internet working? |
| After editing a Vercel variable nothing changes | Redeploy (Deployments → ⋯ → Redeploy) |

## Before the customer demo (checklist)

- [ ] Supabase project is not paused (open the dashboard the day before)
- [ ] Vercel Hobby is for non-commercial use; for a customer demo consider one month of Vercel Pro
- [ ] Phone charged, app installed, battery *Unrestricted*, volume up, tested once outdoors
- [ ] Demo tower test (Part 5 A and B) done at least once on the same day
- [ ] Press **Reset demo** before the audience arrives, then phone → **Go online**
- [ ] Passwords (`PersDemo@2026`) changed after the demo

## What is next (needs the lead developer's go-ahead)

Phase 4: reports (PDF / Excel / CSV), admin panel (towers, teams, users, forms, Excel import), final rehearsal and demo script.
