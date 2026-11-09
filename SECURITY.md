# Security policy for spl-acn

DRAFT. Not published. Counsel review pending.

## Reporting a vulnerability

Please report security issues privately. Do not open a public issue, pull request or post about it.

- Preferred: use the "Report a vulnerability" button on this repository's Security tab (GitHub private vulnerability reporting).
- Or email: corey@slidphilabs.com (interim address; it will move to security@slidphilabs.com once that address exists).

Include the repository commit or npm package version you tested (the package may lag the repository), the steps or input that trigger the problem, the expected and actual behaviour, and the impact in plain words.

## Scope

In scope:

- The public client code in this repository (branch main) and the npm package @slidphi/spl-acn. Report against the repository and the published package.
- The hosted Agent Commerce Network service at www.slidphilabs.com, host only. The exact tool path is being confirmed, and paths will be listed here once confirmed.

Out of scope: any other host, third-party services we use, our private repositories, denial of service, load testing, and any secret we issued and never published.

## Rules for testing

1. Test your own things. Use your own accounts and seats only. Never use another person's account, token or key.
2. Prefer a local copy. Build the client from this repository and run it against placeholder values.
3. On the live service, send only light, read-only requests, at 5 per second or fewer per endpoint. No load tests.
4. No live money. Do not buy, transfer, cancel or refund anything, and do not spend or move anyone's credits.
5. If you reach another person's data, stop, do not copy or keep it, delete any copy, and tell us.
6. No social engineering, phishing, physical access, or pressure on staff, contractors or investors.
7. Keep details private until the disclosure date below. Report one issue per report.

## What to expect from us

We acknowledge a report within 2 business days and confirm it, with severity and a fix target, within 5 business days. Fix targets: 14 days for Critical, 30 for High, 90 for Medium, and the next scheduled release within 180 days for Low.

## Disclosure

Keep the issue private until a fix is live or 90 days from confirmation, whichever comes first. We may ask in writing for up to 30 more days if a fix is close. After the fix we publish a short note, with your name or handle if you agree.

## Safe harbor (draft, subject to counsel review)

If you act in good faith under this policy and stay within the rules above, we will not start or support legal action against you for research on these assets.

## Recognition

Accepted reports are listed in our Hall of fame with your consent, at https://www.slidphilabs.com/hall-of-fame. No payment amounts are listed.
