// POST /api/signup {contact, drop?, url?} — "text me when it drops" capture.
// Stored in Redis when connected; without a store, each signup is written to the function log
// (Vercel dashboard -> Logs, search "SIGNUP") so nothing is silently lost.
import { send, body } from "../lib/http.js";
import { redis, hasStore } from "../lib/store.js";
import { randomUUID } from "node:crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const b = await body(req);
  if (!b) return send(res, 400, { error: "bad_json" });
  const contact = String(b.contact || "").trim().slice(0, 120);
  const digits = contact.replace(/\D/g, "");
  if (!(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) || (digits.length >= 10 && digits.length <= 15))) return send(res, 422, { error: "need a phone or email" });
  if (/@example\.(com|org)$/i.test(contact)) return send(res, 200, { ok: true, position: 0, test: true });
  const rec = { id: randomUUID().slice(0, 8), contact, drop: String(b.drop || "").slice(0, 200), url: String(b.url || "").slice(0, 500), at: new Date().toISOString(), country: req.headers["x-vercel-ip-country"] || null };
  if (hasStore()) {
    await redis("RPUSH", "signups", JSON.stringify(rec));
    const n = await redis("LLEN", "signups");
    return send(res, 200, { ok: true, position: n, stored: "redis" });
  }
  console.log("SIGNUP " + JSON.stringify(rec));
  return send(res, 200, { ok: true, position: null, stored: "log" });
}
