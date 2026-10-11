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

// public base URL of this deployment, for links inside alerts
export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = req && (req.headers["x-forwarded-host"] || req.headers.host);
  return host ? `${/^localhost|^127\./.test(host) ? "http" : "https"}://${host}` : "https://dropwatch-livid.vercel.app";
}
export function html(res, status, title, inner) {
  res.statusCode = status; res.setHeader("content-type", "text/html; charset=utf-8"); res.setHeader("cache-control", "no-store");
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — dropwatch</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0e;color:#f2f3f5;font:16px/1.5 system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:420px}h1{color:#c6ff3d;font-size:22px}a,button{color:#0b0c0e;background:#c6ff3d;border:0;border-radius:10px;padding:10px 16px;font:inherit;font-weight:700;text-decoration:none;display:inline-block;cursor:pointer}</style></head><body><main><h1>${title}</h1>${inner}</main></body></html>`);
}
