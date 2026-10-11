// Optional persistence. Works with zero setup (returns null / logs), and upgrades automatically when an
// Upstash Redis store is connected in Vercel (Storage tab -> Upstash for Redis -> Connect), which injects
// KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — both work).
// Tests / the local dry run can swap in an in-memory store with useMemoryStore().
const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
let MEM = null;
export const hasStore = () => !!MEM || !!(URL_() && TOK());
export const storeKind = () => (MEM ? "memory" : URL_() && TOK() ? "redis" : "none");

export function useMemoryStore() { MEM = { kv: new Map(), exp: new Map() }; return MEM; }
export function dropMemoryStore() { MEM = null; }

function memCmd(cmd) {
  const [op, ...a] = cmd.map((x) => (typeof x === "number" ? String(x) : x));
  const now = Date.now(), kv = MEM.kv;
  for (const [k, t] of MEM.exp) if (t <= now) { kv.delete(k); MEM.exp.delete(k); }
  const set = (k) => { let s = kv.get(k); if (!(s instanceof Set)) { s = new Set(); kv.set(k, s); } return s; };
  const list = (k) => { let l = kv.get(k); if (!Array.isArray(l)) { l = []; kv.set(k, l); } return l; };
  switch (op.toUpperCase()) {
    case "GET": { const v = kv.get(a[0]); return typeof v === "string" ? v : null; }
    case "SET": {
      const opts = a.slice(2).map((x) => x.toUpperCase());
      if (opts.includes("NX") && kv.has(a[0])) return null;
      kv.set(a[0], a[1]);
      const ex = opts.indexOf("EX"); if (ex >= 0) MEM.exp.set(a[0], now + Number(a.slice(2)[ex + 1]) * 1000); else MEM.exp.delete(a[0]);
      return "OK";
    }
    case "DEL": { let n = 0; for (const k of a) if (kv.delete(k)) n++; return n; }
    case "EXISTS": return a.filter((k) => kv.has(k)).length;
    case "INCR": { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
    case "EXPIRE": MEM.exp.set(a[0], now + Number(a[1]) * 1000); return 1;
    case "SADD": { const s = set(a[0]); let n = 0; for (const m of a.slice(1)) if (!s.has(m)) { s.add(m); n++; } return n; }
    case "SREM": { const s = set(a[0]); let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++; return n; }
    case "SMEMBERS": return [...set(a[0])];
    case "SISMEMBER": return set(a[0]).has(a[1]) ? 1 : 0;
    case "SCARD": return set(a[0]).size;
    case "RPUSH": { const l = list(a[0]); l.push(...a.slice(1)); return l.length; }
    case "LLEN": return list(a[0]).length;
    case "LRANGE": { const l = list(a[0]); const s = Number(a[1]), e = Number(a[2]); return l.slice(s, e < 0 ? l.length + e + 1 : e + 1); }
    case "MGET": return a.map((k) => (typeof kv.get(k) === "string" ? kv.get(k) : null));
    default: throw new Error("memory store: unsupported " + op);
  }
}

export async function redis(...cmd) {
  if (MEM) return memCmd(cmd);
  if (!hasStore()) return null;
  const r = await fetch(URL_(), { method: "POST", headers: { authorization: `Bearer ${TOK()}`, "content-type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(5000) });
  const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
}
export async function getJSON(key) { const v = await redis("GET", key); return v ? JSON.parse(v) : null; }
export async function setJSON(key, val, exSeconds) { return exSeconds ? redis("SET", key, JSON.stringify(val), "EX", exSeconds) : redis("SET", key, JSON.stringify(val)); }
