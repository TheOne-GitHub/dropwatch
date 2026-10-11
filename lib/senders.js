// Alert senders, each switched on by its env vars (no SDKs — plain fetch to the REST APIs).
//   SMS:   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (a +1 number, or a Messaging Service SID "MG...")
//   Email: RESEND_API_KEY, ALERT_FROM_EMAIL (e.g. "dropwatch <alerts@yourdomain.com>", domain verified in Resend)
//   Push:  ntfy (https://ntfy.sh) — free, no account, no key, ON BY DEFAULT. Optional: NTFY_SERVER (self-hosted server,
//          default https://ntfy.sh), NTFY_TOKEN (access token if that server needs auth), NTFY_DISABLED=1 to switch it off.
import { optOut, normTopic } from "./subs.js";
export { normTopic };

export const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
export const emailReady = () => !!(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL);
export const ntfyReady = () => !/^(1|true|yes)$/i.test(process.env.NTFY_DISABLED || "");
export const ntfyServer = () => String(process.env.NTFY_SERVER || "https://ntfy.sh").trim().replace(/\/+$/, "");
// HTTP header values must be plain ASCII (fetch throws on anything else), so titles/tags are scrubbed; the body is UTF-8.
const ascii = (s, n = 200) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00B7\u2022\u2013\u2014]/g, "-")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E]/g, "").replace(/ {2,}/g, " ").trim().slice(0, n);

// push = { title, message, click, tags[], unsub }
export async function sendNtfy(topic, push) {
  const t = normTopic(topic);
  if (!t) return { ok: false, error: "ntfy: bad topic" };
  const headers = { "content-type": "text/plain; charset=utf-8", Title: ascii(push.title || "dropwatch", 250) || "dropwatch" };
  if (push.click && /^https?:\/\/[\x21-\x7E]+$/.test(push.click)) headers.Click = push.click;
  if (push.tags && push.tags.length) headers.Tags = push.tags.map((x) => ascii(x, 40).replace(/,/g, "")).filter(Boolean).join(",");
  if (push.priority) headers.Priority = String(push.priority);
  if (push.unsub && /^https?:\/\/[^,;\s]+$/.test(push.unsub)) headers.Actions = `view, Stop alerts, ${push.unsub}`;
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  let r;
  try { r = await fetch(`${ntfyServer()}/${t}`, { method: "POST", headers, body: String(push.message || "dropwatch alert"), signal: AbortSignal.timeout(10000) }); }
  catch (e) { return { ok: false, error: `ntfy ${e.name === "TimeoutError" ? "timeout" : String(e.message || e)}` }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: `ntfy ${r.status} ${j.error || ""}`.trim() };
  return { ok: true, id: j.id };
}

export async function sendSMS(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, from = process.env.TWILIO_FROM;
  const form = new URLSearchParams({ To: to, Body: body });
  if (/^MG/i.test(from)) form.set("MessagingServiceSid", from); else form.set("From", from);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST", body: form, signal: AbortSignal.timeout(10000),
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.code === 21610) await optOut("sms", to); // recipient replied STOP at the carrier level -> remember it
    return { ok: false, error: `twilio ${r.status} ${j.code || ""} ${j.message || ""}`.trim() };
  }
  return { ok: true, id: j.sid };
}

export async function sendEmail(to, subject, text, html, unsubUrl) {
  const headers = unsubUrl ? { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to: [to], subject, text, html, headers }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: `resend ${r.status} ${j.name || ""} ${j.message || ""}`.trim() };
  return { ok: true, id: j.id };
}

// The real sender used by the alert engine. Tests pass their own object with the same shape.
export const liveSender = {
  sms: (to, body) => (smsReady() ? sendSMS(to, body) : { ok: false, skipped: "sms not configured" }),
  email: (to, subject, text, html, unsub) => (emailReady() ? sendEmail(to, subject, text, html, unsub) : { ok: false, skipped: "email not configured" }),
  ntfy: (topic, push) => (ntfyReady() ? sendNtfy(topic, push) : { ok: false, skipped: "push turned off (NTFY_DISABLED)" }),
};

export function mockSender() {
  const outbox = [];
  return {
    outbox,
    sms: async (to, body) => { outbox.push({ channel: "sms", to, body }); return { ok: true, id: "mock-sms-" + outbox.length }; },
    email: async (to, subject, text, html, unsub) => { outbox.push({ channel: "email", to, subject, text, unsub }); return { ok: true, id: "mock-email-" + outbox.length }; },
    ntfy: async (to, push) => { outbox.push({ channel: "ntfy", to, ...push, body: push.message }); return { ok: true, id: "mock-ntfy-" + outbox.length }; },
  };
}
