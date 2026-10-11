// GET /api/check?url=... — live link check
import { checkUrl } from "../lib/check.js";
import { send, query } from "../lib/http.js";
export default async function handler(req, res) {
  const [status, obj] = await checkUrl(query(req).get("url") || "");
  send(res, status, obj);
}
