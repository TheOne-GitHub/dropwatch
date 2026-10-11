# dropwatch v2 — Vercel edition

Live board of upcoming drops — sneakers, Ye/Yeezy, Supreme + streetwear, collectibles, console restocks, ticket on-sales — with countdowns, a live link checker, and "text me when it drops" signups.

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
| `ADMIN_KEY` | Any secret string. Then `GET /api/signups?key=<ADMIN_KEY>` lists signups. |
| `CRON_SECRET` | Any secret string. Vercel sends it to the cron route automatically; outsiders can't trigger refreshes. |
| `TICKETMASTER_API_KEY` | Free key from developer.ticketmaster.com. Adds the biggest US music on-sales for the next 14 days to the Tickets tab, refreshed automatically. Without it, Tickets shows 4 hand-checked on-sales. |

## How auto-refresh works

- **`/api/drops`** scrapes every source live (about 2 s) and Vercel's CDN caches the result for **30 min** (`s-maxage=1800, stale-while-revalidate`). Once it's 30 min old, the next visitor gets the cached copy right away and Vercel refreshes it in the background. New drops show up within about 30 min of being posted at the source, with no setup.
- **Vercel Cron** (`vercel.json`) calls **`/api/cron`** daily at 13:00 UTC to re-scrape and store a snapshot. The Hobby plan only allows daily crons. On Pro you can change the schedule to `"*/30 * * * *"`.
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
- `GET /api/cron`: force a re-scrape (cron)
- `GET /api/check?url=…`: live check of any product/ticket page: `live` / `sold_out` / `not_live` / `blocked` / `unknown`, plus the signals it found
- `POST /api/signup` `{contact, drop, url}`: saves a phone/email
- `GET /api/signups?key=ADMIN_KEY`: list signups
- `GET /api/health`: shows which optional pieces are configured

## Run locally

```
node dev-server.mjs        # http://localhost:3000 — same handlers Vercel runs (Node 18+)
```
No dependencies, no build step.
