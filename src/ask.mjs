/**
 * spl-acn ask — plain-English front end for the code facets.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * Local intent router: no model, no keys, no network to parse. It figures
 * out which code facet you meant (card / catalog / call), runs exactly that,
 * and narrates the answer in words plus the equivalent code command, so
 * every smart answer teaches the code form. Pure except through the client.
 */

import { demoScript } from "./demo.mjs";
import { catalogItems, itemPrice, matchItems } from "./catalog.mjs";

function words(s) {
  return String(s || "").toLowerCase();
}

const UNIT_MULT = { b: 1, byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };

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
  const items = catalogItems(catalog);
  const hits = matchItems(items, "").filter((it) =>
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
        "I can introduce the server (card), quote prices (catalog, quote, prices), or run any tool (call, batch).",
        'Try: "who are you", "how much is rider", "how much to compress 2 gb", or "call <tool> with <args>".',
        'Warrants cap spend ("what is a warrant"), receipts verify runs ("check a receipt"), demo needs no key ("show me a demo").',
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
  const qm = q.match(/(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|bytes?|byte|b)\b/);
  if (
    qm &&
    /\bprice\b|\bcost\b|how much|\bquote\b|compress|store|depot|run|fetch|chamber|rider|\bworth\b/.test(q)
  ) {
    const unit = qm[2].toLowerCase();
    const bytes = Math.round(parseFloat(qm[1]) * (UNIT_MULT[unit] || 1));
    const pm = q.match(/\b(compress|chamber|rider|warrant|depot|fetch|pcc)\b/);
    const qargs = { bytes, ...(pm ? { product: pm[1] } : {}) };
    const equivalent = `spl-acn quote bytes=${bytes}${pm ? ` product=${pm[1]}` : ""}`;
    const r = await client.callTool("spl_quote", qargs);
    if (!r.ok) {
      if (r.reason === "payment_required") {
        return {
          code: 1, heard: "quote", json: r, equivalent,
          say: ["That quote itself needs payment. It accepts:", JSON.stringify(r.accepts || []), "Pay that, then run the command below again unchanged."],
        };
      }
      return { code: 1, heard: "quote", json: r, equivalent, say: [`Could not quote that (${r.reason || "unknown"}).`] };
    }
    const total = r.result && typeof r.result === "object"
      ? (r.result.usd ?? r.result.total ?? r.result.price) : undefined;
    return {
      code: 0, heard: "quote", json: r, equivalent,
      say: [total !== undefined && total !== null
        ? `About $${total} for ${bytes} bytes${pm ? ` (${pm[1]})` : ""}.`
        : `Quoted ${bytes} bytes — full result below.`],
    };
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
      const p = itemPrice(h);
      return {
        code: 0, heard: "price", json: { ok: true, result: h },
        equivalent: "spl-acn catalog",
        say: [`${h.name || h.sku || h.id}: ${p ? p.label : "see catalog"}${h.sku ? ` (sku ${h.sku})` : ""}.`],
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
  if (/\bwarrant\b|spend.{0,10}cap|cap.{0,10}(spend|usd)/.test(q)) {
    return {
      code: 2,
      heard: "warrant-hint",
      equivalent: "spl-acn warrant issue cap-usd=5 tool=spl_compress",
      say: [
        "Warrants cap what one tool may spend: issue one, hand it to the run, verify it after.",
        "Code: spl-acn warrant issue cap-usd=5 tool=spl_compress — then spl-acn warrant verify <id>.",
      ],
    };
  }
  if (/\breceipt\b|\bproof\b|signed|verify.*(run|output|result)/.test(q)) {
    return {
      code: 2,
      heard: "receipt-hint",
      equivalent: "spl-acn receipt check <file>",
      say: [
        "I verify run receipts offline: every step should carry stage, ok, tool, toolVersion, plus sha256, size, or tx.",
        "Code: spl-acn receipt check <file-or-json> — refuses closed on anything malformed.",
      ],
    };
  }
  if (/\bbatch\b|staged run|many tools|plan file/.test(q)) {
    return {
      code: 2,
      heard: "batch-hint",
      equivalent: "spl-acn batch plan.json",
      say: [
        "Batch runs a plan file of staged calls in order and stops closed at the first refusal — later steps never run.",
        'Code: spl-acn batch plan.json with {"steps":[{"tool":"spl_quote","args":{"gb":10}}]}.',
      ],
    };
  }
  if (/\bdemo\b|try it|offline|no network|without (a key|network)/.test(q)) {
    const d = demoScript();
    return {
      code: 0,
      heard: "demo",
      equivalent: "spl-acn demo",
      json: d.json,
      say: d.say,
    };
  }
  return {
    code: 2,
    heard: "unknown",
    say: [
      `I did not get that. I understand: "who are you", "how much is <product>", "how much to <verb> <size>", and "call <tool> <args>".`,
      'Also: "what is a warrant", "check a receipt", "batch a plan", "show me a demo".',
      'Example: "call spl_quote {\\"gb\\":10}" or "call spl_quote gb=10".',
    ],
  };
}
