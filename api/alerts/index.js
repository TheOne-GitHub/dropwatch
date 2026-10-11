// GET /api/alerts?key=ADMIN_KEY — dry run: which alerts WOULD fire right now (nothing is sent, no state changes),
// plus the last real run's summary and which senders are switched on.
import { send, query, siteUrl } from "../../lib/http.js";
import { getJSON, hasStore, redis } from "../../lib/store.js";
import { freshDrops } from "../drops.js";
import { runAlerts } from "../../lib/alerts.js";
import { smsReady, emailReady, ntfyReady } from "../../lib/senders.js";

export default async function handler(req, res) {
  const key = process.env.ADMIN_KEY;
  if (!key || query(req).get("key") !== key) return send(res, 403, { error: "not allowed (set ADMIN_KEY in Vercel env vars, then pass ?key=...)" });
  const senders = { push: ntfyReady(), sms: smsReady(), email: emailReady(), cron_secret: !!process.env.CRON_SECRET };
  if (!hasStore()) return send(res, 200, { active: false, senders, note: "No storage connected — connect Upstash Redis in Vercel → Storage, then redeploy." });
  const d = await freshDrops();
  const dry = await runAlerts({ drops: d.drops || [], siteUrl: siteUrl(req), dry: true });
  send(res, 200, { active: true, senders, subscribers: await redis("SCARD", "subs"), last_run: await getJSON("alerts:last_run"), would_fire_now: dry });
}
