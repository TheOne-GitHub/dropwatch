// Alert senders, each switched on by its env vars (no SDKs — plain fetch to the REST APIs).
//   SMS:   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (a +1 number, or a Messaging Service SID "MG...")
//   Email: RESEND_API_KEY, ALERT_FROM_EMAIL (e.g. "dropwatch <alerts@yourdomain.com>", domain verified in Resend)
import { optOut } from "./subs.js";

export const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
export const emailReady = () => !!(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL);

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
};

export function mockSender() {
  const outbox = [];
  return {
    outbox,
    sms: async (to, body) => { outbox.push({ channel: "sms", to, body }); return { ok: true, id: "mock-sms-" + outbox.length }; },
    email: async (to, subject, text, html, unsub) => { outbox.push({ channel: "email", to, subject, text, unsub }); return { ok: true, id: "mock-email-" + outbox.length }; },
  };
}
