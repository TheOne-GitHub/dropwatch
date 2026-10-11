// dropwatch scrapers. Every item comes from a page fetched at run time; nothing is invented.
// Sources: Nice Kicks release calendar (sneakers, Ye, streetwear collabs), drops.gg (Supreme weekly droplist),
// pokemon.com monthly TCG release post + lego.com Coming Soon (collectibles), nowinstock.net trackers (console restocks),
// plus a short hand-verified list in lib/curated.js (ticket on-sales, Yeezy slide restock, Zelda Switch 2 launch).
import { CURATED } from "./curated.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MON3 = MONTHS.map((m) => m.slice(0, 3));

async function get(url, ms = 12000) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.text();
}
export function decode(s = "") {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
// "October 15, 2026" -> ISO at 10:00 America/New_York (EDT/EST by date)
function etISO(dateStr, hour = 10, minute = 0) {
  const m = String(dateStr).toLowerCase().match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  let mi = MONTHS.indexOf(m[1]); if (mi < 0) mi = MON3.indexOf(m[1].slice(0, 3)); if (mi < 0) return null;
  const y = +m[3], d = +m[2];
  const dst = isDST(y, mi, d);
  const off = dst ? "-04:00" : "-05:00";
  return `${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`;
}
function isDST(y, mi, d) { // US rules: 2nd Sun of March .. 1st Sun of Nov
  const nth = (month, n) => { const f = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - f) % 7) + 7 * (n - 1); };
  const start = nth(2, 2), end = nth(10, 1);
  if (mi > 2 && mi < 10) return true; if (mi < 2 || mi > 10) return false;
  return mi === 2 ? d >= start : d < end;
}

const YE = /\b(yeezy|yzy|kanye|ye\b)/i;
const STREET = /\b(supreme|palace|st[uü]ssy|kith|bape|a bathing ape|fear of god|essentials|corteiz|sp5der|aim[eé] leon dor[eé]|union|undefeated|fragment|travis scott|cactus jack|off-white|nigo|human made|denim tears|stone island)\b/i;

// ---------- Nice Kicks release calendar ----------
export function parseNiceKicks(html, sourcePage) {
  const out = [];
  const blocks = html.split('<div class="release-date__wrapper">').slice(1);
  for (const b of blocks) {
    const link = (b.match(/release-date__title"><a href="([^"]+)"/) || [])[1];
    const name = decode((b.match(/<h2[^>]*class="wp-block-heading">([\s\S]*?)<\/h2>/) || [])[1] || (b.match(/release-date__title"><a [^>]+>([\s\S]*?)<\/a>/) || [])[1] || "");
    const date = decode((b.match(/Release Date:<\/strong>\s*([^<]*)/) || [])[1] || "");
    const price = decode((b.match(/Price:<\/strong>\s*([^<]*)/) || [])[1] || "");
    const style = decode((b.match(/Style #:<\/strong>\s*([^<]*)/) || [])[1] || "");
    const img = (b.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    const at = etISO(date);
    if (!name || !at) continue;
    const tags = ["kicks"];
    if (YE.test(name)) tags.push("ye");
    if (STREET.test(name)) tags.push("street");
    out.push({ id: "nk:" + (style || name), kind: tags.includes("ye") ? "ye" : "kicks", tags, name, at, time_note: "est. 10 AM ET", price: (price || "TBA").replace(/^\$\s*TBA/i, "TBA"),
      store: /jordan|nike/i.test(name) ? "SNKRS / Nike" : "brand + retailers", shop: link, source: link || sourcePage, img: img ? img.replace(/(\.\w+)$/, "-400x267$1") : null, img_full: img, style: style || null });
  }
  return out;
}
async function niceKicks() {
  const pages = ["https://www.nicekicks.com/sneaker-release-dates/", "https://www.nicekicks.com/sneaker-release-dates/page/2/"];
  const res = await Promise.allSettled(pages.map((u) => get(u)));
  const items = []; const seen = new Set();
  res.forEach((r, i) => { if (r.status === "fulfilled") for (const it of parseNiceKicks(r.value, pages[i])) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } });
  if (!items.length) throw new Error("nicekicks: no items parsed");
  return items;
}

// ---------- drops.gg: Supreme weekly droplist ----------
export function parseDropsWeek(html) {
  const items = [];
  const top = html.split("self.__next_f")[0];
  const re = /<img[^>]+src="(https:\/\/media\.drops\.gg\/[^"]+)"[\s\S]*?\$<!-- -->?\s*([\d,]+)|<img[^>]+src="(https:\/\/media\.drops\.gg\/[^"]+)"/g;
  // Robust path: walk text: each item = image, then "$", price, name
  const chunks = top.split(/<img[^>]+src="https:\/\/media\.drops\.gg\//).slice(1);
  for (const c of chunks) {
    const img = "https://media.drops.gg/" + c.slice(0, c.indexOf('"'));
    const text = decode(c.slice(c.indexOf(">") + 1).split(/<img/)[0].replace(/<[^>]+>/g, " | "));
    const m = text.match(/\$\s*\|?\s*([\d,]+)(?:\s*\|)*\s*([^|]{3,90})/);
    if (m) items.push({ name: m[2].trim(), price: "$" + m[1], img });
    else { const n = text.split("|").map((s) => s.trim()).filter((s) => s.length > 3 && !/^\d+$/.test(s))[0]; if (n) items.push({ name: n, price: "TBA", img }); }
  }
  return items;
}
async function supreme() {
  const home = await get("https://www.drops.gg/");
  const t = decode(home.split("self.__next_f")[0].replace(/<[^>]+>/g, " "));
  const m = t.match(/Supreme\s+Week\s+(\d+)\s*\((\d{1,2})\/(\d{1,2})\/(\d{4})\)/i);
  const href = (home.match(/href="(\/[a-z]{2}\d{2}\/week-\d+)"/i) || [])[1];
  if (!m || !href) throw new Error("drops.gg: no current week found");
  const [, wk, mo, da, yr] = m;
  const at = etISO(`${MONTHS[+mo - 1]} ${da}, ${yr}`, 11, 0);
  const weekUrl = "https://www.drops.gg" + href;
  let items = [];
  try { items = parseDropsWeek(await get(weekUrl)); } catch {}
  const season = (href.match(/\/([a-z]{2}\d{2})\//i) || [])[1].toUpperCase();
  const top = items.slice(0, 6);
  return [{ id: `sup:${season}:${wk}`, kind: "street", tags: ["street"], name: `Supreme ${season} Week ${wk} drop`, at, time_note: "11 AM ET (Supreme's usual Thursday time)",
    price: top.length ? `${items.length} items · from ${items.map((i) => i.price).filter((p) => /\d/.test(p)).sort((a, b) => parseInt(a.slice(1).replace(",", "")) - parseInt(b.slice(1).replace(",", "")))[0] || "TBA"}` : "droplist not posted yet",
    store: "supreme.com + stores", shop: "https://us.supreme.com/", source: weekUrl, img: top[0] ? top[0].img : null,
    pre: top.length ? "Highlights: " + top.map((i) => `${i.name} (${i.price})`).join(" · ") : "drops.gg posts the full droplist a day or two before; this card fills in automatically when it does." }];
}

// ---------- pokemon.com: monthly TCG product release post ----------
export function parsePokemon(html, source) {
  const out = []; const seen = new Set();
  const re = /<h[23][^>]*>((?:(?!<\/h[23]>)[\s\S]){3,200}?)<\/h[23]>\s*(?:<p>)?\s*(?:<img[^>]+src="([^"]+)")?[\s\S]{0,400}?Available:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/g; let m;
  while ((m = re.exec(html))) {
    const name = decode(m[1]); const at = etISO(m[3], 9, 0);
    if (!at || !/pok[eé]mon/i.test(name) || seen.has(name)) continue; seen.add(name);
    out.push({ id: "pk:" + name, kind: "collect", tags: ["collect"], name, at, time_note: "release day (stores open)", price: "MSRP at retailers", store: "Pokémon Center + retailers",
      shop: "https://www.pokemoncenter.com/category/trading-card-game", source, img: m[2] || null, emoji: "🃏" });
  }
  return out;
}
async function pokemon(now) {
  const d = new Date(now); const urls = [];
  for (let k = 0; k < 2; k++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1));
    urls.push(`https://www.pokemon.com/us/news/check-out-every-pokemon-tcg-product-release-in-${MONTHS[x.getUTCMonth()]}-${x.getUTCFullYear()}`); }
  const res = await Promise.allSettled(urls.map((u) => get(u)));
  const out = []; res.forEach((r, i) => { if (r.status === "fulfilled") out.push(...parsePokemon(r.value, urls[i])); });
  if (!out.length) throw new Error("pokemon: none parsed");
  return out;
}

// ---------- lego.com Coming Soon ----------
export function parseLego(html, source) {
  const out = [];
  const variants = {};
  for (const m of html.matchAll(/"ProductVariant:(\d+)":\{([\s\S]{0,2500}?)"availabilityText":"([^"]*)"/g)) variants[m[1]] = { text: m[3] };
  for (const m of html.matchAll(/"ProductVariant:(\d+)":\{[\s\S]{0,4000}?"formattedAmount":"([^"]+)"/g)) if (variants[m[1]] && !variants[m[1]].price) variants[m[1]].price = m[2];
  for (const m of html.matchAll(/"SingleVariantProduct:(\d+)":\{([\s\S]{0,2500}?)"variant":\{"__ref":"ProductVariant:(\d+)"\}/g)) {
    const body = m[2]; const v = variants[m[3]]; if (!v) continue;
    const dm = v.text.match(/Coming soon on ([A-Z][a-z]+ \d{1,2}, \d{4})/); if (!dm) continue;
    const name = decode(JSON.parse('"' + ((body.match(/"name":"((?:[^"\\]|\\.)*)"/) || [])[1] || "") + '"'));
    const theme = ((body.match(/"brandCategory":\{"__typename":"Category","name":"([^"]+)"/) || [])[1]) || "";
    const path = (body.match(/"pdpPath":"([^"]+)"/) || [])[1];
    const img0 = ((body.match(/"primaryImage\(\{\\"size\\":\\"THUMBNAIL\\"\}\)":"([^"]+)"/) || [])[1] || "").replace(/\\u0026/g, "&") || null;
    const img = img0 && !/\/assets\/\?/.test(img0) ? img0 : null;
    out.push({ id: "lego:" + m[1], kind: "collect", tags: ["collect"], name: legoName(theme, name, m[1]), at: etISO(dm[1], 0, 1), time_note: "launch day on LEGO.com",
      price: v.price || "TBA", store: "LEGO.com", shop: path ? "https://www.lego.com" + path : source, source, img });
  }
  return out;
}
function legoName(theme, name, code) { const th = theme.replace(/®|™/g, "").replace(/^LEGO\s*/i, "").trim(); return `LEGO ${th ? th + " " : ""}${name} (${code})`.replace(/\s+/g, " "); }
async function lego() { const u = "https://www.lego.com/en-us/categories/coming-soon"; const o = parseLego(await get(u, 15000), u); if (!o.length) throw new Error("lego: none parsed"); return o; }

// ---------- nowinstock.net console trackers (live restock status) ----------
export function parseNowInStock(html, source, label, family) {
  const rows = [];
  for (const m of html.matchAll(/<tr id="tr\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const r = m[1];
    const a = r.match(/<td><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/); if (!a) continue;
    const status = decode((r.match(/class="stockStatus\w*"><a[^>]*>([^<]+)</) || [])[1] || "");
    let price = decode((r.match(/trackerPrice[^"]*">([^<]*)</) || [])[1] || ""); if (!/\d/.test(price)) price = "";
    const last = (r.match(/title="In Stock: ([^"]+)"/) || [])[1] || "";
    let url = decode(a[1]); try { const u = new URL(url); url = u.searchParams.get("murl") || u.searchParams.get("url") || url; } catch {}
    const [prod, store] = decode(a[2]).split(/\s+:\s+/);
    rows.push({ product: prod, store: store || "", status, price, last, url });
  }
  const byProd = {};
  for (const r of rows) (byProd[r.product] ||= []).push(r);
  const out = [];
  for (const [prod, rs] of Object.entries(byProd)) {
    const inStock = rs.filter((r) => /in stock/i.test(r.status));
    const best = inStock.find((r) => r.price) || inStock[0] || rs.find((r) => r.price) || rs[0];
    out.push({ id: "nis:" + prod, kind: "games", tags: ["games"], name: (family === "ps5" && !/ps5|playstation/i.test(prod) ? "PS5 " : "") + prod, at: null, restock: true,
      status: inStock.length ? "in_stock" : "out", time_note: inStock.length ? `in stock at ${inStock.map((r) => r.store).join(", ")}` : `out everywhere tracked (${rs.length} stores)`,
      price: best.price || "—", store: inStock.length ? inStock.map((r) => r.store).join(" · ") : "restock watch", shop: best.url, source, img: null, emoji: label,
      pre: rs.slice(0, 6).map((r) => `${r.store}: ${r.status}${r.price ? " " + r.price : ""}`).join(" · "),
      last_in_stock: inStock.length ? null : (rs.map((r) => r.last).filter(Boolean)[0] || null) });
  }
  return out;
}
async function consoles() {
  const trackers = [["https://www.nowinstock.net/videogaming/consoles/nintendoswitch2/", "🎮"], ["https://www.nowinstock.net/videogaming/consoles/sonyps5/", "🎮", "ps5"]];
  const res = await Promise.allSettled(trackers.map(([u]) => get(u)));
  const out = []; res.forEach((r, i) => { if (r.status === "fulfilled") out.push(...parseNowInStock(r.value, trackers[i][0], trackers[i][1], trackers[i][2])); });
  if (!out.length) throw new Error("nowinstock: none parsed");
  return out;
}

// ---------- optional: Ticketmaster Discovery API (set TICKETMASTER_API_KEY) ----------
async function ticketmaster(now) {
  const key = process.env.TICKETMASTER_API_KEY; if (!key) return [];
  const start = new Date(now).toISOString().slice(0, 19) + "Z", end = new Date(now + 14 * 864e5).toISOString().slice(0, 19) + "Z";
  const u = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&classificationName=music&countryCode=US&onsaleStartDateTime=${start}&onsaleEndDateTime=${end}&sort=relevance,desc&size=40`;
  const j = JSON.parse(await get(u)); const seen = new Set(); const out = [];
  for (const e of (j._embedded && j._embedded.events) || []) {
    const att = (e._embedded && e._embedded.attractions && e._embedded.attractions[0] && e._embedded.attractions[0].name) || e.name;
    if (seen.has(att)) continue; seen.add(att);
    const on = e.sales && e.sales.public && e.sales.public.startDateTime; if (!on) continue;
    out.push({ id: "tm:" + e.id, kind: "tix", tags: ["tix"], name: e.name, at: on, time_note: "general on-sale", price: e.priceRanges ? `$${Math.round(e.priceRanges[0].min)}+` : "TBA",
      store: "Ticketmaster", shop: e.url, source: e.url, img: (e.images || []).find((i) => i.ratio === "16_9" && i.width < 800)?.url || null });
    if (out.length >= 12) break;
  }
  return out;
}

export const SOURCES = { niceKicks, supreme, pokemon, lego, consoles, ticketmaster };

const PREFIX = { niceKicks: "nk:", supreme: "sup:", pokemon: "pk:", lego: "lego:", ticketmaster: "tm:" }; // consoles: never carry stale stock status
// prev = last good snapshot; a source that fails this run keeps its last good dated items (marked carried) instead of vanishing.
export async function scrapeAll(now = Date.now(), prev = null) {
  const names = Object.keys(SOURCES);
  const results = await Promise.allSettled(names.map((n) => SOURCES[n](now)));
  const items = []; const report = {};
  results.forEach((r, i) => {
    if (r.status === "fulfilled") { items.push(...r.value); report[names[i]] = { ok: true, count: r.value.length }; }
    else {
      report[names[i]] = { ok: false, error: String(r.reason && r.reason.message || r.reason).slice(0, 200) };
      const pf = PREFIX[names[i]];
      if (pf && prev && prev.drops) { const kept = prev.drops.filter((d) => d.id && d.id.startsWith(pf)).map((d) => ({ ...d, carried: true })); items.push(...kept); report[names[i]].carried = kept.length; }
    }
  });
  for (const c of CURATED) items.push({ ...c, curated: true });
  // keep: restock trackers always; dated items from 6h ago through next 45 days
  const lo = now - 6 * 3600e3, hi = (d) => now + (d.kind === "collect" ? 90 : 45) * 864e5;
  const seen = new Set();
  const drops = items.filter((d) => d.restock || (d.at && Date.parse(d.at) > lo && Date.parse(d.at) < hi(d)))
    .filter((d) => (seen.has(d.id) ? false : seen.add(d.id)))
    .sort((a, b) => (a.restock ? 1 : 0) - (b.restock ? 1 : 0) || Date.parse(a.at) - Date.parse(b.at));
  const counts = {}; for (const d of drops) for (const t of d.tags || [d.kind]) counts[t] = (counts[t] || 0) + 1;
  return { updated_at: new Date(now).toISOString(), counts, total: drops.length, sources: report, drops };
}
