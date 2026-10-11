import { send } from "../lib/http.js";
import { hasStore, getJSON, storeKind } from "../lib/store.js";
import { smsReady, emailReady, ntfyReady, ntfyServer } from "../lib/senders.js";
export default async function handler(req, res) {
  const store = hasStore();
  let last = null; try { if (store) last = await getJSON("alerts:last_run"); } catch {}
  const sms = smsReady(), email = emailReady(), push = ntfyReady();
  send(res, 200, { ok: true, version: "3.2", store: store ? storeKind() : "none (signups go to logs, alerts off)", ticketmaster: !!process.env.TICKETMASTER_API_KEY, cron_secret: !!process.env.CRON_SECRET,
    alerts: { active: store && (sms || email || push), push, push_server: push ? ntfyServer() : null, sms, email, last_run: last ? last.at : null } }, "public, max-age=60, s-maxage=60");
}
