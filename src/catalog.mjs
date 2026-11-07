/**
 * SPL:ACN catalog normalization — one item list whatever the envelope.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * The live server answers MCP content blocks: result.content[0].text is
 * a JSON STRING holding { products: [...] } with amount_usd/amount_cents
 * pricing — while older shapes put SKU objects at the top level with a
 * numeric usd field. This module reads both (plus plans/skus/items
 * nests), so catalog, prices, and ask quotes work against the live
 * server, not just the canned demo. Pure: no network, no disk.
 */

const NESTS = ["products", "plans", "skus", "items", "listings"];

const PER_LABEL = {
  usd_per_gb: " /GB",
  usd_per_check: " /check",
  usd_per_fetch: " /fetch",
  usd_per_hour: " /hr",
};

/** Every SKU-like object in result, de-duplicated, live shape or legacy. */
export function catalogItems(result) {
  const found = [];
  const seen = new Set();
  const seenTexts = new Set();
  const push = (it) => {
    if (it && typeof it === "object" && !seen.has(it)) {
      seen.add(it);
      found.push(it);
    }
  };
  const walk = (v, depth) => {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v === "string") {
      const t = v.trim();
      // One parse per distinct string: the same content-block text is
      // reachable twice (content[] + generic walk) and re-parsing would
      // mint duplicate objects the identity set cannot catch.
      if (t.length > 1 && t.length < 200000 && (t[0] === "{" || t[0] === "[") && !seenTexts.has(t)) {
        seenTexts.add(t);
        try {
          walk(JSON.parse(t), depth + 1);
        } catch {
          /* not JSON — ignore */
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    if (typeof v === "object") {
      if (typeof v.sku === "string" || typeof v.name === "string") push(v);
      for (const k of NESTS) {
        if (Array.isArray(v[k])) v[k].forEach((x) => walk(x, depth + 1));
      }
      if (Array.isArray(v.content)) {
        v.content.forEach((x) => {
          if (x && typeof x.text === "string") walk(x.text, depth + 1);
        });
      }
      Object.values(v).forEach((x) => walk(x, depth + 1));
    }
  };
  walk(result, 0);
  return found;
}

/**
 * One price for an item, or null. Reads usd, amount_usd, amount_cents,
 * and usd_per_* — whichever the server sent.
 * Returns { amount, label } with label like "$200.00" or "$0.02 /GB".
 */
export function itemPrice(it) {
  if (!it || typeof it !== "object") return null;
  if (typeof it.usd === "number") return { amount: it.usd, label: "$" + it.usd };
  if (it.amount_usd !== undefined && it.amount_usd !== null && String(it.amount_usd).trim() !== "") {
    const n = Number(it.amount_usd);
    return { amount: Number.isFinite(n) ? n : 0, label: "$" + String(it.amount_usd).trim() };
  }
  if (typeof it.amount_cents === "number") {
    return { amount: it.amount_cents / 100, label: "$" + (it.amount_cents / 100).toFixed(2) };
  }
  for (const f of Object.keys(PER_LABEL)) {
    if (typeof it[f] === "number") return { amount: it[f], label: "$" + it[f] + PER_LABEL[f] };
  }
  return null;
}

/** Items whose sku/name/id contains q (case-insensitive). */
export function matchItems(items, q) {
  const needle = String(q || "").toLowerCase();
  if (!needle) return items.slice();
  return items.filter((it) =>
    [it.sku, it.name, it.id].some(
      (f) => typeof f === "string" && f.toLowerCase().includes(needle),
    ),
  );
}
