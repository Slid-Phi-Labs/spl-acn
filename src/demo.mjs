/**
 * SPL:ACN offline demo — canned card, catalog, and quote walkthrough.
 * Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial. See /LICENSE.
 *
 * Lets judges, teammates, and new users try the whole ACN story with no
 * network and no key. Every canned answer prints the live command it
 * mirrors, so the demo teaches the real terminal. Pure data + words.
 */

export const DEMO_CARD = {
  name: "spl-acn",
  server: "SPL:ACN (demo walkthrough)",
  note: "Canned card. Run `spl-acn card` against the live server for the real one.",
};

export const DEMO_CATALOG = {
  // Same SKUs and price fields as the live server (amount_usd strings).
  products: [
    { sku: "suite", name: "PCC usage", amount_usd: "0.00", blurb: "$0.25/GB, first 1 GB free once per IP" },
    { sku: "chamber-year", name: "Chamber · annual cloak license", amount_usd: "200.00" },
    { sku: "rider-solo", name: "Rider · Solo seat", amount_usd: "12.00" },
  ],
};

export const DEMO_QUOTE = {
  tool: "spl_quote",
  args: { bytes: 2000000000, product: "compress" },
  result: { usd: 0.25, note: "illustrative — live quote may differ" },
};

/** Ordered walkthrough lines; the CLI prints these, ask reuses the shape. */
export function demoScript() {
  return {
    say: [
      "Demo: no network, no key. Here is the whole ACN loop with canned answers.",
      `1. Server: ${DEMO_CARD.name} — live form: spl-acn card`,
      `2. Catalog: ${DEMO_CATALOG.products.map((p) => p.name).join(", ")} — live form: spl-acn catalog`,
      `3. Quote: 2 GB to compress ≈ $${DEMO_QUOTE.result.usd} — live form: spl-acn quote bytes=2000000000 product=compress`,
      "4. Paid tools answer payment_required with accepts — pay, then retry unchanged.",
      "5. Every run step emits a signed receipt — check one with: spl-acn receipt check <file>",
    ],
    json: { ok: true, demo: true, card: DEMO_CARD, catalog: DEMO_CATALOG, quote: DEMO_QUOTE },
  };
}
