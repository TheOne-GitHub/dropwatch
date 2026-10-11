// POST /api/sms-inbound — optional Twilio "A message comes in" webhook. Records STOP / START replies.
// (Twilio already blocks texts to anyone who replied STOP; this keeps our own opt-out list in sync.)
// Requests are verified with Twilio's X-Twilio-Signature using TWILIO_AUTH_TOKEN.
import { createHmac, timingSafeEqual } from "node:crypto";
import { body } from "../lib/http.js";
import { hasStore, redis } from "../lib/store.js";
import { optOut, normPhone } from "../lib/subs.js";

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|revoke)\s*$/i, START = /^\s*(start|unstop|yes)\s*$/i;
const twiml = (res, msg) => { res.statusCode = 200; res.setHeader("content-type", "text/xml"); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ""}</Response>`); };

export default async function handler(req, res) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (req.method !== "POST" || !token) { res.statusCode = 404; return res.end(); }
  let b = await bodyForm(req);
  const url = `https://${req.headers["x-forwarded-host"] || req.headers.host}${req.url}`;
  const base = url + Object.keys(b).sort().map((k) => k + b[k]).join("");
  const want = createHmac("sha1", token).update(base).digest("base64"), got = String(req.headers["x-twilio-signature"] || "");
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) { res.statusCode = 403; return res.end("bad signature"); }
  const from = normPhone(b.From), text = String(b.Body || "");
  if (hasStore() && from) {
    if (STOP.test(text)) await optOut("sms", from);
    else if (START.test(text)) await redis("DEL", "optout:sms:" + from);
  }
  return twiml(res, null); // Twilio sends its own STOP/START confirmations
}

async function bodyForm(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  const chunks = []; for await (const c of req) chunks.push(c);
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}
