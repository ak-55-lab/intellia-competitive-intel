import OpenAI from "openai";
import type { PilotCompetitor } from "@/server/intelligence/pilot-types";

type YouSearchResponse = {
  results?: { web?: YouResult[] };
  web?: YouResult[];
};

type YouResult = {
  url?: string;
  title?: string;
  description?: string;
  snippets?: string[];
};

type FirecrawlResponse = {
  success?: boolean;
  data?: { markdown?: string; title?: string; metadata?: { title?: string } };
};

type CandidateDraft = { name?: unknown; relevance?: unknown; rationale?: unknown; sourceIndexes?: unknown };

export type DiscoveredCompetitor = {
  name: string;
  website: string;
  segment: string;
  regions: string[];
  relevance: number;
  rationale: string;
};

export type CompetitorDiscovery = {
  candidates: DiscoveredCompetitor[];
  searchedQueries: number;
  discoveredAt: string;
};

const excludedHosts = [
  "g2.com", "capterra.com", "trustradius.com", "softwareadvice.com", "getapp.com", "gartner.com",
  "forrester.com", "linkedin.com", "facebook.com", "x.com", "twitter.com", "youtube.com", "wikipedia.org",
  "zoominfo.com", "crunchbase.com", "pitchbook.com", "tracxn.com", "owler.com", "cbinsights.com"
];

export async function discoverCompetitors(input: { company: PilotCompetitor; minimum: number; poolSize?: number }): Promise<CompetitorDiscovery> {
  const poolSize = boundedNumber(input.poolSize ?? Number(process.env.COMPETITOR_DISCOVERY_POOL_SIZE ?? "20"), 20, input.minimum, 30);
  const queries = discoveryQueries(input.company);
  const searchAttempts = await Promise.allSettled(queries.map((query) => searchYou(query, 12)));
  const resultGroups = searchAttempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  const discoveryEvidence = resultGroups.flat().filter((item) => item.url || item.title).slice(0, 80);
  if (discoveryEvidence.length === 0) throw new Error("competitor_discovery_no_search_results");

  const drafts = await selectCandidateNames(input.company, discoveryEvidence, poolSize);
  const focalHost = hostname(input.company.website);
  const candidates = await mapWithConcurrency(drafts, 4, async (draft) => {
    const website = await resolveOfficialWebsite(draft.name, focalHost);
    if (!website) return null;
    return {
      name: draft.name,
      website,
      segment: "Live-discovered competitor",
      regions: ["Global"],
      relevance: draft.relevance,
      rationale: draft.rationale
    } satisfies DiscoveredCompetitor;
  });
  const unique = uniqueCandidates(candidates.filter((candidate): candidate is DiscoveredCompetitor => Boolean(candidate)), focalHost).slice(0, poolSize);
  const verified = await verifySelectedCandidates(unique, input.minimum);
  if (verified.length < input.minimum) throw new Error(`competitor_discovery_insufficient:${verified.length}/${input.minimum}`);

  return { candidates: verified, searchedQueries: resultGroups.length, discoveredAt: new Date().toISOString() };
}

async function verifySelectedCandidates(candidates: DiscoveredCompetitor[], minimum: number) {
  const verified: DiscoveredCompetitor[] = [];
  for (const candidate of candidates) {
    if (await verifyCandidateHomepage(candidate)) verified.push(candidate);
    if (verified.length >= minimum) break;
    await delay(boundedNumber(Number(process.env.FIRECRAWL_MIN_INTERVAL_MS ?? "5500"), 5500, 1000, 60000));
  }
  return verified;
}

async function verifyCandidateHomepage(candidate: DiscoveredCompetitor) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("competitor_discovery_verification_not_configured");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: candidate.website,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 45_000,
        removeBase64Images: true,
        blockAds: true,
        maxAge: 172800000
      })
    });
    if (response.ok) {
      const payload = await response.json() as FirecrawlResponse;
      const page = `${payload.data?.title ?? payload.data?.metadata?.title ?? ""}\n${payload.data?.markdown ?? ""}`.slice(0, 12_000);
      return pageConfirmsBrand(candidate.name, page);
    }
    if (!isRetryableFirecrawlStatus(response.status) || attempt === 4) return false;
    const body = await response.text().catch(() => "");
    await delay(firecrawlRetryDelayMs(response.headers.get("retry-after"), body, attempt));
  }
  return false;
}

function pageConfirmsBrand(name: string, page: string) {
  const normalizedName = normalize(name);
  const normalizedPage = normalize(page);
  if (!normalizedName || !normalizedPage) return false;
  if (normalizedPage.includes(normalizedName)) return true;
  const tokens = normalizedName.split(" ").filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.some((token) => normalizedPage.includes(token));
}

function discoveryQueries(company: PilotCompetitor) {
  const domain = hostname(company.website).replace(/^www\./, "");
  return [
    `"${company.name}" competitors alternatives`,
    `"${company.name}" vs competitors software`,
    `"${company.name}" market landscape competitors`,
    `"${domain}" competitors alternatives`,
    `"${company.name}" products industry market`,
    `"${company.name}" G2 alternatives competitors`,
    `"${company.name}" Capterra alternatives competitors`,
    `"${company.name}" alternative to competitors`
  ];
}

async function searchYou(query: string, count: number): Promise<YouResult[]> {
  const key = process.env.YOUCOM_API_KEY;
  if (!key) throw new Error("competitor_discovery_search_not_configured");
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.you.com/v1/search", {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, count })
    });
    if (response.ok) {
      const payload = await response.json() as YouSearchResponse;
      return payload.results?.web ?? payload.web ?? [];
    }
    const body = await response.text().catch(() => "");
    lastError = `HTTP ${response.status} ${body.slice(0, 160)}`;
    if (response.status !== 429 || attempt === 2) break;
    await delay(800 * (attempt + 1));
  }
  throw new Error(`competitor_discovery_search_failed:${lastError}`);
}

async function selectCandidateNames(company: PilotCompetitor, evidence: YouResult[], limit: number) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await createWithModelFallback(client, [
    "You are the competitor-discovery agent in an external competitive-intelligence system.",
    "Use only the supplied You.com search result titles, URLs, and snippets as evidence.",
    "Identify companies that directly compete with the focal company; do not include review sites, consultancies, marketplaces, parent companies unless they sell the competing product, or the focal company itself.",
    "Return strict JSON only: {\"candidates\":[{\"name\":string,\"relevance\":number,\"rationale\":string,\"sourceIndexes\":number[]}] }.",
    `Return at most ${limit} candidates. relevance is 1-100 and rationale is under 160 characters. Each candidate must cite one or more supplied search-result indexes. Do not invent a company not supported by supplied evidence.`
  ].join("\n"), JSON.stringify({ company: { name: company.name, website: company.website }, searchResults: evidence.map((item, index) => ({ index: index + 1, title: item.title, url: item.url, description: item.description, snippets: item.snippets?.slice(0, 2) })) }));
  const parsed = parseJson(response.output_text);
  const focalName = normalize(company.name);
  return (Array.isArray(parsed.candidates) ? parsed.candidates : [])
    .map((item) => item as CandidateDraft)
    .map((item) => ({
      name: cleanName(item.name),
      relevance: boundedNumber(Number(item.relevance), 50, 1, 100),
      rationale: cleanText(item.rationale, 160),
      sourceIndexes: Array.isArray(item.sourceIndexes) ? item.sourceIndexes.map(Number).filter((index) => Number.isInteger(index) && index >= 1 && index <= evidence.length) : []
    }))
    .filter((item) => item.name.length >= 2 && normalize(item.name) !== focalName && isEvidenceSupportedName(item.name, item.sourceIndexes, evidence))
    .sort((left, right) => right.relevance - left.relevance);
}

function isEvidenceSupportedName(name: string, sourceIndexes: number[], evidence: YouResult[]) {
  if (sourceIndexes.length === 0) return false;
  const tokens = normalize(name).split(" ").filter((token) => token.length > 2);
  return sourceIndexes.some((index) => {
    const item = evidence[index - 1];
    const haystack = `${item?.title ?? ""} ${item?.url ?? ""} ${item?.description ?? ""} ${(item?.snippets ?? []).join(" ")}`.toLowerCase();
    return tokens.some((token) => haystack.includes(token));
  });
}

async function resolveOfficialWebsite(name: string, focalHost: string) {
  const results = await searchYou(`"${name}" software company official website`, 8);
  const tokens = normalize(name).split(" ").filter((token) => token.length > 2);
  const candidates = results.flatMap((result) => {
    if (!result.url || !isAllowedWebsite(result.url, focalHost)) return [];
    const haystack = `${result.title ?? ""} ${result.description ?? ""} ${result.url}`.toLowerCase();
    const host = hostname(result.url);
    const score = officialWebsiteScore(host, haystack, tokens);
    return score > 0 ? [{ url: canonicalWebsite(result.url), score }] : [];
  });
  return candidates.sort((left, right) => right.score - left.score)[0]?.url ?? null;
}

function officialWebsiteScore(host: string, haystack: string, tokens: string[]) {
  const root = host.split(".").slice(-2, -1)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  const compactHost = host.replace(/[^a-z0-9]/g, "");
  return tokens.reduce((score, token) => {
    if (!haystack.includes(token) || !compactHost.includes(token)) return score;
    if (root === token) return score + 12;
    if (compactHost === token) return score + 10;
    if (root.includes(token)) return score + 5;
    return score + 2;
  }, 0);
}

async function createWithModelFallback(client: OpenAI, instructions: string, input: string) {
  const models = [process.env.OPENAI_MODEL, process.env.OPENAI_FALLBACK_MODEL, "gpt-5.6-terra", "gpt-5.4", "gpt-4o-mini"]
    .filter((model, index, all): model is string => Boolean(model) && all.indexOf(model) === index);
  let lastError: unknown;
  for (const model of models) {
    try {
      return await client.responses.create({ model, instructions, input, max_output_tokens: 3500 });
    } catch (error) {
      lastError = error;
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code !== "model_not_found") throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("competitor_discovery_model_unavailable");
}

function uniqueCandidates(candidates: DiscoveredCompetitor[], focalHost: string) {
  const seenNames = new Set<string>();
  const seenHosts = new Set<string>();
  return candidates.filter((candidate) => {
    const name = normalize(candidate.name);
    const host = hostname(candidate.website);
    if (!name || !host || host === focalHost || seenNames.has(name) || seenHosts.has(host)) return false;
    seenNames.add(name); seenHosts.add(host);
    return true;
  }).sort((left, right) => right.relevance - left.relevance);
}

function isAllowedWebsite(value: string, focalHost: string) {
  try {
    const url = new URL(value);
    const host = hostname(value);
    return url.protocol === "https:" && Boolean(host) && host !== focalHost && !excludedHosts.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  } catch { return false; }
}

function canonicalWebsite(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}`;
}

function hostname(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function parseJson(value: string) {
  try { return JSON.parse(value.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()) as { candidates?: unknown[] }; } catch { return {}; }
}

function cleanName(value: unknown) { return cleanText(value, 100).replace(/[\n\r]+/g, " "); }
function cleanText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function boundedNumber(value: number, fallback: number, min: number, max: number) { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback; }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function firecrawlRetryDelayMs(retryAfter: string | null, body: string, attempt: number) {
  const headerSeconds = Number(retryAfter);
  const bodySeconds = Number(/retry after\s+(\d+)s/i.exec(body)?.[1]);
  const requested = Number.isFinite(headerSeconds) ? headerSeconds * 1000 : Number.isFinite(bodySeconds) ? bodySeconds * 1000 : 0;
  return Math.max(5_500, requested, Math.min(2 ** attempt, 30) * 1000 + Math.floor(Math.random() * 1000));
}
function isRetryableFirecrawlStatus(status: number) { return [408, 429, 500, 502, 503, 504].includes(status); }

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) results.push(await worker(item));
    }
  }));
  return results;
}
