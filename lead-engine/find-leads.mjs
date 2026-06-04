#!/usr/bin/env node
// find-leads.mjs — StaleSites lead engine
//
// Searches Google Maps (Places API New, Text Search) for businesses of a given
// type in a given city, then verifies each one's website status so you get a
// prioritized list of outreach targets: businesses with no site, a social-only
// presence, or a dead/parked site.
//
// $0 to start: the Enterprise Text Search SKU includes 1,000 free requests/mo,
// and each request returns up to 20 places -> ~20,000 businesses/mo free.
// After that it's ~$35 / 1,000 requests (~$1.75 / 1,000 businesses).
//
// ToS note: this is a tool for YOUR OWN outreach. Use the CSV and refresh it;
// don't build a persistent, resold database of Places content (>30 day caching
// of Places fields other than place_id violates Google's terms).
//
// Usage:
//   GOOGLE_MAPS_API_KEY=... node find-leads.mjs --type "plumber" --city "Austin, TX"
//   ... --max 60 --out leads.csv --region US
//
// No npm install needed (Node 18+ / built-in fetch).

import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_KEYS,
  PROVIDERS,
  DIRECTORY_HOSTS,
  verifyBusinessWebsite,
} from "./reverse-search.mjs";

// ---------- args ----------
function parseArgs(argv) {
  const a = {
    max: 60,
    region: "US",
    out: null,
    type: null,
    city: null,
    concurrency: 8,
    verify: false,
    provider: "serper",
    json: false,
    preflight: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--type": a.type = v; i++; break;
      case "--city": a.city = v; i++; break;
      case "--max": a.max = parseInt(v, 10); i++; break;
      case "--region": a.region = v; i++; break;
      case "--out": a.out = v; i++; break;
      case "--concurrency": a.concurrency = parseInt(v, 10); i++; break;
      case "--verify": a.verify = true; break;
      case "--provider": a.provider = v; i++; break;
      case "--json": a.json = true; break;
      case "--preflight": a.preflight = true; break;
      case "-h": case "--help": a.help = true; break;
    }
  }
  return a;
}

const HELP = `
find-leads — find local businesses with no / weak websites

Required:
  --type   <string>   business category, e.g. "plumber", "dentist", "roofer"
  --city   <string>   location, e.g. "Austin, TX" or "Brooklyn, NY"

Optional:
  --max    <n>        max businesses to pull (default 60; Google caps a query at 60)
  --region <cc>       region bias, ISO country code (default US)
  --out    <file>     CSV output path (default leads-<type>-<city>.csv)
  --concurrency <n>   parallel website checks (default 8)
  --verify            reverse-search no-site/social rows for off-profile sites
  --provider <name>   reverse-search provider: serper, brave, exa (default serper)
  --json              print JSON rows to stdout; progress goes to stderr
  --preflight         show configured/missing API keys and exit

Env:
  GOOGLE_MAPS_API_KEY   required — a key with "Places API (New)" enabled
  SERPER_API_KEY        optional — enables --verify --provider serper
  BRAVE_API_KEY         optional — enables --verify --provider brave
  EXA_API_KEY           optional — enables --verify --provider exa

Example:
  GOOGLE_MAPS_API_KEY=AIza... node find-leads.mjs --type plumber --city "Austin, TX"
  node find-leads.mjs --type plumber --city "Austin, TX" --verify --provider serper --json
`;

function loadDotenv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), ".env"),
    join(here, "..", ".env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function preflight() {
  const rows = [
    ["GOOGLE_MAPS_API_KEY", "required", "Google Places API (New)"],
    ["SERPER_API_KEY", "optional", "Serper reverse search"],
    ["BRAVE_API_KEY", "optional", "Brave reverse search"],
    ["EXA_API_KEY", "optional", "Exa reverse search"],
  ];
  console.log("StaleSites preflight");
  for (const [key, kind, label] of rows) {
    console.log(`  ${process.env[key] ? "OK     " : "MISSING"} ${key.padEnd(20)} ${kind.padEnd(8)} ${label}`);
  }
  console.log("\nSignup links:");
  console.log("  Google Places: https://developers.google.com/maps/documentation/places/web-service/cloud-setup");
  console.log("  Serper:        https://serper.dev/");
  console.log("  Brave:         https://brave.com/search/api/");
  console.log("  Exa:           https://exa.ai/");
}

// ---------- website classification ----------
// Domains that mean "no real website of their own" — these are still leads.
const SOCIAL_HOSTS = [
  "facebook.com", "m.facebook.com", "fb.me", "fb.com",
  "instagram.com", "twitter.com", "x.com",
  "linktr.ee", "linktree.com", "linkin.bio", "beacons.ai",
  "yelp.com", "tripadvisor.com", "foursquare.com", "nextdoor.com",
  "business.site",            // Google's free "website" builder = no real site
  "sites.google.com",
  "wa.me", "t.me", "tiktok.com", "youtube.com",
  ...DIRECTORY_HOSTS,
];

const PARKED_HINTS = [
  "domain is for sale", "buy this domain", "domain for sale",
  "this domain may be for sale", "parked", "godaddy.com/domainsearch",
  "default web site page", "future home of",
];

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

export function isSocial(url) {
  const h = hostOf(url);
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith("." + s));
}

// Returns { status, detail } where status is one of:
// NO_WEBSITE, SOCIAL_ONLY, DEAD, PARKED, HAS_SITE
export async function classifyWebsite(url) {
  if (!url) return { status: "NO_WEBSITE", detail: "" };
  if (isSocial(url)) return { status: "SOCIAL_ONLY", detail: hostOf(url) };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (StaleSites lead check)" },
    });
    if (res.status >= 400) return { status: "DEAD", detail: `HTTP ${res.status}` };

    // redirected onto a social platform? still social-only
    if (isSocial(res.url)) return { status: "SOCIAL_ONLY", detail: hostOf(res.url) };

    const body = (await res.text()).slice(0, 4000).toLowerCase();
    if (PARKED_HINTS.some((h) => body.includes(h))) {
      return { status: "PARKED", detail: "parked/for-sale page" };
    }
    return { status: "HAS_SITE", detail: `HTTP ${res.status}` };
  } catch (e) {
    const reason = e.name === "AbortError" ? "timeout" : (e.cause?.code || e.message || "unreachable");
    return { status: "DEAD", detail: String(reason) };
  } finally {
    clearTimeout(t);
  }
}

// ---------- Google Places (New) Text Search ----------
async function textSearch({ apiKey, textQuery, region, max }) {
  const places = [];
  let pageToken;
  let requests = 0;
  do {
    const body = { textQuery, regionCode: region, pageSize: Math.min(20, max - places.length) };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // Field mask sets the SKU. websiteUri + nationalPhoneNumber => Enterprise SKU.
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.nationalPhoneNumber",
          "places.websiteUri",
          "places.googleMapsUri",
          "places.primaryTypeDisplayName",
          "nextPageToken",
        ].join(","),
      },
      body: JSON.stringify(body),
    });
    requests++;

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Places API ${res.status}: ${txt}`);
    }
    const data = await res.json();
    for (const p of data.places || []) places.push(p);
    pageToken = data.nextPageToken;
  } while (pageToken && places.length < max);

  return { places: places.slice(0, max), requests };
}

// ---------- concurrency helper ----------
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// ---------- CSV ----------
export function csvCell(v) {
  const s = (v ?? "").toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Lead priority: best outreach targets first.
const PRIORITY = {
  CONFIRMED_NO_SITE: 0,
  SOCIAL_ONLY: 1,
  PARKED: 2,
  DEAD: 3,
  SITE_FOUND_OFFLIST: 4,
  NO_WEBSITE: 5,
  HAS_SITE: 6,
};

function log(args, msg) {
  if (args.json) process.stderr.write(msg);
  else process.stdout.write(msg);
}

function normalizeProvider(provider) {
  const p = String(provider || "").toLowerCase();
  if (!PROVIDERS.includes(p)) throw new Error(`Unknown --provider "${provider}". Use: ${PROVIDERS.join(", ")}`);
  return p;
}

async function verifyRows(rows, args) {
  const provider = normalizeProvider(args.provider);
  const key = process.env[PROVIDER_KEYS[provider]];
  if (!key) {
    process.stderr.write(`Skipping --verify: missing ${PROVIDER_KEYS[provider]} for provider "${provider}".\n`);
    return { rows, verifyQueries: 0, skipped: true };
  }

  const candidates = rows.filter((r) => r.status === "NO_WEBSITE" || r.status === "SOCIAL_ONLY");
  process.stderr.write(`Reverse-verifying ${candidates.length} no-site/social candidate(s) with ${provider}...\n`);
  let verifyQueries = 0;

  await mapPool(candidates, Math.min(args.concurrency, 4), async (row) => {
    try {
      const match = await verifyBusinessWebsite({
        name: row.name,
        phone: row.phone,
        address: row.address,
        city: args.city,
      }, provider);
      verifyQueries += match.query_count || 0;
      row.verify_provider = provider;
      row.match_reason = match.match_reason;
      row.found_url = match.url || "";
      if (match.found) {
        const found = await classifyWebsite(match.url);
        row.verified_status = found.status;
        row.status = "SITE_FOUND_OFFLIST";
        row.detail = `found off Google profile: ${found.status}${found.detail ? ` (${found.detail})` : ""}`;
        row.website = row.website || match.url;
      } else if (row.status === "NO_WEBSITE") {
        row.verified_status = "CONFIRMED_NO_SITE";
        row.status = "CONFIRMED_NO_SITE";
        row.detail = "no own-site found by reverse search";
      } else {
        row.verified_status = row.status;
      }
    } catch (e) {
      row.verify_provider = provider;
      row.match_reason = "error";
      row.verified_status = row.status;
      row.detail = `${row.detail || row.status}; verify error: ${e.message || e}`;
    }
  });

  return { rows, verifyQueries, skipped: false };
}

// ---------- main ----------
async function main() {
  loadDotenv();
  const args = parseArgs(process.argv);
  if (args.preflight) {
    preflight();
    process.exit(0);
  }
  if (args.help || !args.type || !args.city) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  args.provider = normalizeProvider(args.provider);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("ERROR: set GOOGLE_MAPS_API_KEY (a key with 'Places API (New)' enabled).");
    process.exit(1);
  }

  const textQuery = `${args.type} in ${args.city}`;
  process.stderr.write(`Searching Google Maps: "${textQuery}" (max ${args.max})...\n`);

  const { places, requests } = await textSearch({
    apiKey, textQuery, region: args.region, max: args.max,
  });
  process.stderr.write(`Found ${places.length} businesses in ${requests} API request(s). Checking websites...\n`);

  const rows = await mapPool(places, args.concurrency, async (p) => {
    const url = p.websiteUri || "";
    const { status, detail } = await classifyWebsite(url);
    return {
      name: p.displayName?.text || "",
      phone: p.nationalPhoneNumber || "",
      status,
      detail,
      website: url,
      found_url: "",
      match_reason: "",
      verify_provider: "",
      verified_status: "",
      category: p.primaryTypeDisplayName?.text || "",
      address: p.formattedAddress || "",
      maps_url: p.googleMapsUri || "",
    };
  });

  let verifyQueries = 0;
  if (args.verify) {
    const verified = await verifyRows(rows, args);
    verifyQueries = verified.verifyQueries;
  }

  rows.sort((a, b) => (PRIORITY[a.status] - PRIORITY[b.status]) || a.name.localeCompare(b.name));

  // write CSV
  const header = [
    "name", "phone", "status", "detail", "website", "found_url", "match_reason",
    "verify_provider", "verified_status", "category", "address", "maps_url",
  ];
  const csv = [header.join(",")]
    .concat(rows.map((r) => header.map((h) => csvCell(r[h])).join(",")))
    .join("\n");
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const outPath = args.out || `leads-${slug(args.type)}-${slug(args.city)}.csv`;
  writeFileSync(outPath, csv);

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
  }

  // summary
  const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const leads = (counts.CONFIRMED_NO_SITE || 0) + (counts.NO_WEBSITE || 0) + (counts.SOCIAL_ONLY || 0) + (counts.PARKED || 0) + (counts.DEAD || 0) + (counts.SITE_FOUND_OFFLIST || 0);
  // Enterprise Text Search: ~$35/1k requests, first 1,000/mo free.
  const cost = (requests * 0.035).toFixed(3);

  process.stderr.write("\n");
  log(args, `Results for "${textQuery}":\n`);
  log(args, `  ${rows.length} businesses scanned\n`);
  log(args, `  ${counts.CONFIRMED_NO_SITE || 0}  confirmed no site  (hottest leads)\n`);
  log(args, `  ${counts.NO_WEBSITE || 0}  unverified no site  (run --verify)\n`);
  log(args, `  ${counts.SOCIAL_ONLY || 0}  social-only         (facebook/instagram/etc — leads)\n`);
  log(args, `  ${counts.PARKED || 0}  parked/for-sale     (leads)\n`);
  log(args, `  ${counts.DEAD || 0}  dead/unreachable    (leads — verify)\n`);
  log(args, `  ${counts.SITE_FOUND_OFFLIST || 0}  site found offlist  (score for stale/dead quality)\n`);
  log(args, `  ${counts.HAS_SITE || 0}  have a working site  (deprioritized)\n`);
  log(args, `  => ${leads} outreach targets\n`);
  log(args, `\nWrote ${outPath}\n`);
  log(args, `API cost this run: ${requests} Places request(s) ~ $${cost} (first 1,000/mo are free).\n`);
  if (args.verify) log(args, `Reverse-search queries this run: ${verifyQueries} via ${args.provider}.\n`);
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
}

if (isEntrypoint()) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
