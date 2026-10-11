// GET /api/alerts/test?key=ADMIN_KEY&to=+15551234567   (or &to=you@example.net)
// Sends ONE test alert, built from the next real upcoming drop on the board, through the real sender.
import { send, query, siteUrl } from "../../lib/http.js";
import { freshDrops } from "../drops.js";
import { normPhone, normEmail } from "../../lib/subs.js";
import { compose, fmtWhen } from "../../lib/alerts.js";
import { sendSMS, sendEmail, smsReady, emailReady } from "../../lib/senders.js";

export default async function handler(req, res) {
  const q = query(req), key = process.env.ADMIN_KEY;
  if (!key || q.get("key") !== key) return send(res, 403, { error: "not allowed (set ADMIN_KEY in Vercel env vars, then pass ?key=...)" });
  const raw = q.get("to") || process.env.ALERT_TEST_TO || "";
  const phone = raw.includes("@") ? null : normPhone(raw), email = raw.includes("@") ? normEmail(raw) : null;
  if (!phone && !email) return send(res, 422, { error: "add &to=<phone or email>" });
  const d = await freshDrops();
  const next = (d.drops || []).filter((x) => !x.restock && x.at && Date.parse(x.at) > Date.now())[0];
  const tz = q.get("tz") || "America/New_York";
  const item = next ? { line: `TEST: next drop is ${next.name} · ${fmtWhen(Date.parse(next.at), tz)} · ${next.store}`, url: next.shop } : { line: "TEST: dropwatch alerts are working", url: null };
  const msg = compose([item], { id: "test", token: "test" }, siteUrl(req));
  if (phone) {
    if (!smsReady()) return send(res, 409, { error: "SMS not configured: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in Vercel env vars, then redeploy" });
    return send(res, 200, { channel: "sms", to: phone, body: msg.sms, result: await sendSMS(phone, msg.sms) });
  }
  if (!emailReady()) return send(res, 409, { error: "Email not configured: add RESEND_API_KEY and ALERT_FROM_EMAIL in Vercel env vars, then redeploy" });
  return send(res, 200, { channel: "email", to: email, subject: msg.subject, result: await sendEmail(email, "[test] " + msg.subject, msg.text, msg.html, null) });
}
