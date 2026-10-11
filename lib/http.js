// tiny helpers so handlers work on Vercel's Node runtime and in the local dev server
export function send(res, status, obj, cache = "no-store") {
  res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", cache);
  res.end(JSON.stringify(obj));
}
export function query(req) { return new URL(req.url, "http://x").searchParams; }
export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); } catch { return null; }
}
