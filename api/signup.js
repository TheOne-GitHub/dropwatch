// POST /api/signup — pick what to watch + how to be reached.
// v3.2 body: { ntfy? (push topic, 12-64 chars [A-Za-z0-9_-]), phone?, email?, cats?: ["kicks","games",...], drop?: {id,name,url,at}, link?, remind?: {before1h, morning}, tz? }
// v2 body still accepted: { contact, drop (name), url }.
// With Upstash connected: saved as a subscriber the alert engine reads. Without it: written to the function log
// (Vercel → Logs, search "SIGNUP") and the response says alerts aren't active yet.
import { send, body } from "../lib/http.js";
import { hasStore } from "../lib/store.js";
import { upsertSub, normPhone, normEmail, normTopic } from "../lib/subs.js";
import { smsReady, emailReady, ntfyReady, ntfyServer } from "../lib/senders.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const b = await body(req);
  if (!b) return send(res, 400, { error: "bad_json" });
  let { phone, email } = b;
  if (b.contact && !phone && !email) { const c = String(b.contact); if (c.includes("@")) email = c; else phone = c; }
  if (phone && !normPhone(phone)) return send(res, 422, { error: "that phone number doesn't look right" });
  if (email && !normEmail(email)) return send(res, 422, { error: "that email doesn't look right" });
  const ntfy = b.ntfy ? normTopic(b.ntfy) : null;
  if (b.ntfy && !ntfy) return send(res, 422, { error: "that push topic doesn't look right (12-64 letters, numbers, - or _)" });
  if (!normPhone(phone) && !normEmail(email) && !ntfy) return send(res, 422, { error: "need a push topic, a phone or an email" });
  const drop = b.drop && typeof b.drop === "object" ? b.drop : null;
  const input = { ntfy, phone, email, cats: Array.isArray(b.cats) ? b.cats : [], drop, link: b.link || (!drop && b.url) || null, remind: b.remind || {}, tz: b.tz };
  if (/@example\.(com|org)$/i.test(email || "")) return send(res, 200, { ok: true, test: true, alerts_active: false });
  const status = { push: ntfyReady(), sms: smsReady(), email: emailReady() };
  if (!hasStore()) {
    console.log("SIGNUP " + JSON.stringify({ ...input, at: new Date().toISOString(), country: req.headers["x-vercel-ip-country"] || null }));
    return send(res, 200, { ok: true, stored: "log", alerts_active: false, message: "You're on the list. Alerts aren't switched on yet — you'll start getting them once they are." });
  }
  try {
    const { sub, isNew } = await upsertSub(input);
    const wantsSms = !!sub.phone, wantsEmail = !!sub.email, wantsPush = !!sub.ntfy;
    const active = (wantsPush && status.push) || (wantsSms && status.sms) || (wantsEmail && status.email);
    const push = ntfy ? { topic: ntfy, subscribe_url: `${ntfyServer()}/${ntfy}` } : null;
    return send(res, 200, { ok: true, id: sub.id, new: isNew, stored: "redis", alerts_active: !!active, channels: status, push,
      watching: { cats: sub.cats, drops: sub.drops.map((d) => d.name), links: sub.links },
      message: active ? (wantsPush && status.push ? "You're in. Free push alerts are on." : "You're in. We'll alert you when it matters.") : "Saved. Alerts aren't switched on yet — you'll start getting them once they are." });
  } catch (e) {
    return send(res, e.status || 500, { error: String(e.message || e) });
  }
}
