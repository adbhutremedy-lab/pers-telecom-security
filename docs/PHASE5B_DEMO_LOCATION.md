# PERS — Update 5b: choose the demo city (map centre) from Settings

Before a demo in a new country (Nigeria, Ghana, Dubai, India…), the Super Admin picks the city once and the whole control room follows.

## What changed
- **Admin → Settings → Demo location** (new card at the top). Only a **Super Admin** can change it; an Administrator can see it.
  - **Quick pick** list: Lagos, Abuja, Port Harcourt, Accra, Kumasi, Dubai, Abu Dhabi, Riyadh, Nairobi, Johannesburg, Gurugram, Delhi, Mumbai.
  - Or type any **latitude / longitude** and a **zoom** (10–12 suits a city). **Use my location** fills them from your laptop. **Check on Google Maps** opens the spot so you can confirm it.
  - Tick **Also move the 9 simulated teams to this city** (ticked by default). They are placed 2–5 km around the centre so the fleet looks real. The real phone (RRT-01) is never moved.
- The **map opens on that city**, and the top bar reads "Live · Lagos, Nigeria" (it used to say Gurugram always).
- **Reset demo** now parks the simulated teams in the chosen city.

## Do this once (about 5 minutes)
1. Upload the files to GitHub (everything in `C:\PERS` except `node_modules`, `.next`, `.env` files and `pers-keys.txt`). Vercel redeploys by itself.
2. Supabase → **SQL Editor** → paste all of `supabase/PASTE_6_demo_location.sql` → **Run**. The last result must say `functions_found = 1`.

## For each new demo (Lagos example)
1. Sign in as the Super Admin → **Admin → Settings** → Quick pick **Lagos, Nigeria** → **Save location**.
2. **Admin → Towers → Add tower** — add one or more towers in Lagos (region "Lagos"). Put one where you will physically stand if RRT-01 must "arrive" at it.
3. Open the **Dashboard** — the map is on Lagos with the 9 simulated teams around it. Optional: **Demo Controller → Demo tower** creates a tower beside a simulated team in one click.
4. RRT-01 signs in on the phone and sets Available. The nearest team gets the alert first, so a phone in Lagos gets Lagos alerts.

To go back to India: Quick pick **Gurugram, India** → Save.

## Good to know
- The 50 seeded Gurugram towers and the history stay in the database (they just are not on screen when the map is on Lagos). Reports still include them; filter by region **Lagos** to show only the new city.
- Times on screen are still shown in **India Standard Time**, wherever the demo is. Tell me if you want a time-zone setting too.
- Mapbox maps work everywhere. Road routes need real roads at both ends, so keep towers in the same city as the teams.

## Tested here
12/12 database checks (`supabase/tests/phase5b_map_location_test.sql`) and a 17-step browser click-through: Gurugram → Lagos → back, the map really re-centres, the simulated teams move, an Administrator sees it read-only, bad latitude/zoom is refused.
Not tested here: the live Mapbox tiles (no internet map in my test setup) — please look at the real map once.
