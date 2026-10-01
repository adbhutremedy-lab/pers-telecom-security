# PERS — Phase 1 Setup Guide (for a non-technical assistant)

You do not need to understand the code. Follow the steps in order, tick each box, and stop at any "STOP" sign if something looks different from what is described. Total time: about 60–90 minutes.

**Golden rules**
1. Never paste a *secret key* or the *database password* into chat, e-mail or WhatsApp. Keep them only in your password manager or a private notes file.
2. Do one step at a time. If a screen does not match, take a screenshot and send it to the lead developer.
3. The free plans have limits (see the last section). None of them stop the 2-day demo.

---

## PART 1 — Create the free accounts (15 min)

Use the same e-mail for everything (the project e-mail), and write each login in your password manager.

- [ ] **GitHub** — https://github.com → *Sign up*. (Vercel will log in with it later.)
- [ ] **Supabase** — https://supabase.com → *Start your project* → *Continue with GitHub*.
- [ ] **Mapbox** — https://www.mapbox.com → *Get started for free* → fill in the form and confirm your e-mail. (If Mapbox asks for a card, that is only for identity; the free allowance is large — roughly 50,000 map views a month — and far above what the demo uses.)
- [ ] **Vercel** — https://vercel.com → *Sign Up* → choose the **Hobby** plan → *Continue with GitHub*. (We only deploy the website in Phase 2; today we just create the account.)

> **Important note about Vercel Hobby:** Vercel's free Hobby plan is for **non-commercial** use. A demo shown to a telecom customer may count as commercial. Before the customer demo, either upgrade that one project to Vercel Pro for the month (about US$20) or ask the lead developer to choose another host. Everything built so far works the same either way.

---

## PART 2 — Create the Supabase project (the database) (10 min)

1. Go to https://supabase.com/dashboard → **New project**.
2. Fill in:
   - **Organization:** your personal one (created automatically).
   - **Project name:** `pers-demo`
   - **Database password:** click **Generate a password**, then **copy it into your password manager**. You cannot see it again.
   - **Region:** **South Asia (Mumbai)** — the closest to Gurugram, so the app feels fast.
   - **Plan:** Free.
3. Click **Create new project**. Wait 1–2 minutes until the page shows the project dashboard (the green "Healthy" status).

- [ ] Project created, password saved.

---

## PART 3 — Switch on two helpers (3 min)

The 30-second escalation (offer → next team) runs inside the database and needs these.

1. Left menu → **Database** → **Extensions**.
2. In the search box type `pg_cron` → switch it **ON** (leave schema as suggested). 
3. Search `pg_net` → switch it **ON**.

- [ ] `pg_cron` ON  - [ ] `pg_net` ON

---

## PART 4 — Install the database (10 min)

You will paste two files from the folder `C:\PERS\supabase\`.

**4A. The structure**

1. Left menu → **SQL Editor** → **New query** (blank).
2. On your computer open `C:\PERS\supabase\PASTE_1_all_migrations.sql` with Notepad, press **Ctrl+A**, **Ctrl+C**.
3. Click inside the Supabase editor, press **Ctrl+V**, then click the green **Run** button (bottom right).
4. If a box appears saying *"Potential issue detected… destructive operations"*, click **Run this query**. This is expected (the file safely replaces its own earlier copies).
5. Wait up to 30 seconds. At the bottom you should see **"Success. No rows returned."** (A few grey notices are fine.)

> **STOP** if you see a red error. Do not run it again blindly — copy the whole red message and send it to the lead developer.
> *Fallback if your browser struggles with the big paste:* run the ten files in `C:\PERS\supabase\migrations\` one by one, in numeric order (0001, 0002 … 0010).

**4B. The demo data**

1. **New query** again (blank). Paste `C:\PERS\supabase\PASTE_2_all_seed_data.sql` → **Run**.
2. Expect "Success". This creates 30 Gurugram towers, 10 teams, 14 logins and 54 past incidents.
3. A grey message *"Could not create the login for … automatically"* means the login accounts were not created by the script. Do **Part 5** and then run 4B once more.

- [ ] 4A done  - [ ] 4B done

---

## PART 5 — Check the logins (5 min)

1. Left menu → **Authentication** → **Users**. You should see **14 users**: `adbhutremedy@gmail.com`, `admin@pers.example`, `operator1@…`, `operator2@…`, `rrt01@…` to `rrt10@…`.
2. **Only if the list is empty or shorter:** click **Add user** → **Create new user**, enter the e-mail and password `PersDemo@2026`, tick **Auto Confirm User**, **Create**. Repeat for every missing e-mail, then re-run `PASTE_2_all_seed_data.sql` (step 4B). It fills in everything else.
3. Close the sign-up door so nobody else can register: **Authentication** → **Sign In / Providers** (or **Providers → Email**) → turn **OFF** "Allow new users to sign up" → **Save**.

- [ ] 14 users visible  - [ ] sign-ups switched off

---

## PART 6 — Run the two health checks (5 min)

1. SQL Editor → **New query** → paste `C:\PERS\supabase\tests\phase1_health_check.sql` → **Run**.
   - The result is a table. Every row must say **PASS**.
2. **New query** → paste `C:\PERS\supabase\tests\phase1_dispatch_test.sql` → **Run**.
   - This plays a full incident (alert → no answer → reject → accept → arrival → form → escalation → security checks) and then tidies up after itself. Expect **57 rows, all PASS**.
3. Take a screenshot of both result tables and send them to the lead developer.

Rows that may legitimately say FAIL, with the fix:

| Row says | Meaning | Fix |
|---|---|---|
| pg_cron is enabled … FAIL | Part 3 was skipped | Do Part 3, then run `migrations\0009_storage_realtime_cron.sql` again |
| private storage bucket … FAIL | bucket not created | Storage → **New bucket** → name `incident-media` → leave **Public** OFF → Create; then re-run `0009` |
| storage access policies … FAIL | policies could not be added by script | send a screenshot to the lead developer |
| profile linked to login … FAIL | a login is missing | Part 5 step 2 |

- [ ] health check all PASS  - [ ] dispatch test all PASS

---

## PART 7 — Collect the keys (5 min)

1. Left menu → **Project Settings** (gear icon) → **API Keys**.
2. Copy these into a private notes file called `pers-keys.txt` (outside the project folder, never uploaded anywhere):
   - **Project URL** — looks like `https://abcdefgh.supabase.co`. (Also under *Project Settings → Data API*.) Safe to share.
   - **Publishable key** — starts with `sb_publishable_…`. Safe: it is designed to live in the app.
   - **Secret key** — starts with `sb_secret_…` (press *Reveal*). **DANGER:** it bypasses every security rule. Never paste it into chat, a screenshot, GitHub or the website code. It will only be typed into Vercel's secret settings in Phase 2.
3. Also note your **database password** (Part 2). You normally will not need it again.

- [ ] Project URL saved  - [ ] publishable key saved  - [ ] secret key saved (private)

---

## PART 8 — Mapbox token (5 min)

1. Log in at https://account.mapbox.com → you land on your account page.
2. Under **Access tokens** you will see a **Default public token** starting with `pk.`. Copy it into `pers-keys.txt`. (Public tokens are meant to be in the web page.)
3. Later (Phase 2, once we know the website address) you will click **Create a token**, name it `pers-demo`, add the **URL restriction** of the website, and delete the default token — this stops anyone else using your allowance.
4. Only ever use tokens starting with `pk.` Never share a token starting with `sk.`.

- [ ] Mapbox public token saved

---

## PART 9 — GitHub and Vercel (prepare only) (5 min)

1. GitHub → **New repository** → name `pers-telecom-security` → **Private** → **Create**. Leave it empty; the lead developer will upload the project in Phase 2.
2. Vercel → **Add New… → Project** → **Import Git Repository** → connect your GitHub account when asked. (No repository to import yet — that's fine.)

- [ ] private GitHub repository created  - [ ] Vercel linked to GitHub

---

## What happens next (all later phases are now built — see the Phase 2, 3 and 4 guides)

| When | Phase | Result |
|---|---|---|
| Day 1 | Phase 2 — web app (login, live map, towers, incidents, RRT teams, Demo Controller) | dashboard live on Vercel |
| Day 1–2 | Phase 3 — RRT mobile app (PWA on the Android phone), notifications, resolution form, photos | phone receives and completes an incident |
| Day 2 | Phase 4 — reports (PDF/Excel/CSV), admin panel, final demo rehearsal | ready to present |


---

## Good to know (free plans)

- **Supabase Free pauses a project after about a week with no activity.** Open the Supabase dashboard the day before the demo; if it says *Paused*, click **Restore project** (takes a couple of minutes).
- Free Supabase has **no automatic backups**. Keep this folder: it can rebuild the database in minutes.
- Free Supabase gives 500 MB of database and 1 GB of file storage — plenty for the demo.
- **Change the demo password** (`PersDemo@2026`) for real people after the demo: Authentication → Users → the user → *Send password recovery* or *Update user*.
- If anything is unclear, stop and ask. Nothing in Parts 1–9 can damage the live system, and the database can be erased and rebuilt from the folder at any time.
