# PERS — Phase 5 Guide: Messages and push-to-talk voice (for a non-technical assistant)

The client asked: *the Super Admin / Administrator can send a text message to any RRT and the RRT can send one back; voice should work like a walkie-talkie; when the admin talks it goes to one selected RRT or to all online RRTs.*

What was built

| For the control room (Super Admin / Administrator) | For the RRT phone |
|---|---|
| New menu item **Messages** with a channel list: **All online teams** + every team | New bottom tab **Radio** |
| Type a message (up to 500 characters) or **hold the microphone button** and talk (up to 30 seconds), release to send | Same: type, or hold the big microphone button to talk to the control room |
| Choose **one team** or **All online teams** (only teams that are online *and* have a phone) | Messages and voice from the control room appear at once; voice **plays by itself** |
| Red unread numbers on the menu and on each team; a pop-up with the sender when a team talks; incoming voice plays automatically | Red number on the Radio tab; vibration and beep; if the phone is locked and alerts are switched on (Phase 3 Part 6) a lock-screen alert shows |
| Ticks on your own messages: sent, and **read / played** (for "all online" it shows e.g. 2/3) | — |
| On an incident page a new **Message team** button opens that team's channel | — |

**How the voice works (important to explain to the client):** it is *push-to-talk voice clips*. You hold the button and talk; when you release, the clip is sent and plays on the other side about 1–2 seconds later. It is not a live open line like a real radio (the listener does not hear you *while* you are still speaking). That keeps it working on the free plans with no extra service. A live-streaming radio can be added later as a separate upgrade.

Who can use it: Super Admin and Administrator on the control-room side, and the RRT phones. **Operators cannot see or use Messages.** Teams can talk only to the control room (not to each other).

**Golden rule (same as before):** never paste the Supabase **secret key** or the database password anywhere. This phase does not need them.

---

## PART 1 — Upload the new files to GitHub (10 min)

1. Open your GitHub repository `pers-telecom-security` → **Add file → Upload files**.
2. From `C:\PERS` select **everything** (Ctrl+A) **except** `node_modules`, `.next`, any `.env` file (`.env.example` is fine) and `pers-keys.txt`. Drag onto the GitHub page; existing files are replaced.
3. Wait for the green ticks → **Commit changes**.
4. Check that `src/components/radio` (4 files), `src/app/(app)/messages` and `supabase/PASTE_5_phase5_radio.sql` are on GitHub.

Most important new or changed files: `src/lib/radio.ts`, `src/hooks/useMessages.ts`, `src/components/radio/` (MessageBubble, PttButton, RadioContext), `src/components/rrt/RadioTab.tsx`, `src/components/rrt/RrtApp.tsx`, `src/components/AppShell.tsx`, `src/app/(app)/messages/`, `src/app/(app)/incidents/[id]/IncidentDetailClient.tsx`, **`next.config.ts`** (it used to block the microphone), `supabase/migrations/0013_messages_and_voice.sql`, `supabase/PASTE_5_phase5_radio.sql`, `supabase/tests/phase5_radio_test.sql`, `package.json`.

- [ ] `next.config.ts` and `src/components/radio` are visible on GitHub

## PART 2 — Update the database (5 min)

1. Supabase → **SQL Editor → New query**.
2. Open `C:\PERS\supabase\PASTE_5_phase5_radio.sql` in Notepad, Ctrl+A, Ctrl+C, paste into the editor → **Run**. Expected: *Success. No rows returned*. (Yellow "notice" lines are fine.)
3. Check 1 — new query: `select count(*) from pg_proc where proname in ('send_message','messages_mark_heard');` → must show **2**.
4. Check 2 — Supabase → **Storage**: a bucket called **voice-messages** exists (private). If it does not: **New bucket** → name `voice-messages` → leave *Public* OFF → Create, then run the PASTE_5 file again.
5. Optional: paste `C:\PERS\supabase\tests\phase5_radio_test.sql` into a new query and Run: **35 rows, all PASS** (it cleans up after itself).

- [ ] check 1 shows 2
- [ ] bucket `voice-messages` exists

## PART 3 — Let Vercel rebuild (5 min)

Vercel → Deployments → wait for **Ready** (2–4 minutes). If **Error**: copy the last 20 lines of the log to the lead developer.

## PART 4 — Allow the microphone

- **Laptop (control room):** the first time you hold the microphone button the browser asks *Use your microphone?* → **Allow**. If you clicked Block earlier: click the padlock next to the address → **Microphone → Allow** → reload.
- **Android phone:** open PERS → **Radio** → hold the microphone button. Chrome asks *Allow microphone?* → **Allow**. If it was blocked: Chrome menu ⋮ → **Settings → Site settings → Microphone** → PERS site → **Allow**. (If the app is installed on the home screen it uses the same setting.)
- Phone volume (media volume) up. A message plays by itself only after the app has been touched at least once since it was opened; if the phone shows **"Tap here to hear the waiting voice message"**, tap it.

- [ ] laptop microphone allowed
- [ ] phone microphone allowed

## PART 5 — How to use it

**Control room → Messages**
1. Choose the channel on the left: **All online teams** or one team. A green dot = online, red = offline. "simulated, no phone" teams (RRT-02…RRT-10 in the demo) cannot receive messages — the page says so.
2. **Text:** type, press **Enter** to send (Shift+Enter = new line).
3. **Voice:** *press and hold* the round microphone button, speak, *release* to send. While recording you see the seconds counter (maximum 30). **Slide the mouse/finger upward before releasing to cancel.** Very short taps (under half a second) are ignored. Keyboard: hold **Space** while the button is selected.
4. **All online teams** sends to every team that is online *and* has a phone login at that moment. The header shows which ones ("Goes to: RRT-01"). A team that comes online later does not receive it.
5. Your own messages show a tick; double tick + *1/1* = the team read it (text) or played it (voice).
6. Incoming messages from teams: a pop-up with the team name, a beep, a red number on **Messages** and on that team, and voice plays automatically (switch off with the tick-box *Play incoming voice automatically*). **Stop audio** silences a clip.
7. A team that is **offline** can still be messaged: it sees the message when it next opens the app (or on the lock screen if Phase 3 Part 6 is on).

**RRT phone → Radio tab**
1. Messages from the control room appear in the chat; a red number on **Radio** counts what you have not read or heard.
2. Voice from the control room **plays by itself** (not while an incident alert is ringing — it waits until the alert is answered).
3. To talk: *press and hold* the big microphone button, speak, *release*. Slide your finger up to cancel. Or type a message and tap the arrow.
4. All of it goes to the control room (every Super Admin / Administrator sees it).

## PART 6 — Add this to the demo script (2 minutes)

After step 3 of the Phase 4 demo (the phone has accepted the incident):
1. Laptop → incident page → **Message team** → type *"Gate code is 4821, security is expecting you"* → Enter. The phone vibrates and shows it.
2. Hold the microphone on the laptop: *"RRT-01, please confirm your arrival time."* Release. On the phone the voice plays by itself.
3. Phone → **Radio** → hold the microphone: *"Five minutes away."* Release. The laptop pops up the team name and plays it.
4. Laptop → **Messages → All online teams** → *"All teams: shift change at 18:00"*. Point at the double tick when the phone has read it.
Say: "Typed or spoken, to one team or to every team that is on duty, with proof that it was read."

## Good to know

- Voice clips and messages are kept (history). Voice files are stored in the private Storage bucket `voice-messages` (free plan: 1 GB shared with photos; a 10-second clip is only about 30 KB).
- Limits: text 500 characters; voice 30 seconds on screen (60 s absolute limit in the database); at most 40 messages per person per minute.
- Only people who may see a message can open its voice file (database rules). Operators cannot.
- Needs mobile data / internet on both sides. If the phone has no signal, the clip is not sent (the app says so) — press and talk again when the signal is back.
- The microphone indicator on the phone shows while you hold the button and for about 20 seconds afterwards (the microphone is kept ready for a quick second press), then turns off.
- iPhone: the app records in the format iPhones use, but this was not tested on an iPhone. The demo phone is Android.
- Vercel Hobby (free) is non-commercial; see the Phase 4 guide.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Microphone is blocked…" | Part 4: allow the microphone for the site, then reload |
| Holding the button does nothing / "Voice recording is not available" | The page must be opened with https:// (the Vercel address is). Use Chrome. Update the browser |
| "Voice not sent … new row violates / permission denied for storage" | Part 2 check 2: the `voice-messages` bucket and its policies are missing. Run PASTE_5 again; if the policy notice repeats, tell the lead developer |
| "send_message does not exist" | Part 2 was not run |
| "No team with a phone is online right now" | Nobody is online with a phone. Phone → Go online (Job tab), or choose one team instead |
| Voice does not play on the phone | Raise the media volume. Tap **Tap here to hear…** if shown. Tap the clip's play button |
| The phone is silent when locked | Needs the optional lock-screen alerts (Phase 3 Part 6); otherwise the message waits in the Radio tab |
| Messages arrive only after ~4 seconds | Normal fallback when the live connection is slow; they still arrive |
| Operator says Messages is missing | By design: only Super Admin and Administrator |

## What was tested, what was not (Phase 5)

Tested: TypeScript check and production build; 35 database checks (who may send, who may read, target rules, "all online" excludes offline and simulated teams, voice file rules, read receipts, spam limit, direct table writes refused, operators locked out); a 41-step browser test with two real browser sessions (control room and phone) and a simulated microphone: text both ways, unread badges, toasts, read ticks, "all online" blocked when nobody is online, short taps and slide-to-cancel send nothing, voice recorded and uploaded in both directions, automatic playback on the phone, replay by tap, playback on the control room, operator redirected away, "Message team" button. All earlier tests still pass (Phase 2: 23, Phase 3 phone: 35, Phase 4 reports: 19, Phase 4 admin: 62).
The test found and fixed a real problem: the site's security header blocked the microphone; this is now allowed for the site only.

Not testable outside your accounts: the real Android microphone and speaker, loudness, the real Storage bucket policies (same method as the photo bucket), the real Supabase live connection (a 4-second refresh is the back-up), and lock-screen alerts via Google. Rehearse Part 6 once with the real phone, ideally in two different rooms or with a headset to avoid echo.
