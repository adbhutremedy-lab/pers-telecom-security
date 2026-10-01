# PERS Telecom Security
Incident Management and RRT Dispatch System — demo build, Gurugram, Haryana, India.

**Status: Phase 1 (database) and Phase 2 (control-room web app) complete. Phase 3 (RRT mobile PWA) and Phase 4 (reports, admin panel) NOT started — waiting for approval.**

New here? Follow `docs/PHASE1_SETUP_GUIDE.md` (database, accounts) and then `docs/PHASE2_DEPLOY_GUIDE.md` (GitHub, Vercel, first login).

## Folder map

```
PERS/
├─ README.md                               this file
├─ package.json, tsconfig.json, next.config.ts, postcss.config.mjs, .env.example, .gitignore
├─ docs/
│   ├─ PHASE1_SETUP_GUIDE.md               step-by-step guide: Supabase, Mapbox, GitHub, Vercel accounts
│   └─ PHASE2_DEPLOY_GUIDE.md              step-by-step guide: upload to GitHub, deploy on Vercel, first login, demo
├─ src/                                    the Next.js web app (Phase 2)
│   ├─ middleware.ts                       keeps the login session fresh, sends signed-out visitors to /login
│   ├─ lib/                                Supabase clients, formatting (India time), demo simulation maths
│   ├─ hooks/                              live data + realtime refresh
│   ├─ components/                         map, tiles, incident cards, tower panel, trigger dialog, shell
│   └─ app/
│       ├─ login/                          sign-in page
│       ├─ (app)/dashboard, incidents, incidents/[id], towers, teams, demo   control-room pages
│       ├─ (app)/reports                   placeholder (Phase 4)
│       └─ rrt/                            placeholder for the team mobile app (Phase 3)
└─ supabase/
    ├─ PASTE_1_all_migrations.sql          the 10 migrations in ONE file (paste into SQL Editor)
    ├─ PASTE_2_all_seed_data.sql           the 4 seed files in ONE file
    ├─ migrations/                         the same 10 files, separately, in run order
    │   ├─ 0001_extensions_and_enums.sql
    │   ├─ 0002_tables.sql
    │   ├─ 0003_indexes_and_constraints.sql
    │   ├─ 0004_helper_functions.sql
    │   ├─ 0005_dispatch_engine.sql
    │   ├─ 0006_triggers.sql
    │   ├─ 0007_views.sql
    │   ├─ 0008_rls_policies.sql
    │   ├─ 0009_storage_realtime_cron.sql
    │   └─ 0010_reference_data.sql
    ├─ seed/
    │   ├─ seed_01_towers_and_teams.sql    30 Gurugram towers, 10 RRT teams
    │   ├─ seed_02_users.sql               14 login accounts (+ profiles)
    │   ├─ seed_03_demo_history.sql        54 historical incidents
    │   └─ seed_04_more_towers.sql         70 more towers (GGN-031…100) — Phase 2 addition, run once
    └─ tests/
        ├─ phase1_health_check.sql         structure + security + data checks
        └─ phase1_dispatch_test.sql        57-step end-to-end test (cleans up after itself)
```

## Run the web app

On Vercel: see `docs/PHASE2_DEPLOY_GUIDE.md`. On a computer with Node 20+: copy `.env.example` to `.env.local`, fill in the three values, then `npm install` and `npm run dev` (http://localhost:3000).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key — never the secret key |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token `pk.…` |

## Phase 2 screens

Dashboard (7 live tiles, map with tower clusters and coloured team markers, active incidents, team list), Incidents (filters, search, create, detail with timeline / offers / resolution report / photos, cancel, reassign, mark reached), Towers, RRT Teams, Demo Controller (admin only: autopilot for the 9 simulated teams, demo tower next to a team, reset). Team colours: green available, yellow assigned, blue reached, red offline. All times are shown in India time (Asia/Kolkata).

## Demo logins (password for all: `PersDemo@2026` — change after the demo)

| E-mail | Role |
|---|---|
| adbhutremedy@gmail.com | Super Admin |
| admin@pers.example | Administrator |
| operator1@pers.example, operator2@pers.example | Operator |
| rrt01@pers.example | RRT-01 Alpha Team — the REAL Android phone |
| rrt02@pers.example … rrt10@pers.example | RRT-02 … RRT-10 — simulated teams |

## How the dispatch engine works (all inside the database)

1. Operator calls `trigger_incident(tower)`. The tower must not already have an active incident.
2. The nearest AVAILABLE team (Haversine distance, fresh GPS) gets an offer valid for **30 s** and a notification "Incident Alert – Tower / Distance".
3. Reject or no answer → the offer goes to the next nearest team. A team is never offered the same incident twice in one round.
4. When nobody is free the incident stays OPEN and is marked EXHAUSTED; staff are alerted; it is retried every **60 s for 3 rounds**, immediately when a team comes online, and an operator can always assign by hand (`reassign_incident`).
5. Accept → incident ASSIGNED, team ASSIGNED. Every GPS ping (`post_location`) updates distance/ETA.
6. A ping within **50 m** with accuracy ≤ 100 m → REACHED automatically (operator can also `mark_reached`).
7. `resolve_incident` validates the resolution form (required questions, photos) → RESOLVED; team is released.
8. Durations are calculated by the database: accept = triggered→accepted, response = triggered→reached, resolution = triggered→resolved.

Background jobs (pg_cron): expire offers every 5 s; retry/redispatch/offline sweep every 15 s; keep idle simulated teams alive every 10 s; purge old GPS history daily.

## Functions the apps will call (`supabase.rpc('name', {...})`)

| Function | Who | Purpose |
|---|---|---|
| `trigger_incident(p_tower_id, p_source, p_form_id, p_notes)` | staff | create + dispatch |
| `accept_offer(p_assignment_id)` | team / admin for simulated | accept |
| `reject_offer(p_assignment_id, p_reason)` | team / admin for simulated | reject |
| `set_team_online(p_online, p_team_id)` | team / admin for simulated | Go Online / Offline |
| `post_location(p_lat, p_lng, p_speed_kmh, p_heading, p_accuracy_m, p_team_id)` | team / admin for simulated | GPS ping |
| `update_incident_route(p_incident_id, p_eta_seconds, p_distance_m, p_geojson)` | team | store Mapbox route + ETA |
| `resolve_incident(p_incident_id, p_answers)` | team | submit form, close incident |
| `cancel_incident(p_incident_id, p_reason)` | staff | cancel |
| `reassign_incident(p_incident_id, p_team_id)` | staff | new round / pick a team |
| `mark_reached(p_incident_id)` | staff | manual arrival |
| `search_towers(p_query, p_limit)` | signed-in | type-ahead |
| `report_summary(p_from, p_to, p_region)` | staff | report cover numbers |
| `create_demo_tower(p_lat, p_lng, p_offset_m)` | admin | tower 30 m away for the demo |
| `reset_demo()` | admin | remove demo incidents, park simulated teams |

Views for the apps: `v_rrt_live` (map markers), `v_dashboard_stats` (the 7 tiles), `v_incident_detail`, `v_incident_offers`, `v_report_incidents`, `v_tower_incident_counts`.
Realtime tables: `rrt_teams`, `incidents`, `incident_assignments`, `notifications`, `towers`, `incident_photos`.

## Tested vs not tested — Phase 2 (web app)

Tested: TypeScript type-check and production build pass; route maths unit test; a 23-step browser test (Playwright) of login, role guards, dashboard, trigger, offers, accept/reject, arrival, resolution with photo, cancel, reassign, towers, teams and the Demo Controller — run against the real Phase 1 database logic (rules, security policies and functions) through a stand-in for the Supabase web API.

Not testable outside your own accounts (check with the smoke test in the deploy guide): the real Mapbox map and road routes, Supabase Realtime live connection (a 10–30 s automatic refresh is the back-up), real Supabase login, file-storage policies and signed photo links, real pg_cron timing.

## Tested vs not tested — Phase 1 (database)

Tested on a local PostgreSQL 16 with a stand-in for Supabase's auth/storage/cron: all 10 migrations and 3 seeds run clean on an empty database and again on top of themselves; 57-step dispatch/security test passes; works even when Supabase's automatic table grants are absent.

Not testable outside a real Supabase project (the guide has you run the same two test scripts there): creating login accounts through SQL, the storage bucket policies, real pg_cron scheduling, realtime delivery, push notifications (Phase 3).
