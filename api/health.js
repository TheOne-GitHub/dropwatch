import { send } from "../lib/http.js";
import { hasStore, getJSON, storeKind } from "../lib/store.js";
import { smsReady, emailReady } from "../lib/senders.js";
export default async function handler(req, res) {
  const store = hasStore();
  let last = null; try { if (store) last = await getJSON("alerts:last_run"); } catch {}
  const sms = smsReady(), email = emailReady();
  send(res, 200, { ok: true, store: store ? storeKind() : "none (signups go to logs, alerts off)", ticketmaster: !!process.env.TICKETMASTER_API_KEY, cron_secret: !!process.env.CRON_SECRET,
    alerts: { active: store && (sms || email), sms, email, last_run: last ? last.at : null } }, "public, max-age=60, s-maxage=60");
}
