# PERS — Phase 4 Guide: Reports, Admin panel and the final rehearsal (for a non-technical assistant)

Goal: switch on the last two parts of the system, then rehearse the customer demo from start to finish.

- **Reports** — daily, weekly, monthly or custom reports as PDF, Excel or CSV, plus a one-page PDF for every single incident.
- **Admin panel** — add and change towers, response teams, logins, the resolution form and the dispatch rules; load many towers or teams from an Excel file.
- **Final rehearsal** — a checklist and a word-for-word demo script (Part 6).

Time: about 40 minutes to install, about 60 minutes for one full rehearsal.
Nothing here can damage the live system. If a screen looks different from this guide, stop and send the lead developer a screenshot.

**Golden rule (same as before):** never paste the Supabase **secret key** (`sb_secret_…`) or the database password anywhere. This phase does not need them.

Who can do what

| | Operator | Administrator | Super Admin |
|---|---|---|---|
| Dashboard, incidents, trigger incidents | yes | yes | yes |
| Reports (all downloads) | yes | yes | yes |
| Admin: towers, teams, forms, Excel import, change log | no | yes | yes |
| Admin: edit names / phones / team links of operators and phone users | no | yes | yes |
| Admin: create logins, reset passwords, change roles | no | no | **yes** |
| Admin: change dispatch rules (Settings) | no | no | **yes** |

---

## PART 1 — Upload the new files to GitHub (10 min)

The project on your computer, `C:\PERS`, now contains the Phase 4 files.

1. Open your GitHub repository `pers-telecom-security`.
2. **Add file → Upload files**.
3. Open `C:\PERS` in File Explorer. Select **everything inside it** (Ctrl+A) **except** `node_modules`, `.next`, any file starting with `.env` (`.env.example` is fine) and `pers-keys.txt`. Drag the selection onto the GitHub page. Files that already exist are replaced automatically.
4. Wait until every file shows a green tick (if GitHub complains about too many files, upload in two rounds: first `src` and `supabase`, then everything else).
5. Scroll down → **Commit changes**.
6. Check on the repository page: there is a folder `src/components/admin` (7 files), a folder `src/lib/reports`, and `supabase/PASTE_4_phase4_admin.sql`.

New and changed files, in case GitHub shows a short list:
`src/app/(app)/admin/page.tsx`, `src/components/admin/` (AdminClient, TowersAdmin, TeamsAdmin, UsersAdmin, FormsAdmin, SettingsAdmin, ImportAdmin, AuditAdmin), `src/app/(app)/reports/` (page and ReportsClient), `src/components/reports/Charts.tsx`, `src/lib/reports/` (data, export), `src/components/AppShell.tsx`, `src/app/(app)/incidents/[id]/IncidentDetailClient.tsx`, `package.json`, `package-lock.json`, `supabase/migrations/0012_admin_and_import.sql`, `supabase/PASTE_4_phase4_admin.sql`, `supabase/tests/phase4_admin_test.sql`, `docs/PHASE4_FINAL_GUIDE.md`, `README.md`.

- [ ] `src/components/admin` and `supabase/PASTE_4_phase4_admin.sql` are visible on GitHub
- [ ] no `.env` file and no keys in the repository

---

## PART 2 — Update the database (5 min)

1. Supabase → your project → **SQL Editor → New query**.
2. On your computer open `C:\PERS\supabase\PASTE_4_phase4_admin.sql` in Notepad, select all (Ctrl+A), copy (Ctrl+C).
3. Paste into the SQL Editor → **Run**. You should see *Success. No rows returned*.
4. Check: new query →

   `select count(*) from pg_proc where proname like 'admin\_%';`

   → Run → the answer should be **7**.

Running the file twice does no harm.

**Optional extra check (5 min):** open `C:\PERS\supabase\tests\phase4_admin_test.sql`, paste it into a new query, Run. The result table must show 33 rows, all **PASS**. The test cleans up after itself.

- [ ] the query shows 7

---

## PART 3 — Let Vercel rebuild (5 min)

1. The commit in Part 1 starts a new build. Open Vercel → your project → **Deployments**. The top line changes from *Building* to **Ready** (2–4 minutes).
2. If it says **Error**: open it, copy the last 20 lines of the log and send them to the lead developer.
3. Open https://pers-telecom-security.vercel.app and sign in as `adbhutremedy@gmail.com`. In the left menu **Reports** and **Admin** are now active (they said "Phase 4" before).

- [ ] Vercel says Ready
- [ ] Reports and Admin open

---

## PART 4 — Reports (how to use them)

Menu → **Reports**. Anybody in the control room can open it.

1. **Period** — choose Today, Yesterday, This week, Last 7 days, Last 30 days, This month, Last month, All time, or Custom (then fill *From* and *To*). Days start at midnight **India time**.
2. **Region** — optionally limit the report to one region.
3. The page shows: six number tiles (incidents, resolved %, average response, average resolution, average acceptance time, % accepted by the first team), a chart of incidents per day (per week or per month for long periods), an outcome bar, incidents by region, the RRT team performance table, the towers with the most incidents, and the list of incidents. **Show as table** under a chart switches it to numbers.
4. Top right, three download buttons:
   - **PDF** — a landscape A4 report with the tiles, chart, tables and the incident list. Good to hand to a manager.
   - **Excel** — a workbook with sheets *Summary, Incidents, By team, By tower, By region, By day/week/month, Resolution answers*. Good for the customer's own analysis.
   - **CSV** — one line per incident; opens in Excel with correct accents.
   Files are named like `PERS_incident_report_last-30-days-to-2026-10-01.pdf`. The downloads always contain **every** incident of the period, even if the list on the screen shows only the first rows.
5. **One incident:** in the incident list click the small document icon at the end of a row, or open the incident and click **PDF report**. You get a portrait A4 page set with tower, team, timeline, offers, the resolution answers and the photos.

Times: *Response* = alarm to arrival at the tower. *Resolution* = alarm to closed. *Accept time* = alarm to a team accepting.

If a period has no incidents the page says so and the download buttons are greyed out. A report can hold up to 10,000 incidents; for more, choose a shorter period.

- [ ] Reports → All time → 54+ incidents appear
- [ ] PDF, Excel and CSV each download and open
- [ ] an incident PDF opens and shows a photo

---

## PART 5 — Admin panel (how to use it)

Menu → **Admin** (only Administrators and the Super Admin see it). Seven tabs:

**Towers** — search by number, name or region; filter by status; tick *Archived* to see removed towers. **Add tower**: tower number (for example GGN-101), site name, latitude, longitude, region, status, optional address → Save. The pencil edits. The box icon **archives** a tower (it disappears from the map and the lists but its incident history stays); the circular arrow restores it. A tower cannot be deleted for good, on purpose.

**Teams** — the Rapid Response Teams. **Add team**: code (RRT-11), name, mobile, vehicle, region, base position. Tick *Simulated team* only for demo teams that the Demo Controller moves. The *Login* column shows which e-mail the team's phone uses; "no login" means the team cannot sign in yet (see Users). The code cannot be changed later. Unticking *Active* stops the team receiving incidents.

**Users** — everyone who can sign in.
- Super Admin → **Add login**: full name, e-mail, role, and (for a phone user) the team. Press **Generate** for a readable password such as `gy6i-bG6E-rV6H`. After **Create login** a window shows the e-mail and password **once** — copy it and give it to the person.
- Super Admin → the key icon **resets a password** (same window shows the new one).
- The pencil edits name, phone, role, team and *Active*. Unticking *Active* stops that person signing in immediately. You cannot deactivate yourself, change your own role, or remove the last Super Admin.
- Each team can have only **one active phone login**; the team list in the form only offers teams without one.
- An Administrator sees the list and can edit operators and phone users, but cannot create logins, reset passwords or change roles.

**Forms** — the resolution form the phone shows when closing an incident. Left: the forms; the one with the star is the **default** and is used for every new incident. Right: its questions.
- **New form**, **Duplicate** (copies all questions — the easy way to make a variation), **Rename**, **Make default**, **Deactivate** (the default form cannot be deactivated; make another one the default first).
- **Add question**: the question text, optional help line, answer type (Yes/No, Rating, Text, Pick one, Pick several, Photos, File), Required. Rating needs a lowest and highest number; Pick one/several needs at least two choices, one per line; Photos/File needs *at least* and *at most* files.
- The arrows move a question up or down, the pencil edits, the bin deletes. Answers already saved on past incidents are **not** changed by edits or deletions.
- Choosing a different **default** form applies to the **next** incident that is triggered; incidents already open keep the form they started with. Editing the questions of a form changes what the phone shows for every unresolved incident that uses it, so avoid editing the live form during a demo — duplicate it and work on the copy.

**Settings** — the dispatch rules (only the Super Admin can change them; others see them greyed out): time to accept an offer (30 s), wait before re-offering (60 s), automatic rounds (3), when a team counts as offline (45 s), how often the phone sends GPS (5 s), auto-arrival distance (50 m), and so on. Each line shows the allowed range; a value outside it is refused with a message. **Save changes** saves all edited lines. New offers use the new values immediately; a phone picks up a new GPS interval the next time the app is opened. Keep the demo values unless the lead developer says otherwise.

**Excel import** — add many towers or teams at once.
1. Choose **Towers** or **Response teams**.
2. **Download Excel template**. It has the right column headings and one example row; the second sheet explains each column.
3. Fill it in with Excel (delete the example row or overwrite it). Required columns are marked with * on the page: towers need tower_number, site_name, lat, lng, region (status and address are optional); teams need code and name (everything else is optional). Latitude and longitude are plain numbers such as 28.4595 and 77.0266.
4. **Choose your filled file** (.xlsx or .csv). The page reads it and **checks every row**. Common alternative headings are understood (for example "Latitude", "Zone", "Site ID").
5. If a row has a problem, you get a list such as *Row 5 (IMP-003): latitude is not a number*. The row number is the row number you see in Excel. **Nothing is saved while any row has a problem.** Fix the file and choose it again.
6. When all rows are fine the green button **Import n towers** appears. Click it once. Towers or teams whose number/code already exists are **updated**, new ones are **added**. Limits: 2,000 towers or 500 teams per file.

**Change log** — the latest 200 changes made to towers, users, forms, questions and settings: when, who, what. Use it to answer "who changed this?".

- [ ] Add a tower, find it with the search, archive it, restore it
- [ ] Download the tower template, fill 2 rows, import them
- [ ] As Super Admin: Add login for a test person, sign in with it in a private window
- [ ] Duplicate the form, add a question, move it, then make the **original** form the default again

---

## PART 6 — Final rehearsal and demo script

### 6A. Countdown checklist

**Two days before**
- [ ] Parts 1–3 done, Vercel is **Ready**
- [ ] Supabase project is not paused (open the dashboard; if it says *Paused*, click **Restore project**)
- [ ] Decide about Vercel: the free Hobby plan is for **non-commercial** use only. A demo to a telecom customer is commercial; the safe choice is Vercel Pro for one month (about US$20, cancel afterwards)
- [ ] One full rehearsal with the script below, **on the same laptop, network and phone** you will use for the customer

**The day before**
- [ ] Open the Supabase dashboard again (keeps it awake)
- [ ] Phone: fully charged, PERS app on the home screen, signed in as `rrt01@pers.example`, battery setting *Unrestricted*, volume up, Do-not-disturb off, location On
- [ ] Laptop: charger, browser zoom 100%, notifications off, bookmarks ready for PERS, Reports and the Admin page
- [ ] Phone hotspot or second internet connection available in case the venue network fails
- [ ] Download a sample **PDF report** and an **Excel report** to the desktop — a safety copy to show if the internet fails

**One hour before**
- [ ] Laptop signed in as `adbhutremedy@gmail.com` (Super Admin) in one window; `operator1@pers.example` in a private window (for the "operator view")
- [ ] Demo Controller → **Reset demo**. Then phone → **Go online** (GPS badge green)
- [ ] Dashboard shows 10 teams: RRT-01 green and 9 simulated teams
- [ ] Autopilot OFF for now
- [ ] Trigger one test with the *Demo tower next to a team* (30 m) and finish it, then **Reset demo** again

**After the demo**
- [ ] Super Admin → Admin → Users → reset the passwords of all demo accounts (key icon). Note the new ones in a safe place — **not** in the chat or in GitHub
- [ ] Phone → **Go offline**

### 6B. The demo script (about 15 minutes)

Roles: **Presenter** (talks, drives the laptop), **Phone holder** (a second person with the Android phone — or the presenter if alone).

**1. The control room (2 min)** — laptop, Dashboard.
Say: "This is what a control-room operator sees all day." Point at: the seven live tiles, the map with tower clusters, the coloured team markers (green free, yellow on a job, blue at a tower, red offline), the list of teams. Zoom the map to Gurugram; click a tower to show its details.

**2. An alarm comes in (2 min)** — laptop.
Say: "A tower alarm arrives." Click **Create incident**, search the tower (for example GGN-005), **Trigger**. The incident opens: "The system picked the nearest free team by distance — no human decision, no phone calls."
Point at: *alert sent to the nearest team*, the **30-second countdown**.

**3. The team's phone (3 min)** — phone.
The phone shows the full-screen red alert with siren and vibration. Hold it up so the customer sees and hears it. Tap **Accept**. Show: the tower name, distance, arrival time, the route on the map, **Open in Google Maps** for turn-by-turn navigation.
*Shortcut for a room demo:* before step 2 use the Demo Controller card *Demo tower next to a team* → RRT-01, **30 m**, tick *Trigger an incident there now*. The phone rings and "arrives" within seconds.
When the phone says **You have reached the tower**, laptop: "The control room saw this automatically — no phone call from the field."

**4. Closing the job (2 min)** — phone, then laptop.
Phone: **Finish & report** → answer the questions → **Add a photo** → **Submit and resolve**.
Laptop: refresh the incident page: full timeline (alarm → accepted → reached → resolved), durations, the resolution report and the photo. Click **PDF report**: "Every incident produces an audit-ready report."

**5. A busy day (2 min)** — laptop, Demo Controller.
Switch **Autopilot ON**. Trigger 2–3 incidents on different towers. The simulated teams accept and drive; markers move. Show a **rejected / expired** offer in an incident's offer list: "If a team rejects or does not answer in 30 seconds, the alert moves to the next nearest team automatically." Show **Reassign** and **Cancel incident**: "The operator can always step in."

**6. Reports (2 min)** — Reports page.
Choose *Last 30 days*. Walk through the tiles and the chart. Click **PDF**, **Excel**, **CSV**: "Daily, weekly or monthly, for managers or for your own analysis." Filter by one region.

**7. Admin and flexibility (2 min)** — Admin page (Super Admin).
- **Forms**: "The resolution form is yours to design" — Duplicate, add one question live, show it.
- **Settings**: "The 30-second timer, the 50 m arrival distance and the retry rules are settings, not code."
- **Excel import**: "Your 5,000 towers load from a spreadsheet; every row is checked first." Drop in the prepared sample file (see 6C).
- **Users**: "Roles — Super Admin, Administrator, Operator, Response team."

**7b. Messages and voice (2 min)** — new in Phase 5, see `PHASE5_RADIO_GUIDE.md` Part 6: message a team from the incident page, talk to it with the push-to-talk button, and broadcast to all online teams.

**8. Close (1 min)**
Summarise: automatic nearest-team dispatch, automatic escalation, live tracking, field report with photos, reports. Then take questions (6D).

Press **Reset demo** when you are done, and phone → **Go offline**.

### 6C. Prepare once: a sample import file
Admin → Excel import → Towers → **Download Excel template**. Fill 3–5 rows of towers near Gurugram with new numbers (for example DEMO-001 … DEMO-005). Keep the file on the desktop. During the demo import it; afterwards archive those towers in Admin → Towers (or leave them).

### 6D. Honest answers to likely questions
- *Does it work offline in the field?* The phone needs mobile data for the alert and for GPS sharing; reports keep a local draft if the signal drops, and photos upload when you submit.
- *Can it handle our real tower list?* The import loads up to 2,000 towers per file; the demo has 100.
- *Is the data safe?* Every table is protected by row-level security in the database; each role sees and changes only what it should; changes to towers, users, forms and settings are logged.
- *Can the rules change?* Yes — the timers and distances are on the Settings tab; forms are designed in the Admin panel.
- *What is demo-only?* The 9 simulated teams, the Demo Controller and the demo password. The production build would use real phones for every team and strong passwords.

### 6E. If something goes wrong during the demo
| Problem | What to do |
|---|---|
| Phone does not ring | Is it **Online** (green) and the app open? Is another team nearer? (incident page → offers). Quick fix: Demo Controller → *Demo tower next to a team* → RRT-01, 30 m |
| Map is grey | Mapbox problem — carry on; distance, times, reports all still work |
| Website slow / white screen | Press Ctrl+F5. Switch the laptop to the phone hotspot |
| Everything is down | Show the PDF and Excel safety copies and the Phase 2 screenshots, explain, and re-run when it is back |
| An incident is stuck | Incident page → **Cancel incident**, or Demo Controller → **Reset demo** |

---

## Good to know

- **Vercel Hobby (free) is for personal, non-commercial use only.** A customer demo is commercial; Vercel Pro for one month is the safe choice.
- **Supabase Free pauses** after about a week without use; open the dashboard the day before.
- **Demo passwords** (`PersDemo@2026`) must be changed for real people. Super Admin → Admin → Users → key icon. A changed password does not sign out a phone that is already signed in; the new one is needed the next time it signs in.
- Free Supabase has **no automatic backups**. Keep the `C:\PERS` folder: it rebuilds the database in minutes.
- Reports are built **in the browser**, so a very large report (thousands of incidents) can take a few seconds.

## Troubleshooting

| What you see | What to do |
|---|---|
| Reports or Admin still says "Phase 4" / link greyed | Vercel has not finished or the files were not uploaded: check Part 1 step 6 and Part 3 |
| Admin: "function admin_… does not exist" | Part 2 was not run. Run `PASTE_4_phase4_admin.sql` |
| Add login: "a login with this e-mail already exists" | Use another e-mail, or find the person in the list and use the key icon |
| Add login: "this team already has an active login" | A team can have only one phone login. Deactivate the old one first (Users → pencil → untick Active) |
| Import says "Nothing was saved" | Fix the rows listed (row numbers are Excel's own) and choose the file again |
| Import says the file has no column for … | Use the downloaded template, or rename the column heading to the one named |
| Import of an old `.xls` file | Open it in Excel and **Save As → Excel Workbook (.xlsx)** |
| A setting is refused | The message names the allowed range |
| PDF/Excel button is grey | The period has no incidents; choose a longer period |
| Incident PDF shows no photo | The photo had not finished uploading, or is a file type that cannot be placed on a page; the list of file names is still printed |

## What was tested, what was not (Phase 4)

Tested: TypeScript check and production build pass. The browser test (Playwright) of **Reports**: filters, tiles, chart, downloads — the generated CSV (every incident, accents correct), Excel (all sheets and row counts) and PDFs (period report and single incident with embedded photo) were opened and read back. The browser test of **Admin**: 62 steps covering towers (add, validation, edit, archive, restore), teams, users (create a phone login and sign in with it, reset password and sign in with it, deactivate and be refused, role change, Administrator limits), forms (duplicate, add / reorder / delete questions, default switching), settings (range checks, saved values, read-only for Administrator) and Excel/CSV import (wrong headers, bad rows with Excel row numbers, clean import, team import), change log. 33 database checks for the new functions. The Phase 2 (23 steps) and Phase 3 phone (35 steps) tests still pass.

Not testable outside your accounts: the real Mapbox map, the real Android phone (GPS, camera, siren, install), Google's push delivery, Supabase's live connection and storage policies on the real project, and the real SQL-created login on your Supabase project (it uses the same method as the demo accounts you already have). Use the rehearsal in Part 6; if anything fails, send the lead developer a screenshot.
