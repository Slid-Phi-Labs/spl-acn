# SPL:ACN MCP API SDK

One client for the hosted Agent Commerce Network: server card, MCP tool
calls, claim-token seats, x402-aware errors.

```js
import { createMcpClient } from "@slidphi/spl-acn";

const acn = createMcpClient({ apiKey: "spl1.…".replace("…", "") });
const card = await acn.card(); // { ok:true, card }
const out = await acn.callTool("spl_catalog", {});
if (!out.ok && out.reason === "payment_required") {
  // pay the accepts instructions, retry with proof
}
```

Free tools need no key. Paid seats send the claim token as the bearer;
402 answers come back as `payment_required` with `accepts`, never a
throw. Dual license: AGPL-3.0-or-later OR Slid Phi Labs Commercial.

## Name

One network, fixed forms: full name **Agent Commerce Network**, short
**ACN**, product **SPL:ACN**, slug and command `spl-acn`, npm
`@slidphi/spl-acn`, repo `ceedot-rock/spl-acn`. The hosted MCP server
it talks to is a different artifact: registry
`io.github.ceedot-rock/slid-phi-labs`. This package claims no
registry name of its own — it is a client.

## Terminal

```sh
npx github:ceedot-rock/spl-acn card                  # server card
npx github:ceedot-rock/spl-acn catalog               # standing SKUs
npx github:ceedot-rock/spl-acn catalog chamber       # filter SKUs
npx github:ceedot-rock/spl-acn prices                # one-line price table
npx github:ceedot-rock/spl-acn quote gb=10           # price without raw JSON
npx github:ceedot-rock/spl-acn call spl_quote '{"gb":10}'
SPL_ACN_KEY=spl1.… npx github:ceedot-rock/spl-acn call spl_compress '{"data_b64":"eA=="}'
npx github:ceedot-rock/spl-acn warrant issue cap-usd=5 tool=spl_compress
npx github:ceedot-rock/spl-acn receipt check ./run-receipt.json
npx github:ceedot-rock/spl-acn batch ./plan.json     # staged calls, stops closed
npx github:ceedot-rock/spl-acn demo                  # offline, no key
npx github:ceedot-rock/spl-acn ask "how much to compress 2 gb"
```

Defaults live in `~/.spl-acn.json` (`endpoint`, `apiKey`,
`timeoutMs`, `maxRetries`, `localTest`, `idempotencyKey`) or
`SPL_ACN_CONFIG`; flags beat env beat config. `--timeout MS` caps one
attempt, `--retries N` replays only transport faults where no response
arrived (network failures) — an answered call is never replayed, and a
timed-out paid POST is never replayed either, so a paid tool cannot
charge twice. Pass `--idempotency-key KEY` (one key per operation) to
allow safe retry of a timed-out POST; `batch` and `ask` refuse a shared
key because they place several calls. `--json` prints machine output
only.

Endpoints: the canonical route is `/api/mcp` on
`https://www.slidphilabs.com` (a trailing `/mcp` path is normalized to
`/api/mcp`). Custom endpoints must be https on a known host; use
`--local-test` (or `SPL_ACN_LOCAL_TEST=1`) for local http development.
Tool arguments are capped at 1 MiB of JSON per call.

Or install the `spl-acn` binary. Exit codes: 0 ok, 1 call refused,
2 bad CLI. Registry install (`npx @slidphi/spl-acn`) lands with the
first npm publish.
