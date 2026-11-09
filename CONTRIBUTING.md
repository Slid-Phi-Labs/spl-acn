# Contributing to spl-acn

Thanks for helping improve the SPL:ACN client.

## Quick checks

The client needs Node 18 or newer and has no build step.

```sh
npm test
```

This runs `node --test test/*.test.mjs`.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep one change per pull request.
3. Add or update a test in `test/` next to the code you changed.
4. Add a line to `CHANGELOG.md` under a new version heading when behavior changes.
5. Fill in the pull request template.

Never put keys, tokens or claim secrets in a pull request, an issue or a test. Report security problems privately, as `SECURITY.md` describes.

## Licensing

spl-acn is dual-licensed: AGPL-3.0-or-later, or the Slid Phi Labs Commercial License. See `LICENSE`, `LICENSE.AGPL-3.0` and `LICENSE.COMMERCIAL`. By contributing you agree your contribution may be distributed under both.
