#!/usr/bin/env node
// eval-providers.mjs — compare Serper, Brave, and Exa on the same lead sample.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_KEYS, PROVIDERS, verifyBusinessWebsite } from "./reverse-search.mjs";
import { csvCell } from "./find-leads.mjs";

const HELP = `
eval-providers — compare reverse-search providers on a sample CSV

Usage:
  node eval-providers.mjs --sample leads.csv --out compare.csv

Sample CSV columns:
  name, phone, address

Env:
  SERPER_API_KEY, BRAVE_API_KEY, EXA_API_KEY
`;

function parseArgs(argv) {
  const args = { sample: null, out: "compare.csv", city: "" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--sample") { args.sample = v; i++; }
    else if (k === "--out") { args.out = v; i++; }
    else if (k === "--city") { args.city = v; i++; }
    else if (k === "-h" || k === "--help") args.help = true;
  }
  return args;
}

function loadDotenv() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of [join(process.cwd(), ".env"), join(here, "..", ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  if (!rows.length) return [];
  const header = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ""])));
}

async function main() {
  loadDotenv();
  const args = parseArgs(process.argv);
  if (args.help || !args.sample) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const sample = parseCsv(readFileSync(args.sample, "utf8")).filter((r) => r.name);
  if (!sample.length) throw new Error("Sample CSV has no rows with a name column.");

  const activeProviders = PROVIDERS.filter((p) => process.env[PROVIDER_KEYS[p]]);
  if (!activeProviders.length) throw new Error("No provider keys found. Set at least one of SERPER_API_KEY, BRAVE_API_KEY, EXA_API_KEY.");

  process.stderr.write(`Evaluating ${sample.length} businesses across ${activeProviders.join(", ")}...\n`);
  const out = [];
  for (const business of sample) {
    const row = {
      name: business.name,
      phone: business.phone || "",
    };
    for (const provider of PROVIDERS) {
      if (!process.env[PROVIDER_KEYS[provider]]) {
        row[`${provider}_decision`] = "missing_key";
        row[`${provider}_url`] = "";
        row[`${provider}_match_reason`] = "";
        continue;
      }
      try {
        const match = await verifyBusinessWebsite({
          name: business.name,
          phone: business.phone || "",
          address: business.address || "",
          city: args.city,
        }, provider);
        row[`${provider}_decision`] = match.found ? "SITE_FOUND_OFFLIST" : "CONFIRMED_NO_SITE";
        row[`${provider}_url`] = match.url || "";
        row[`${provider}_match_reason`] = match.match_reason;
      } catch (e) {
        row[`${provider}_decision`] = "error";
        row[`${provider}_url`] = "";
        row[`${provider}_match_reason`] = e.message || String(e);
      }
    }
    out.push(row);
  }

  const header = [
    "name", "phone",
    "serper_decision", "serper_url", "serper_match_reason",
    "brave_decision", "brave_url", "brave_match_reason",
    "exa_decision", "exa_url", "exa_match_reason",
  ];
  const csv = [header.join(",")]
    .concat(out.map((r) => header.map((h) => csvCell(r[h])).join(",")))
    .join("\n");
  writeFileSync(args.out, csv);
  console.log(`Wrote ${args.out}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
