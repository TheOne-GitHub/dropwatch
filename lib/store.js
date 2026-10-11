// Optional persistence. Works with zero setup (returns null / logs), and upgrades automatically when an
// Upstash Redis store is connected in Vercel (Storage tab -> Upstash for Redis -> Connect), which injects
// KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const hasStore = () => !!(URL_() && TOK());
export async function redis(...cmd) {
  if (!hasStore()) return null;
  const r = await fetch(URL_(), { method: "POST", headers: { authorization: `Bearer ${TOK()}`, "content-type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(5000) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}
export async function getJSON(key) { const v = await redis("GET", key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, val) { return redis("SET", key, JSON.stringify(val)); }
