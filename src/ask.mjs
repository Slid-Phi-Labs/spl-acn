/**
 * spl-acn ask — plain-English front end for the code facets.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * Local intent router: no model, no keys, no network to parse. It figures
 * out which code facet you meant (card / catalog / call), runs exactly that,
 * and narrates the answer in words plus the equivalent code command, so
 * every smart answer teaches the code form. Pure except through the client.
 */

function words(s) {
  return String(s || "").toLowerCase();
}

function parseArgs(raw) {
  const t = String(raw || "").trim();
  if (!t) return { ok: true, args: {} };
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, args: v };
    return { ok: false, reason: "args must be a JSON object" };
  } catch {
    // fall through to key=value pairs
  }
  const args = {};
  for (const part of t.split(/\s+/)) {
    const i = part.indexOf("=");
    if (i <= 0) return { ok: false, reason: `cannot read args: ${JSON.stringify(t)} (use JSON or key=value)` };
    args[part.slice(0, i)] = part.slice(i + 1);
  }
  return { ok: true, args };
}

function pickSku(text, catalog) {
  const items = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      if (typeof v.sku === "string" || typeof v.name === "string") items.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(catalog);
  const hits = items.filter((it) =>
    [it.sku, it.name, it.id].some(
      (f) => typeof f === "string" && f.length > 2 && text.includes(f.toLowerCase()),
    ),
  );
  return { items, hits };
}

/**
 * Ask in English. Returns { code, say[], heard, equivalent?, json? }.
 * code 0 answered, 1 the call itself refused, 2 could not understand.
 */
export async function ask(client, text) {
  const q = words(text).trim();
  if (!q) {
    return {
      code: 2,
      heard: "nothing",
      say: ['Say something like: "what can you do", "how much is chamber", "who are you", or "call spl_quote {\\"gb\\":10}".'],
    };
  }
  if (/^(help|what can you do|commands|how do i use)/.test(q)) {
    return {
      code: 0,
      heard: "capabilities",
      say: [
        "I can introduce the server (card), quote prices (catalog), or run any tool (call).",
        'Try: "who are you", "how much is rider", or "call <tool> with <args>".',
        "Every answer also shows the code command it ran, so you can skip me next time.",
      ],
    };
  }
  if (/who are you|what (server|service|is this)|introduce|server card|\bcard\b/.test(q)) {
    const r = await client.card();
    if (!r.ok) return { code: 1, heard: "card", say: [`The server did not answer (${r.reason || "unknown"}). Try again in a bit.`] };
    const name = (r.card && (r.card.name || r.card.server)) || "the ACN server";
    return {
      code: 0, heard: "card", json: r,
      equivalent: "spl-acn card",
      say: [`You are talking to ${name}.`, "Ask me prices with \"how much is ...\" or run a tool with \"call ...\"."],
    };
  }
  const m = q.match(/^(call|run|use|invoke)\s+([a-z0-9_.-]+)\s*(.*)$/);
  if (m) {
    const [, , tool, raw0] = m;
    const raw = raw0.replace(/^with\s+/i, "");
    const parsed = parseArgs(raw);
    if (!parsed.ok) return { code: 2, heard: "call", say: [parsed.reason] };
    const r = await client.callTool(tool, parsed.args);
    const equivalent = `spl-acn call ${tool} '${JSON.stringify(parsed.args)}'`;
    if (r.ok) {
      return { code: 0, heard: "call", json: r, equivalent, say: [`${tool} ran clean.`, "Result is below in full."] };
    }
    if (r.reason === "payment_required") {
      return {
        code: 1, heard: "call", json: r, equivalent,
        say: [`${tool} needs payment first. It accepts:`, JSON.stringify(r.accepts || []), "Pay that, then run the command below again unchanged."],
      };
    }
    return { code: 1, heard: "call", json: r, equivalent, say: [`${tool} refused (${r.reason || "unknown"}${r.message ? ": " + r.message : ""}).`, "Fix the input and ask again."] };
  }
  if (/\bprice\b|\bcost\b|how much|\bplan\b|\bsku\b|\bcatalog\b|\bquote\b|\bworth\b/.test(q)) {
    const r = await client.callTool("spl_catalog", {});
    if (!r.ok) {
      if (r.reason === "payment_required") {
        return {
          code: 1, heard: "catalog",
          say: ["The catalog itself needs payment. It accepts:", JSON.stringify(r.accepts || []), "Pay that, then ask me again."],
        };
      }
      return { code: 1, heard: "catalog", say: [`Could not read the catalog (${r.reason || "unknown"}).`] };
    }
    const { items, hits } = pickSku(q, r.result);
    if (hits.length === 1) {
      const h = hits[0];
      const price = h.usd ?? h.usd_per_gb ?? h.usd_per_check ?? h.usd_per_fetch ?? h.usd_per_hour ?? "?";
      return {
        code: 0, heard: "price", json: { ok: true, result: h },
        equivalent: "spl-acn catalog",
        say: [`${h.name || h.sku || h.id}: ${price === "?" ? "see catalog" : "$" + price}${h.sku ? ` (sku ${h.sku})` : ""}.`],
      };
    }
    if (hits.length > 1) {
      return {
        code: 0, heard: "price", json: r, equivalent: "spl-acn catalog",
        say: [`That matches ${hits.length} listings: ${hits.map((h) => h.name || h.sku || h.id).join(", ")}.`, "Name one and I will quote it exactly."],
      };
    }
    return {
      code: 0, heard: "catalog", json: r, equivalent: "spl-acn catalog",
      say: [`I found ${items.length || "the"} listing(s) but none matched your words.`, "Name a product (pcc, chamber, rider, warrant, ...) and I will quote it."],
    };
  }
  if (/compress|decompress|\bzip\b|\bunzip\b/.test(q)) {
    return {
      code: 2,
      heard: "compress-hint",
      say: [
        "I compress through spl_compress: base64 in, packed_b64 out. Quote first — the first 1 GB per IP is free.",
        'Say: "call spl_quote bytes=1861035 product=auto op=compress", then "call spl_compress data_b64=...".',
        "Files: \"call spl_zip\" with files=[{path,data_b64}]. Restore with spl_decompress / spl_unzip.",
      ],
    };
  }
  return {
    code: 2,
    heard: "unknown",
    say: [
      `I did not get that. I understand: "who are you", "how much is <product>", and "call <tool> <args>".`,
      'Example: "call spl_quote {\\"gb\\":10}" or "call spl_quote gb=10".',
    ],
  };
}
