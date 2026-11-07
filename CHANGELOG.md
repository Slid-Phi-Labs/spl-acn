# Changelog

## 0.3.0

Ten platform options over the 0.2.0 rails:

1. `quote gb=|bytes= [product=] [op=]` — first-class price quotes,
   no raw JSON (`--gb 10` works too).
2. `catalog [query]` — filter standing SKUs by name.
3. `warrant issue cap-usd= tool=` / `warrant verify <id>` —
   spend-capped warrants from the terminal.
4. `receipt check <file|json>` — offline signed-receipt verification
   (stage, ok, tool, toolVersion + sha256/size/tx anchor).
5. `batch <plan.json>` — staged calls in order, stops closed at the
   first refusal; later steps never run.
6. `--timeout MS` / `--retries N` — slow servers refuse as
   `timed_out`; only no-response transport faults replay, so an
   answered (possibly paid) call is never executed twice.
7. `demo` — full ACN walkthrough with canned answers, no network,
   no key.
8. `~/.spl-acn.json` (or `SPL_ACN_CONFIG`) — endpoint/key/timeout/
   retry defaults; flags beat env beat config; the CLI never writes
   secrets.
9. `ask` learns quote-bytes ("how much to compress 2 gb" really
   quotes), warrant/receipt/batch hints, and offline demo.
10. `prices` — one-line price table; `--json` gives machine output
    on catalog/prices/quote.

## 0.2.0

`spl-acn ask "..."`: plain-English smart layer over card/catalog/call.
Local intent router (no model, no keys): introductions, price quotes from
the live catalog, tool calls with JSON or key=value args, payment needs
explained in words. Every answer prints the equivalent code command.

## 0.1.0

Initial SPL:ACN MCP API SDK: server card, tool calls, claim auth,
x402-aware `payment_required` errors. Replaces the docs-only
slid-phi-mcp listing as the supported client surface.
