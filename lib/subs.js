// Subscribers: who watches what, and how to reach them. All state lives in Redis (lib/store.js).
//   sub:<id>            JSON { id, ntfy, phone, email, cats[], drops[{id,name,url,at}], links[], remind{before1h,morning}, tz, token, created_at }
//   subs                set of subscriber ids
//   contact:<contact>   -> sub id (one record per phone / per email; signing up again merges what you watch)
//   optout:sms:<+1...>  / optout:email:<addr> / optout:ntfy:<topic>  -> set when someone texts STOP, unsubscribes, or Twilio reports an opt-out
//   sub.ntfy            the subscriber's private ntfy push topic (contact:ntfy:<topic> -> sub id)
import { redis, getJSON, setJSON, hasStore } from "./store.js";
import { randomBytes } from "node:crypto";

export const CATS = ["kicks", "ye", "street", "collect", "games", "tix"];
export const CAT_LABEL = { kicks: "Sneakers", ye: "Yeezy", street: "Supreme", collect: "Collectibles", games: "Consoles", tix: "Tickets" };

export function normPhone(s) {
  const raw = String(s || "").trim(); if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && d.length >= 10 && d.length <= 15) return "+" + d;
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (d.length >= 11 && d.length <= 15) return "+" + d;
  return null;
}
export function normEmail(s) {
  const e = String(s || "").trim().toLowerCase().slice(0, 120);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}
// A push topic is the subscriber's private channel: anyone who knows it can read it, so it must be long and random.
export const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{12,64}$/;
export function normTopic(t) {
  const s = String(t || "").trim().replace(/^(https?:\/\/)?ntfy\.sh\//i, "");
  return NTFY_TOPIC_RE.test(s) ? s : null;
}
export const newTopic = () => "dropwatch-" + randomBytes(9).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").slice(0, 12).toLowerCase();
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);

export async function getSub(id) { return id ? getJSON("sub:" + id) : null; }
export async function allSubs() {
  const ids = (await redis("SMEMBERS", "subs")) || [];
  if (!ids.length) return [];
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) rows.push(...(((await redis("MGET", ...ids.slice(i, i + 100).map((x) => "sub:" + x))) || [])));
  return rows.filter(Boolean).map((r) => JSON.parse(r));
}

// Create or merge a subscription. input: { ntfy, phone, email, cats[], drop{id,name,url,at}, link, remind{before1h,morning}, tz }
export async function upsertSub(input) {
  const phone = normPhone(input.phone), email = normEmail(input.email), ntfy = normTopic(input.ntfy);
  if (!phone && !email && !ntfy) throw Object.assign(new Error("need a push topic, a phone number or an email"), { status: 422 });
  const cats = [...new Set((input.cats || []).filter((c) => CATS.includes(c)))];
  const drop = input.drop && input.drop.id ? { id: clean(input.drop.id, 200), name: clean(input.drop.name, 200), url: clean(input.drop.url, 500), at: clean(input.drop.at, 40) || null } : null;
  const link = /^https?:\/\//i.test(input.link || "") ? clean(input.link, 500) : null;
  if (!cats.length && !drop && !link) throw Object.assign(new Error("pick at least one tab or drop to watch"), { status: 422 });
  const remind = { before1h: input.remind?.before1h !== false, morning: input.remind?.morning !== false };
  let tz = clean(input.tz, 60) || "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "America/New_York"; }

  let id = (ntfy && (await redis("GET", "contact:ntfy:" + ntfy))) || (phone && (await redis("GET", "contact:" + phone))) || (email && (await redis("GET", "contact:" + email))) || null;
  let sub = id ? await getSub(id) : null;
  const isNew = !sub;
  if (!sub) { id = randomBytes(6).toString("hex"); sub = { id, ntfy: null, phone: null, email: null, cats: [], drops: [], links: [], token: randomBytes(12).toString("hex"), created_at: new Date().toISOString() }; }
  if (ntfy) sub.ntfy = ntfy;
  if (phone) sub.phone = phone;
  if (email) sub.email = email;
  sub.cats = [...new Set([...(sub.cats || []), ...cats])];
  if (drop && !sub.drops.some((d) => d.id === drop.id)) sub.drops = [...sub.drops, drop].slice(-40);
  if (link && !(sub.links || []).includes(link)) sub.links = [...(sub.links || []), link].slice(-10);
  sub.remind = remind; sub.tz = tz; sub.updated_at = new Date().toISOString();
  delete sub.removed_at; // signing up again after "unsubscribe from everything" turns alerts back on
  await setJSON("sub:" + id, sub);
  await redis("SADD", "subs", id);
  if (phone) { await redis("SET", "contact:" + phone, id); await redis("DEL", "optout:sms:" + phone); } // signing up again = opting back in
  if (email) { await redis("SET", "contact:" + email, id); await redis("DEL", "optout:email:" + email); }
  if (ntfy) { await redis("SET", "contact:ntfy:" + ntfy, id); await redis("DEL", "optout:ntfy:" + ntfy); }
  return { sub, isNew };
}

export async function optOut(channel, address) {
  if (!address) return;
  await redis("SET", `optout:${channel}:${address}`, new Date().toISOString());
}
export async function isOptedOut(channel, address) { return !!(address && (await redis("EXISTS", `optout:${channel}:${address}`))); }

// Unsubscribe by link: ch = email | sms | ntfy | all
export async function unsubscribe(id, token, ch = "all") {
  const sub = await getSub(id);
  if (!sub || !token || sub.token !== token) return null;
  if ((ch === "email" || ch === "all") && sub.email) await optOut("email", sub.email);
  if ((ch === "sms" || ch === "all") && sub.phone) await optOut("sms", sub.phone);
  if ((ch === "ntfy" || ch === "all") && sub.ntfy) await optOut("ntfy", sub.ntfy);
  if (ch === "all") { await redis("SREM", "subs", id); sub.removed_at = new Date().toISOString(); await setJSON("sub:" + id, sub); }
  return sub;
}

// Unsubscribe a push topic by the topic itself (the topic is the secret: whoever holds it already reads the alerts).
export async function unsubscribeTopic(topic) {
  const t = normTopic(topic);
  if (!t) return null;
  const id = await redis("GET", "contact:ntfy:" + t);
  await optOut("ntfy", t);
  return id ? (await getSub(id)) || { id } : { id: null };
}

// v2 signups (list "signups": {contact, drop, url}) are folded into v3 subscribers once each.
export async function migrateLegacy(drops) {
  if (!hasStore()) return 0;
  const rows = (await redis("LRANGE", "signups", 0, -1)) || [];
  let n = 0;
  for (const r of rows) {
    let rec; try { rec = JSON.parse(r); } catch { continue; }
    if (rec.v3 || !rec.id) continue;
    if (!(await redis("SET", "migrated:" + rec.id, "1", "NX"))) continue;
    const name = (rec.drop || "").toLowerCase();
    const d = name && drops.find((x) => x.name.toLowerCase() === name);
    const c = String(rec.contact || "");
    try {
      await upsertSub({ phone: c.includes("@") ? null : c, email: c.includes("@") ? c : null, cats: d ? [] : [], drop: d ? { id: d.id, name: d.name, url: d.shop, at: d.at } : null, link: d ? null : rec.url || null });
      n++;
    } catch { /* v2 row with nothing watchable (no drop matched, no url) — skipped */ }
  }
  return n;
}
