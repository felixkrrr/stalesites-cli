// reverse-search.mjs — provider adapters + own-site matching for StaleSites.
// Zero dependencies; Node 18+ fetch.

export const PROVIDERS = ["serper", "brave", "exa"];

export const PROVIDER_KEYS = {
  serper: "SERPER_API_KEY",
  brave: "BRAVE_API_KEY",
  exa: "EXA_API_KEY",
};

export const DIRECTORY_HOSTS = [
  "yelp.com", "yellowpages.com", "mapquest.com", "bbb.org", "angi.com",
  "angieslist.com", "thumbtack.com", "nextdoor.com", "tripadvisor.com",
  "opentable.com", "doordash.com", "ubereats.com", "houzz.com", "manta.com",
  "chamberofcommerce.com", "foursquare.com", "alignable.com", "porch.com",
  "homeadvisor.com", "buildzoom.com", "birdeye.com", "clutch.co",
  "womply.com", "datanyze.com", "dnb.com", "zoominfo.com", "bark.com",
  "expertise.com", "threebestrated.com", "ezlocal.com", "cybo.com",
  "hotfrog.com", "superpages.com", "local.yahoo.com", "merchantcircle.com",
];

const SOCIAL_HOSTS = [
  "facebook.com", "m.facebook.com", "fb.me", "fb.com", "instagram.com",
  "twitter.com", "x.com", "linktr.ee", "linktree.com", "linkin.bio",
  "beacons.ai", "business.site", "sites.google.com", "wa.me", "t.me",
  "tiktok.com", "youtube.com",
];

const LEGAL_SUFFIXES = new Set([
  "llc", "inc", "co", "corp", "corporation", "company", "ltd", "limited",
  "pllc", "lp", "llp", "pc", "pa",
]);

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "services", "service", "company", "co",
  "inc", "llc", "ltd", "of", "at", "in", "a", "an",
]);

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function registrableLabel(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts[0] || "";
  const twoPartTlds = new Set(["co.uk", "com.au", "com.br", "com.mx"]);
  const tail = parts.slice(-2).join(".");
  if (twoPartTlds.has(tail) && parts.length >= 3) return parts.at(-3);
  return parts.at(-2);
}

function hostMatches(host, hosts) {
  return hosts.some((h) => host === h || host.endsWith("." + h));
}

export function isNonOwnSite(url, extraHosts = []) {
  const host = hostOf(url);
  return hostMatches(host, SOCIAL_HOSTS) || hostMatches(host, DIRECTORY_HOSTS) || hostMatches(host, extraHosts);
}

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function phoneVariants(phone) {
  const d = digits(phone);
  if (!d) return [];
  const local = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return [...new Set([d, local].filter((v) => v.length >= 7))];
}

function normalizeTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !LEGAL_SUFFIXES.has(t))
    .filter((t) => !STOP_WORDS.has(t))
    .filter((t) => t.length > 1);
}

function tokenSet(s) {
  return new Set(normalizeTokens(s));
}

function overlapScore(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const t of a) {
    if (b.has(t)) hits++;
  }
  return hits / Math.max(a.size, 1);
}

function compact(s) {
  return normalizeTokens(s).join("");
}

export function buildQueries(business) {
  const name = business.name || "";
  const city = business.city || cityFromAddress(business.address) || "";
  const queries = [];
  if (name && city) queries.push(`"${name}" ${city}`);
  if (name && !city) queries.push(`"${name}"`);
  if (business.phone) queries.push(`"${business.phone}"`);
  return [...new Set(queries)];
}

export function cityFromAddress(address) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.at(-2).replace(/\s+[A-Z]{2}\s+\d{5}.*/, "");
  return "";
}

export function matchOwnSite(business, results, options = {}) {
  const extraBlockedHosts = options.extraBlockedHosts || [];
  const nameTokens = tokenSet(business.name);
  const nameCompact = compact(business.name);
  const phones = phoneVariants(business.phone);

  for (const result of results) {
    const url = result.url || "";
    const host = hostOf(url);
    if (!host || isNonOwnSite(url, extraBlockedHosts)) continue;

    const haystackDigits = digits(`${result.title || ""} ${result.snippet || ""} ${url}`);
    if (phones.some((p) => haystackDigits.includes(p))) {
      return { found: true, url, match_reason: "phone", result };
    }

    const label = registrableLabel(host);
    const domainTokens = tokenSet(label.replace(/-/g, " "));
    const titleTokens = tokenSet(result.title || "");
    const domainScore = overlapScore(nameTokens, domainTokens);
    const titleScore = overlapScore(nameTokens, titleTokens);
    const labelCompact = compact(label);

    if (
      domainScore >= 0.5 ||
      (titleScore >= 0.67 && domainScore >= 0.34) ||
      (nameCompact.length >= 6 && labelCompact.length >= 6 && (nameCompact.includes(labelCompact) || labelCompact.includes(nameCompact)))
    ) {
      return { found: true, url, match_reason: "name", result };
    }
  }

  return { found: false, url: "", match_reason: "none", result: null };
}

export async function search(provider, query, options = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider "${provider}". Use: ${PROVIDERS.join(", ")}`);
  const apiKey = options.apiKey || process.env[PROVIDER_KEYS[provider]];
  if (!apiKey) throw new Error(`Missing ${PROVIDER_KEYS[provider]}`);

  if (provider === "serper") return searchSerper(apiKey, query, options);
  if (provider === "brave") return searchBrave(apiKey, query, options);
  return searchExa(apiKey, query, options);
}

async function searchSerper(apiKey, query, options) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: options.limit || 10 }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.organic || []).slice(0, options.limit || 10).map((r) => ({
    title: r.title || "",
    url: r.link || "",
    snippet: r.snippet || "",
  }));
}

async function searchBrave(apiKey, query, options) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(options.limit || 10));
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.web?.results || []).slice(0, options.limit || 10).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description || "",
  }));
}

async function searchExa(apiKey, query, options) {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      type: options.exaType || "auto",
      numResults: options.limit || 10,
      contents: { text: false },
    }),
  });
  if (!res.ok) throw new Error(`Exa ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.results || []).slice(0, options.limit || 10).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.text || r.summary || "",
  }));
}

export async function verifyBusinessWebsite(business, provider, options = {}) {
  const queries = buildQueries(business);
  const allResults = [];
  let query_count = 0;

  for (const query of queries) {
    const results = await search(provider, query, { ...options, limit: options.limit || 10 });
    query_count++;
    allResults.push(...results);
    const match = matchOwnSite(business, allResults, options);
    if (match.found) return { ...match, query_count, queries };
  }

  const match = matchOwnSite(business, allResults, options);
  return { ...match, query_count, queries };
}
