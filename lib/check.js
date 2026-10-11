// Link checker: fetches a public product/ticket page and reads its stock signals (schema.org availability, buy / sold-out / coming-soon text).
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd])/i;
function availability(html) {
  const out = [];
  const re = /"availability"\s*:\s*"(?:https?:\/\/schema\.org\/)?([A-Za-z]+)"/g; let m;
  while ((m = re.exec(html)) && out.length < 20) out.push(m[1]);
  const re2 = /itemprop=["']availability["'][^>]*(?:href|content)=["'](?:https?:\/\/schema\.org\/)?([A-Za-z]+)/gi;
  while ((m = re2.exec(html)) && out.length < 20) out.push(m[1]);
  return out;
}
function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function textOf(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").toLowerCase();
}
export function analyze(status, html) {
  const signals = [];
  const rawTitle = ((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1] || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim();
  const title = decode(rawTitle).slice(0, 160);
  if (status === 401 || status === 403 || status === 429 || /verify your identity|identity verified/i.test(title) || /cf-chl|captcha|access denied|are you a robot|px-captcha/i.test(html.slice(0, 20000)) && html.length < 60000) {
    signals.push(`The store answered ${status} and showed a bot wall, so it hides its stock from automated checks.`);
    return { verdict: "blocked", title, signals };
  }
  if (status >= 400) { signals.push(`Page answered HTTP ${status}.`); return { verdict: status === 404 ? "not_live" : "unknown", title, signals }; }
  const av = availability(html);
  const t = textOf(html);
  const has = (re) => re.test(t);
  const inStock = av.some((a) => /^(InStock|LimitedAvailability|OnlineOnly|InStoreOnly)$/i.test(a));
  const outStock = av.some((a) => /^(OutOfStock|SoldOut|Discontinued)$/i.test(a));
  const pre = av.some((a) => /^(PreOrder|PreSale|BackOrder)$/i.test(a));
  if (av.length) signals.push(`Store's stock tag says: ${[...new Set(av)].join(", ")}.`);
  if (inStock && outStock) signals.push("Some sizes/variants are in stock, some are gone.");
  const buy = has(/add to (bag|cart)|buy now|find tickets|buy tickets|get tickets|see tickets/);
  const sold = has(/sold out|out of stock|currently unavailable|no tickets available/);
  const soon = has(/coming soon|notify me|available (on|at) \w+|launching|drops? (on|at)|on sale (on |at )?(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|presale (starts|begins)|register for/);
  if (buy) signals.push("Found a buy button (Add to Bag / Buy / Find Tickets).");
  if (sold) signals.push("Found “sold out” / “out of stock” text.");
  if (soon) signals.push("Found “coming soon” / “notify me” / an upcoming on-sale date.");
  let verdict = "unknown";
  if (inStock) verdict = "live";
  else if (outStock && !pre) verdict = "sold_out";
  else if (pre) verdict = "not_live";
  else if (soon && !buy) verdict = "not_live";
  else if (sold && !buy) verdict = "sold_out";
  else if (buy) verdict = "live";
  if (verdict === "unknown") signals.push("No clear stock signal on the page — it may load stock with JavaScript after the page opens.");
  return { verdict, title, signals };
}
export async function checkUrl(u) {
  let url;
  try { url = new URL(u); } catch { return [422, { error: "bad_url", verdict: "unknown", signals: ["That isn't a valid link."] }]; }
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname) || !url.hostname.includes(".")) return [422, { error: "bad_url", verdict: "unknown", signals: ["Only public http(s) links can be checked."] }];
  const started = Date.now();
  try {
    const res = await fetch(url.toString(), { redirect: "follow", signal: AbortSignal.timeout(9000), headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" } });
    let html = "";
    const reader = res.body && res.body.getReader();
    if (reader) { const dec = new TextDecoder(); let n = 0;
      while (n < 1500000) { const { done, value } = await reader.read(); if (done) break; n += value.length; html += dec.decode(value, { stream: true }); }
      try { reader.cancel(); } catch {} }
    const a = analyze(res.status, html);
    return [200, { ...a, status: res.status, final_url: res.url, ms: Date.now() - started, checked_at: new Date().toISOString() }];
  } catch (e) {
    return [200, { verdict: "unknown", title: "", signals: [`Couldn't reach the page (${String((e && e.name) || e)}).`], checked_at: new Date().toISOString() }];
  }
}
