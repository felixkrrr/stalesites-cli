# StaleSites Agent Guide

Run this CLI to find local businesses by type + city, classify their website status, and optionally reverse-search no-site/social candidates for off-profile websites.

## Canonical Command

```bash
npx github:felixkrrr/stalesites-cli -- --type plumber --city "Austin, TX" --verify --provider serper --json
```

For a local clone:

```bash
node lead-engine/find-leads.mjs --type plumber --city "Austin, TX" --verify --provider serper --json
```

## Keys

Required:
- `GOOGLE_MAPS_API_KEY` — Google Places API (New), signup: https://developers.google.com/maps/documentation/places/web-service/cloud-setup

Optional for reverse verification:
- `SERPER_API_KEY` — Google-like search, signup: https://serper.dev/
- `BRAVE_API_KEY` — independent web index, signup: https://brave.com/search/api/
- `EXA_API_KEY` — semantic search, signup: https://exa.ai/

Use `.env` in the repo root or pass keys through the shell environment. Never print or commit key values.

## Preflight

```bash
node lead-engine/find-leads.mjs --preflight
```

This reports which keys are present or missing without exposing values.

## Output

CSV is always written to `--out` or `leads-<type>-<city>.csv`. With `--json`, the lead array is also printed to stdout and progress/summary logs go to stderr.

Lead object fields:
- `name`
- `phone`
- `status`
- `detail`
- `website`
- `found_url`
- `match_reason`
- `verify_provider`
- `verified_status`
- `category`
- `address`
- `maps_url`

Statuses:
- `CONFIRMED_NO_SITE` — reverse search found no own website.
- `SITE_FOUND_OFFLIST` — own website found outside Google profile; still score for stale/dead quality.
- `SOCIAL_ONLY` — Google profile points to social/directory only.
- `PARKED` — website looks parked or for sale.
- `DEAD` — website failed or returned an error.
- `HAS_SITE` — working website on Google profile.
- `NO_WEBSITE` — pre-verification no-site status when `--verify` is not run.

## Safe Use

Use generated CSVs for your own outreach and refresh them as needed. Do not build a persistent resale database of Google Places fields; Google Places data other than `place_id` has caching limits.
