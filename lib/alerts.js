// The alert engine. Called by /api/cron (GitHub Actions every 15 min + Vercel's daily cron as backup).
// Triggers:
//   r1h     — reminder ~1 hour before a dated drop you watch (fires when it's 0–70 min out)
//   am      — morning-of reminder (from 8am in your time zone, on the drop's day, while it's still 70+ min out)
//   restock — a console tracker flips to in stock at a store that was out on the previous run
//   new     — a brand-new dated drop shows up in a tab (category) you watch
//   link    — a link you asked us to watch flips from sold out / not live to live
// Dedupe: every (subscriber, channel, alert) is claimed with SET NX before sending and kept 60 days, so the
// same alert never goes out twice, even if two cron runs overlap. Restock alerts also have a 6 h per-item cooldown.
// All of a subscriber's alerts from one run go out as ONE text / ONE email. Max 8 messages per person per day.
import { createHash } from "node:crypto";
import { redis, getJSON, setJSON, hasStore } from "./store.js";
import { allSubs, isOptedOut, migrateLegacy, CAT_LABEL } from "./subs.js";
import { checkUrl } from "./check.js";
import { liveSender } from "./senders.js";

const MIN = 60000, H = 60 * MIN;
const SENT_TTL = 60 * 24 * 3600, DAILY_CAP = 8, RESTOCK_COOLDOWN = 6 * 3600, MAX_LINKS = 25;
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function parts(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export function fmtWhen(ms, tz, withDay = true) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
}
const inStockStores = (d) => (d.status === "in_stock" ? String(d.store || "").split(" · ").map((s) => s.trim()).filter(Boolean) : []);

// ---------- 1) world events since the last run (shared by everyone) ----------
async function worldEvents(drops, now, subs, { dry }) {
  const dated = drops.filter((d) => !d.restock && d.at && Date.parse(d.at) > now);
  // new drops
  const initialized = !!(await redis("GET", "seen:init"));
  const seen = new Set((await redis("SMEMBERS", "seen:ids")) || []);
  const fresh = initialized ? dated.filter((d) => !seen.has(d.id)) : [];
  if (!dry) {
    const ids = dated.map((d) => d.id).filter((id) => !seen.has(id));
    for (let i = 0; i < ids.length; i += 200) await redis("SADD", "seen:ids", ...ids.slice(i, i + 200));
    if (!initialized) await redis("SET", "seen:init", new Date(now).toISOString());
  }
  // restock flips (per store)
  const flips = [];
  for (const d of drops.filter((x) => x.restock)) {
    const cur = inStockStores(d);
    const prev = await getJSON("stock:" + d.id);
    const added = prev ? cur.filter((s) => !prev.stores.includes(s)) : [];
    if (added.length) flips.push({ drop: d, stores: added });
    if (!dry) await setJSON("stock:" + d.id, { stores: cur, status: d.status, at: new Date(now).toISOString() }, 30 * 24 * 3600);
  }
  // watched links (link checker "text me when it flips")
  const urls = [...new Set(subs.flatMap((s) => s.links || []))].slice(0, MAX_LINKS);
  const live = [];
  const checks = await Promise.allSettled(urls.map((u) => checkUrl(u)));
  for (let i = 0; i < urls.length; i++) {
    const r = checks[i].status === "fulfilled" ? checks[i].value[1] : null;
    if (!r || !["live", "sold_out", "not_live"].includes(r.verdict)) continue; // unknown / blocked: keep the old state
    const key = "link:" + hash(urls[i]);
    const prev = await getJSON(key);
    if (prev && prev.verdict !== "live" && r.verdict === "live") live.push({ url: urls[i], title: r.title || urls[i] });
    if (!dry) await setJSON(key, { verdict: r.verdict, at: new Date(now).toISOString() }, 30 * 24 * 3600);
  }
  return { fresh, flips, live, initialized };
}

// ---------- 2) what each subscriber should hear ----------
export function itemsFor(sub, drops, ev, now) {
  const tz = sub.tz || "America/New_York";
  const watchIds = new Set((sub.drops || []).map((d) => d.id));
  const cats = new Set(sub.cats || []);
  const watchNames = new Set((sub.drops || []).map((d) => String(d.name || "").toLowerCase()).filter(Boolean));
  const watched = (d) => watchIds.has(d.id) || watchNames.has(String(d.name || "").toLowerCase()); // name too: curated ids can shift
  const watches = (d) => watched(d) || (d.tags || [d.kind]).some((t) => cats.has(t));
  const out = [];
  const today = parts(now, tz);
  for (const d of drops) {
    if (d.restock || !d.at || !watches(d)) continue;
    const at = Date.parse(d.at), mins = (at - now) / MIN, est = /est/i.test(d.time_note || "") ? "est. " : "";
    if (mins <= 0) continue;
    if (sub.remind?.before1h !== false && mins <= 70) out.push({ type: "r1h", key: `r1h:${d.id}:${d.at}`, drop: d, item: d.name, store: d.store, line: `1 HOUR: ${d.name} · ${est}${fmtWhen(at, tz, false)} · ${d.store}`, url: d.shop });
    else if (sub.remind?.morning !== false && today.hour >= 8 && parts(at, tz).date === today.date && mins > 70)
      out.push({ type: "am", key: `am:${d.id}:${d.at}`, drop: d, line: `TODAY: ${d.name} · ${est}${fmtWhen(at, tz, false)} · ${d.store}`, url: d.shop });
  }
  for (const d of ev.fresh) if ((d.tags || [d.kind]).some((t) => cats.has(t)))
    out.push({ type: "new", key: `new:${d.id}`, drop: d, line: `NEW ${(CAT_LABEL[d.kind] || d.kind).toUpperCase()} DROP: ${d.name} · ${fmtWhen(Date.parse(d.at), tz)} · ${d.store}`, url: d.shop });
  for (const f of ev.flips) if (watched(f.drop) || cats.has("games"))
    out.push({ type: "restock", key: `restock:${f.drop.id}:${[...f.stores].sort().join("+")}:${new Date(now).toISOString().slice(0, 13)}`, cool: `cool:${sub.id}:${f.drop.id}`, drop: f.drop, item: f.drop.name, stores: f.stores.join(", "), line: `RESTOCK: ${f.drop.name} in stock at ${f.stores.join(", ")}${f.drop.price && f.drop.price !== "—" ? " · " + f.drop.price : ""}`, url: f.drop.shop });
  for (const l of ev.live) if ((sub.links || []).includes(l.url))
    out.push({ type: "link", key: `link:${hash(l.url)}:${new Date(now).toISOString().slice(0, 13)}`, line: `LIVE NOW: ${l.title.slice(0, 80)}`, url: l.url });
  const order = { restock: 0, r1h: 1, link: 2, am: 3, new: 4 };
  return out.sort((a, b) => order[a.type] - order[b.type]);
}

// ---------- 3) message text ----------
// Short links for texts: <site>/go/<code> -> 302 to the store page (api/go.js). Keeps a text near 160 chars.
export async function shortLink(url, site) {
  if (!url) return null;
  const c = hash(url).slice(0, 8);
  try { await redis("SET", "go:" + c, url, "EX", 90 * 24 * 3600); } catch { return url; }
  return `${site || "https://dropwatch-livid.vercel.app"}/go/${c}`;
}
const STOP = "\nReply STOP to opt out";
// Single-alert texts use the team's copy (Tomo). Name is trimmed so the text stays within 160 characters when it can.
export function smsSingle(it) {
  if (it.type !== "r1h" && it.type !== "restock") return null;
  const build = (n, link, stores) => (it.type === "r1h"
    ? `⚡ drop alert: ${n} drops in 1 hour on ${it.store}! be ready: ${link}`
    : `🚨 restock live: ${n} is back in stock right now at ${stores}! grab it fast: ${link}`) + STOP;
  const trimName = (name, over) => {
    if (over <= 0) return name;
    let cut = name.slice(0, Math.max(18, name.length - over - 1));
    if (cut.lastIndexOf(" ") >= 10) cut = cut.slice(0, cut.lastIndexOf(" ")); // trim at a word
    return cut.replace(/[\s:,·/-]+$/, "") + "…";
  };
  // shorten step by step until it fits 160: bare link (no https://) → trimmed item name → first store "+N"
  let link = it.short || it.url || "", stores = it.stores || "";
  const storeList = stores.split(", ");
  const tries = [[link, stores], [link.replace(/^https:\/\//, ""), stores], [link.replace(/^https:\/\//, ""), storeList.length > 1 ? `${storeList[0]} +${storeList.length - 1}` : stores]];
  let out = "";
  for (const [l, st] of tries) { out = build(it.item, l, st); if (out.length <= 160) return out; } // full name first
  for (const [l, st] of tries.slice(1)) {
    out = build(trimName(it.item, build(it.item, l, st).length - 160), l, st);
    if (out.length <= 160) return out;
  }
  return out;
}
export function compose(items, sub, siteUrl) {
  const site = siteUrl || "https://dropwatch-livid.vercel.app";
  const unsub = `${site}/api/unsubscribe?id=${sub.id}&t=${sub.token}`;
  const top = items.slice(0, 5), more = items.length - top.length;
  const linkEach = top.length <= 2;
  const smsLines = top.map((i) => i.line + (linkEach && (i.short || i.url) ? ` ${i.short || i.url}` : ""));
  if (more > 0) smsLines.push(`+${more} more`);
  const sms = (items.length === 1 && smsSingle(items[0])) || `dropwatch\n${smsLines.join("\n")}\n${linkEach ? "" : site + "\n"}Reply STOP to opt out`;
  const subject = items.length === 1 ? items[0].line.slice(0, 110) : `${items.length} drop alerts: ${items[0].line.slice(0, 80)}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const text = items.map((i) => `${i.line}${i.url ? "\n" + i.url : ""}`).join("\n\n") + `\n\nAll drops: ${site}\nUnsubscribe: ${unsub}`;
  const html = `<div style="font-family:system-ui,sans-serif;background:#0b0c0e;color:#f2f3f5;padding:20px;border-radius:12px">
<div style="color:#c6ff3d;font-weight:800;font-size:18px;margin-bottom:12px">dropwatch</div>
${items.map((i) => `<p style="margin:0 0 14px">${esc(i.line)}${i.url ? `<br><a style="color:#c6ff3d" href="${esc(i.url)}">open</a>` : ""}</p>`).join("")}
<p style="margin-top:18px;font-size:12px;color:#9aa0a6"><a style="color:#9aa0a6" href="${esc(site)}">all drops</a> · <a style="color:#9aa0a6" href="${esc(unsub + "&ch=email")}">unsubscribe</a></p></div>`;
  return { sms, subject, text, html, unsub: unsub + "&ch=email" };
}

// ---------- 4) the run ----------
export async function runAlerts({ drops, now = Date.now(), sender = liveSender, siteUrl, dry = false } = {}) {
  if (!hasStore()) return { active: false, reason: "no storage connected (connect Upstash Redis in Vercel → Storage)", sent: 0 };
  if (!dry && !(await redis("SET", "lock:alerts", String(now), "NX", "EX", 120))) return { active: true, skipped: "another run is in progress", sent: 0 };
  try {
    const migrated = dry ? 0 : await migrateLegacy(drops);
    const subs = (await allSubs()).filter((s) => !s.removed_at);
    const ev = await worldEvents(drops, now, subs, { dry });
    const report = { active: true, dry, subscribers: subs.length, migrated_v2_signups: migrated, baseline_run: !ev.initialized,
      events: { new_drops: ev.fresh.map((d) => d.name), restock_flips: ev.flips.map((f) => `${f.drop.name} @ ${f.stores.join(", ")}`), links_live: ev.live.map((l) => l.url) },
      messages: [], sent: 0, errors: [] };
    for (const sub of subs) {
      const all = itemsFor(sub, drops, ev, now);
      if (!all.length) continue;
      const channels = [];
      if (sub.phone && !(await isOptedOut("sms", sub.phone))) channels.push(["sms", sub.phone]);
      if (sub.email && !(await isOptedOut("email", sub.email))) channels.push(["email", sub.email]);
      const day = parts(now, sub.tz || "America/New_York").date;
      for (const [ch, to] of channels) {
        // dedupe: drop anything this person already got on this channel (or is cooling down)
        const items = [];
        for (const it of all) {
          const k = `sent:${sub.id}:${ch}:${it.key}`;
          if (dry) { if (!(await redis("EXISTS", k)) && !(it.cool && (await redis("EXISTS", it.cool + ":" + ch)))) items.push(it); continue; }
          if (it.cool && (await redis("EXISTS", it.cool + ":" + ch))) continue;
          if (await redis("SET", k, String(now), "NX", "EX", SENT_TTL)) items.push({ ...it, claim: k });
        }
        if (!items.length) continue;
        if (ch === "sms") for (const it of items) it.short = await shortLink(it.url, siteUrl);
        const msg = compose(items, sub, siteUrl);
        const entry = { sub: sub.id, channel: ch, to: mask(to), alerts: items.map((i) => i.type + " · " + (i.drop?.name || i.url)), body: ch === "sms" ? msg.sms : msg.subject };
        if (dry) { report.messages.push(entry); continue; }
        const capKey = `cap:${sub.id}:${ch}:${day}`;
        let r;
        if (Number((await redis("GET", capKey)) || 0) >= DAILY_CAP) r = { ok: false, skipped: "daily cap reached" };
        else r = ch === "sms" ? await sender.sms(to, msg.sms) : await sender.email(to, msg.subject, msg.text, msg.html, msg.unsub);
        if (r && r.ok) {
          report.sent++;
          await redis("INCR", capKey); await redis("EXPIRE", capKey, 2 * 24 * 3600);
          for (const it of items) if (it.cool) await redis("SET", it.cool + ":" + ch, "1", "EX", RESTOCK_COOLDOWN);
        } else {
          // not delivered (sender off, error, cap) -> release the claims so a later run can retry
          for (const it of items) await redis("DEL", it.claim);
          if (r && r.error) report.errors.push(`${ch} ${mask(to)}: ${r.error}`);
        }
        report.messages.push({ ...entry, result: r && r.ok ? "sent" : (r && (r.skipped || r.error)) || "failed" });
      }
    }
    if (!dry) await setJSON("alerts:last_run", { at: new Date(now).toISOString(), sent: report.sent, subscribers: subs.length, events: report.events, errors: report.errors.slice(0, 10) });
    return report;
  } finally {
    if (!dry) await redis("DEL", "lock:alerts");
  }
}

export const mask = (s) => (String(s).includes("@") ? String(s).replace(/^(.).*(@.*)$/, "$1***$2") : String(s).replace(/\d(?=\d{4})/g, "•"));
