# dropwatch v3 — Vercel edition

Live board of upcoming drops — sneakers, Ye/Yeezy, Supreme + streetwear, collectibles, console restocks, ticket on-sales — with countdowns, a live link checker, and **real alerts**: pick your tabs or a single drop, leave a phone and/or email, and dropwatch texts/emails you before it drops, when a console restocks, and when new drops land in your tabs.

## v3 setup (do these in order)

The site keeps working at every step; each step switches on more.

1. **Push this repo to `main`.** Vercel redeploys. Board, tabs, link checker and the new alert signup sheet all work. Without storage, signups go to Vercel Logs (search `SIGNUP`) and the site says *"alerts aren't active yet"*.
2. **Connect storage:** Vercel → project → **Storage** → **Create / Connect** → **Upstash for Redis** (free) → Connect to the project (all environments). This adds `KV_REST_API_URL` + `KV_REST_API_TOKEN` (the `UPSTASH_REDIS_REST_URL` / `_TOKEN` names work too). → Signups are saved as subscribers; the alert engine runs. Still no messages go out until step 3.
3. **Add a sender** (Vercel → project → Settings → **Environment Variables**, then **Redeploy**). One or both:
   - **Text (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (your Twilio number like `+15551234567`, or a Messaging Service SID `MG…`). US numbers need A2P 10DLC registration in Twilio before carriers deliver at volume (a toll-free number needs toll-free verification instead).
   - **Email (Resend):** `RESEND_API_KEY`, `ALERT_FROM_EMAIL` (e.g. `dropwatch <alerts@yourdomain.com>`, on a domain verified in Resend).
   → From here the site says *"alerts are live by text/email"*. Without Twilio, phone-only signups are kept and start getting texts once it's added; same for email.
4. **Add two more env vars in Vercel** (any long random strings), then Redeploy:
   - `CRON_SECRET`: protects `/api/cron`.
   - `ADMIN_KEY`: unlocks the admin routes below.
5. **Add 2 GitHub repo secrets:** GitHub → repo → Settings → **Secrets and variables → Actions → New repository secret**:
   - `DROPWATCH_URL` = `https://dropwatch-livid.vercel.app` (no trailing slash)
   - `CRON_SECRET` = exactly the same value as in Vercel
   Then GitHub → **Actions** tab → "dropwatch alerts" → **Run workflow** once to check it (green = good). It then runs every 15 min on its own. Without these secrets, alerts only run once a day (Vercel's daily cron at 13:00 UTC, the Hobby-plan limit), so 1-hour reminders and restock alerts would be late or missed.
6. **Test it:** open `https://dropwatch-livid.vercel.app/api/alerts/test?key=<ADMIN_KEY>&to=<your phone or email>`: you get one real test alert. `…/api/alerts?key=<ADMIN_KEY>` shows what would fire right now (sends nothing).
7. *(Optional)* Twilio console → your number → Messaging → "A message comes in" → Webhook `https://dropwatch-livid.vercel.app/api/sms-inbound` (HTTP POST). Keeps STOP/START in sync in our own list. Twilio already blocks texts to anyone who replied STOP, and we also record that whenever Twilio reports it, so this is belt-and-braces.

### What triggers an alert

| Alert | When | Who gets it |
|---|---|---|
| **Morning of** | from 8 AM in your time zone on the drop's day (while it's still 70+ min away) | anyone watching that drop or its tab, with "Morning of" on |
| **1 hour before** | when the drop is 0–70 min away | anyone watching that drop or its tab, with "1 hour before" on |
| **Restock** | a console tracker goes from out of stock to in stock at a store since the last check | anyone watching that console, or the Consoles tab |
| **New drop** | a dated drop that wasn't on the board last check appears | anyone watching that tab |
| **Link live** | a link someone asked to watch (from the link checker) flips from sold out / not live to live | the people watching that link |

- Checks run every 15 min (GitHub Actions; GitHub sometimes starts runs a few minutes late, so the 1-hour window is 70 min wide). Vercel's daily cron is the backup.
- **No repeats:** every (person, channel, alert) is recorded in Redis for 60 days before it's sent, so nobody gets the same alert twice, even if two runs overlap. Restocks also have a 6-hour cooldown per item. A send that fails is released and retried next run.
- **No spam:** everything for one person in one run goes out as **one** text / **one** email; at most 8 per person per day per channel. The first run after storage is connected only records the board (no "new drop" storm).
- **Opt-out:** every text ends "Reply STOP to opt out". Every email has an unsubscribe link (`/api/unsubscribe`, plus one-click `List-Unsubscribe` headers). Signing up again turns alerts back on.
- v2 signups already in Redis (list `signups`) are folded into v3 subscribers on the first run.


## Deploy in 3 steps

1. **Unzip** `dropwatch-vercel.zip`.
2. Get it into Vercel. Pick one:
   - **No terminal:** make a new repo on github.com → "uploading an existing file" → drag in everything *inside* the unzipped folder → Commit. Then **vercel.com/new** → **Import** that repo.
   - **Terminal:** `cd dropwatch-vercel && npx vercel --prod`. It opens your browser to log in, then deploys.
   Framework preset: **Other**. Leave build settings blank; `vercel.json` already sets them.
3. **Deploy**, then open `https://<your-project>.vercel.app`. The board loads live data on the first visit, and the daily cron shows up under Settings → Cron Jobs.

### Optional (2 min, recommended): save signups
Vercel dashboard → your project → **Storage** → **Upstash for Redis** (free tier) → **Connect**. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Redeploy. From then on:
- signups are saved in Redis (without it they still go to **Logs**, search `SIGNUP`), and
- the cron job's snapshot is stored, so if a source site is down the board keeps that source's last good drops.

## Environment variables (all optional)

| Var | What it does |
|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Added by the Upstash connect above. Stores signups + the drops snapshot. (`UPSTASH_REDIS_REST_URL` / `_TOKEN` also work.) |
| `ADMIN_KEY` | Any secret string. Unlocks `/api/signups`, `/api/alerts` (dry run) and `/api/alerts/test`. |
| `CRON_SECRET` | Any secret string. Vercel sends it to the cron route automatically; the GitHub workflow sends it from the `CRON_SECRET` repo secret. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Text alerts via Twilio. |
| `RESEND_API_KEY` / `ALERT_FROM_EMAIL` | Email alerts via Resend. |
| `SITE_URL` | Optional. Base URL used inside alerts (defaults to the Vercel production URL). |
| `ALERT_TEST_TO` | Optional default recipient for `/api/alerts/test`. |
| `TICKETMASTER_API_KEY` | Free key from developer.ticketmaster.com. Adds the biggest US music on-sales for the next 14 days to the Tickets tab, refreshed automatically. Without it, Tickets shows 4 hand-checked on-sales. |

## How auto-refresh works

- **`/api/drops`** scrapes every source live (about 2 s) and Vercel's CDN caches the result for **30 min** (`s-maxage=1800, stale-while-revalidate`). Once it's 30 min old, the next visitor gets the cached copy right away and Vercel refreshes it in the background. New drops show up within about 30 min of being posted at the source, with no setup.
- **GitHub Actions** (`.github/workflows/alerts.yml`) calls **`/api/cron`** every 15 min: it refreshes the board when the stored copy is over 10 min old, then runs the alerts. **Vercel Cron** (`vercel.json`) does the same daily at 13:00 UTC as a backup (the Hobby plan only allows daily crons).
- The page re-fetches every 10 min while it's open and shows **"updated X ago"**.
- If a source fails, its last good items carry over. If everything fails, the bundled `data/seed.js` snapshot is shown.

## Sources (every item comes from one of these pages; nothing is made up)

| Tab | Source | Auto-refreshing? |
|---|---|---|
| Kicks | nicekicks.com/sneaker-release-dates (pages 1–2) | yes |
| Ye | Nice Kicks calendar items matching Yeezy/YZY + hand-checked items in `lib/curated.js` | calendar yes, curated no |
| Supreme + street | drops.gg (current Supreme week, with the droplist once posted) + streetwear collabs from the calendar | yes |
| Collectibles | pokemon.com monthly TCG release post + lego.com Coming Soon | yes |
| Consoles | nowinstock.net Switch 2 + PS5 trackers (live in-stock status per store) + Zelda Switch 2 launch | yes |
| Tickets | `lib/curated.js` (+ Ticketmaster API if key set) | with key |

Sneaker times are estimates (10 AM ET is the usual US launch). Edit `lib/curated.js` to add drops by hand; items drop off automatically once they're past.

## API

- `GET /api/drops`: the board JSON (`updated_at`, `counts`, `sources`, `drops[]`)
- `GET /api/cron`: refresh the board + run alerts (cron; needs `Authorization: Bearer <CRON_SECRET>` when that's set)
- `GET /api/check?url=…`: live check of any product/ticket page: `live` / `sold_out` / `not_live` / `blocked` / `unknown`, plus the signals it found
- `POST /api/signup` `{phone?, email?, cats?[], drop?{id,name,url,at}, link?, remind?{before1h,morning}, tz?}`: subscribe (v2's `{contact, drop, url}` still works)
- `GET /api/signups?key=ADMIN_KEY`: list subscribers (contacts masked; `&full=1` to show them)
- `GET /api/alerts?key=ADMIN_KEY`: dry run (what would fire now) + last run summary
- `GET /api/alerts/test?key=ADMIN_KEY&to=<phone|email>`: send one real test alert
- `GET|POST /api/unsubscribe?id=…&t=…&ch=email|sms|all`: unsubscribe link target
- `POST /api/sms-inbound`: optional Twilio webhook for STOP/START
- `GET /api/health`: shows which optional pieces are configured

## Run locally

```
node dev-server.mjs                 # http://localhost:3000 — same handlers Vercel runs (Node 18+)
MEMORY_STORE=1 node dev-server.mjs  # same, with an in-memory store so signups/alerts work without Redis
npm test                            # alert engine tests (in-memory store, mock sender)
npm run dry-run                     # which alerts would fire right now on the live board (nothing is sent)
```
No dependencies, no build step.
