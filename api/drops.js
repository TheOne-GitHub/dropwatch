// GET /api/drops — the board. Fresh data at most every 30 min:
//  1) if a Redis store is connected and its snapshot is < 30 min old, serve it;
//  2) otherwise scrape all sources live (≈2 s), save to Redis if connected;
//  3) if scraping fails entirely, fall back to the last snapshot, then the bundled data/seed.json.
// Vercel's CDN caches the response for 30 min (s-maxage) and serves stale while it refreshes in the background.
import { scrapeAll } from "../lib/scrape.js";
import { getJSON, setJSON, hasStore } from "../lib/store.js";
import { send } from "../lib/http.js";
import SEED from "../data/seed.js";

const FRESH_MS = 30 * 60 * 1000;
const CACHE = "public, max-age=60, s-maxage=1800, stale-while-revalidate=86400";

export async function freshDrops({ force = false } = {}) {
  let snap = null;
  try { snap = await getJSON("drops:latest"); } catch {}
  if (!force && snap && Date.now() - Date.parse(snap.updated_at) < FRESH_MS) return { ...snap, served_from: "store" };
  try {
    const live = await scrapeAll(Date.now(), snap || SEED);
    const okSources = Object.values(live.sources).filter((s) => s.ok).length;
    if (okSources >= 2 && live.total > 0) { try { if (hasStore()) await setJSON("drops:latest", live); } catch {} return { ...live, served_from: "live" }; }
    throw new Error("too few sources answered");
  } catch (e) {
    if (snap) return { ...snap, served_from: "store_stale", note: String(e.message || e) };
    return { ...SEED, served_from: "seed", note: String(e.message || e) };
  }
}

export default async function handler(req, res) {
  const data = await freshDrops();
  send(res, 200, data, data.served_from === "seed" ? "public, s-maxage=300" : CACHE);
}
