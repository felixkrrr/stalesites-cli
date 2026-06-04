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
node lead-engine/find-leads.mjs --type plumber --city "Austin, TX" --verify --provider serper --history .stalesites/history.jsonl --hide-seen --out leads.csv
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
- `--history <file>` read/write local JSONL dedupe history keyed by Google `place_id`.
- `--hide-seen` omit businesses already present in `--history`.
- `--include-seen` keep seen businesses and annotate `seen_before`, `first_seen`, `last_seen`.
- `--seen-window-days <n>` with `--hide-seen`, only hide businesses seen in the last `n` days.
- `--no-mark-seen` read history without appending this run's `place_id`s.

## Repeat Searches

Google Places Text Search returns up to 60 places for one query. To prospect over time without recycling the same businesses, use a local history file:

```bash
node lead-engine/find-leads.mjs --type plumber --city "Austin, TX" --verify --provider serper --history .stalesites/history.jsonl --hide-seen
```

Then broaden with nearby cities, neighborhoods, or narrower services while reusing the same history:

```bash
node lead-engine/find-leads.mjs --type "drain cleaning" --city "Austin, TX" --history .stalesites/history.jsonl --hide-seen
node lead-engine/find-leads.mjs --type plumber --city "Round Rock, TX" --history .stalesites/history.jsonl --hide-seen
```

The history stores only lightweight dedupe events: `place_id`, timestamp, search key, and status. The CSV/JSON is the full per-run lead artifact.

## Output Statuses

- `CONFIRMED_NO_SITE` — no own site found after reverse search.
- `SITE_FOUND_OFFLIST` — own site found outside the Google profile; keep it for stale/dead quality scoring.
- `SOCIAL_ONLY` — profile points to social/directory only.
- `PARKED` — website looks parked or for sale.
- `DEAD` — website is unreachable or errors.
- `HAS_SITE` — working website on profile.
- `NO_WEBSITE` — pre-verification no-site status when `--verify` is not run.

CSV columns: `place_id`, `name`, `phone`, `status`, `detail`, `website`, `found_url`, `website_urls`, `match_reason`, `verify_provider`, `verified_status`, `seen_before`, `first_seen`, `last_seen`, `category`, `address`, `maps_url`.

URL fields:
- `website` — website URL from the Google Business profile.
- `found_url` — own-site URL found by reverse search when the Google profile did not list it.
- `website_urls` — combined verification list for agents/users.

## Provider Spike

Compare providers on the same sample:

```bash
node lead-engine/eval-providers.mjs --sample leads.csv --out compare.csv
```

The sample CSV needs `name`, `phone`, and `address` columns. The harness writes per-provider decisions and found URLs so you can label ground truth and pick the best provider.

Default recommendation until the spike is complete: `serper`, because it mirrors manual Google search and has low setup friction.

## ToS / Data Use

Use generated CSVs for your own outreach and refresh them as needed. Do not build a persistent, resold database of Google Places content; non-`place_id` Places fields have caching limits.
