# StaleSites

Find local businesses on Google Maps with no website, a social-only presence, or a weak/dead site. Use the CSV for manual outreach, or pass `--json` so an agent can parse the lead list directly.

## Quick Start

```bash
npx github:felixkrrr/stalesites-cli -- --type plumber --city "Austin, TX" --verify --provider serper
```

For a local clone:

```bash
cp .env.example .env
node lead-engine/find-leads.mjs --preflight
node lead-engine/find-leads.mjs --type plumber --city "Austin, TX" --verify --provider serper --out leads.csv
```

## API Keys

Required:
- `GOOGLE_MAPS_API_KEY` with Places API (New) enabled.

Optional for reverse-search verification:
- `SERPER_API_KEY` for Serper.
- `BRAVE_API_KEY` for Brave Search API.
- `EXA_API_KEY` for Exa.

The CLI auto-loads `.env` from the repo root. Key values are never printed by `--preflight`.

## CLI

```bash
node lead-engine/find-leads.mjs --type "plumber" --city "Austin, TX" [options]
```

Options:
- `--max <n>` max businesses to pull, default 60.
- `--region <cc>` region bias, default `US`.
- `--out <file>` CSV output path.
- `--concurrency <n>` parallel website checks, default 8.
- `--verify` reverse-search `NO_WEBSITE` and `SOCIAL_ONLY` rows.
- `--provider serper|brave|exa` verification provider, default `serper`.
- `--json` print lead array to stdout for agents.
- `--preflight` show configured/missing API keys.

## Output Statuses

- `CONFIRMED_NO_SITE` — no own site found after reverse search.
- `SITE_FOUND_OFFLIST` — own site found outside the Google profile; keep it for stale/dead quality scoring.
- `SOCIAL_ONLY` — profile points to social/directory only.
- `PARKED` — website looks parked or for sale.
- `DEAD` — website is unreachable or errors.
- `HAS_SITE` — working website on profile.
- `NO_WEBSITE` — pre-verification no-site status when `--verify` is not run.

CSV columns: `name`, `phone`, `status`, `detail`, `website`, `found_url`, `match_reason`, `verify_provider`, `verified_status`, `category`, `address`, `maps_url`.

## Provider Spike

Compare providers on the same sample:

```bash
node lead-engine/eval-providers.mjs --sample leads.csv --out compare.csv
```

The sample CSV needs `name`, `phone`, and `address` columns. The harness writes per-provider decisions and found URLs so you can label ground truth and pick the best provider.

Default recommendation until the spike is complete: `serper`, because it mirrors manual Google search and has low setup friction.

## ToS / Data Use

Use generated CSVs for your own outreach and refresh them as needed. Do not build a persistent, resold database of Google Places content; non-`place_id` Places fields have caching limits.
