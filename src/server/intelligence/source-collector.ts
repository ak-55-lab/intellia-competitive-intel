import type { CollectedEvidence, PilotCompetitor } from "@/server/intelligence/pilot-types";
import { collectDeepResearchEvidence, isDeepResearchConfigured } from "@/server/intelligence/deep-research";
import { sha256 } from "@/server/intelligence/hash";

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    title?: string;
    metadata?: { title?: string; sourceURL?: string };
  };
};

type YouSearchResponse = {
  results?: {
    web?: Array<{ url?: string; title?: string; description?: string; snippets?: string[]; contents?: { markdown?: string } }>;
    news?: Array<{ url?: string; title?: string; description?: string; snippets?: string[]; contents?: { markdown?: string } }>;
  };
  web?: Array<{ url?: string; title?: string; description?: string; snippets?: string[]; contents?: { markdown?: string } }>;
  news?: Array<{ url?: string; title?: string; description?: string; snippets?: string[]; contents?: { markdown?: string } }>;
};

const gtmSkillSearchLanes = [
  {
    name: "Battlecard",
    query: (name: string) => `"${name}" competitors strengths weaknesses objections battlecard`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Competitor positioning",
    query: (name: string) => `"${name}" positioning platform modules industries`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Regional footprint",
    query: (name: string, regions: string[] = []) => `"${name}" regional presence offices customers implementation localization regulatory coverage ${regions.join(" ")}`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Regional contacts and coverage",
    query: (name: string, regions: string[] = []) => `"${name}" contact offices locations countries worldwide ${regions.join(" ")}`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Pricing",
    query: (name: string) => `"${name}" pricing plans packages implementation cost`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Synthetic voice of customer",
    query: (name: string) => `"${name}" reviews G2 Capterra TrustRadius Gartner Peer Insights pros cons`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Brand mention monitor",
    query: (name: string) => `"${name}" latest news acquisition partnership launch customer award`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Partner ecosystem",
    query: (name: string) => `"${name}" partners integrations alliance marketplace system integrator`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Events watch",
    query: (name: string) => `"${name}" event webinar conference summit speaking session`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "AI initiatives",
    query: (name: string) => `"${name}" AI artificial intelligence copilot machine learning patent`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Hiring motion",
    query: (name: string) => `"${name}" careers jobs hiring sales product customer success AI`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Financial and ownership",
    query: (name: string) => `"${name}" revenue earnings funding private equity owner acquisition annual report`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Case study miner",
    query: (name: string) => `"${name}" case study customer story customer success logo`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "Analyst ranking watch",
    query: (name: string) => `"${name}" Verdantix Gartner Magic Quadrant Forrester Wave IDC MarketScape leader`,
    count: 5,
    requireCompetitorMatch: true
  },
  {
    name: "The signal sourcer",
    query: (name: string) => `"${name}" hiring funding expansion product launch partnership regulatory`,
    count: 4,
    requireCompetitorMatch: true
  },
  {
    name: "Community radar",
    query: (name: string) => `"${name}" Reddit forum implementation support user feedback`,
    count: 3,
    requireCompetitorMatch: true
  },
  {
    name: "Market landscape",
    query: (name: string) => `"${name}" platform competitors alternatives`,
    count: 4,
    requireCompetitorMatch: false
  }
];

const firecrawlCache = new Map<string, { expiresAt: number; value: { title: string; content: string } }>();
const firecrawlInflight = new Map<string, Promise<{ title: string; content: string }>>();
let firecrawlQueue: Promise<void> = Promise.resolve();
let nextFirecrawlRequestAt = 0;

export async function collectEvidence(company: PilotCompetitor, competitor: PilotCompetitor, options: { tryAcquireDeepResearch?: () => boolean } = {}) {
  const fetchedAt = new Date().toISOString();
  const evidence: CollectedEvidence[] = [];

  const companySite = await scrapeWithFirecrawl(company.website);
  if (companySite.content) {
    evidence.push(makeEvidence({
      title: companySite.title || company.name,
      url: company.website,
      sourceType: "company_site",
      sourceTier: "A",
      region: company.region,
      fetchedAt,
      content: companySite.content,
      authorityScore: 0.96
    }));
  }

  const competitorSite = await scrapeWithFirecrawl(competitor.website);
  if (competitorSite.content) {
    evidence.push(makeEvidence({
      title: competitorSite.title || competitor.name,
      url: competitor.website,
      sourceType: "competitor_site",
      sourceTier: "A",
      region: competitor.region,
      fetchedAt,
      content: competitorSite.content,
      authorityScore: 0.96
    }));
  }

  const searchBatches: Array<{ lane: string; results: Awaited<ReturnType<typeof searchWithYou>> }> = [];
  const laneFailures: Array<{ lane: string; error: string }> = [];
  for (const lane of gtmSkillSearchLanes) {
    try {
      searchBatches.push({
        lane: lane.name,
        results: await searchWithYou(lane.query(competitor.name, regionalTargetsFor(competitor.region)), lane.count, competitor.name, {
          requireCompetitorMatch: lane.requireCompetitorMatch,
          freshness: recentOnlyLane(lane.name) ? "month" : undefined
        })
      });
    } catch (error) {
      laneFailures.push({ lane: lane.name, error: errorDetail(error) });
    }
    await delay(350);
  }

  const sourceCandidates = selectDiverseSourceCandidates(searchBatches, 18);
  const scrapeLimit = boundedNumber(process.env.FIRECRAWL_MAX_SOURCES_PER_COMPETITOR, 3, 1, 5);
  await Promise.all(sourceCandidates.map(async (item, index) => {
    if (!item.url) return;
    const sourceType = classifySearchSource(item);
    if (sourceType === "review_search" && !primaryFieldsMentionCompetitor(item, competitor.name)) return;
    if (requiresDirectCompetitorPrimary(sourceType) && !primaryFieldsMentionCompetitor(item, competitor.name)) return;
    if (allowsParentCompanyPrimary(sourceType) && !primaryFieldsMentionCompetitorOrParent(item, competitor.name)) return;
    const sourceTier = tierForSourceType(sourceType);
    let scraped: { title: string; content: string } = { title: "", content: "" };
    if (index < scrapeLimit) {
      try {
        scraped = await scrapeWithFirecrawl(item.url);
      } catch (error) {
        laneFailures.push({ lane: `${item.lane} source fetch`, error: errorDetail(error) });
      }
    }
    const sourceContent = scraped.content || item.content || item.description || item.snippets?.join("\n") || "";
    if (!sourceContent.trim()) return;
    evidence.push(makeEvidence({
      title: scraped.title || item.title || item.url,
      url: item.url,
      sourceType,
      sourceTier,
      region: competitor.region,
      fetchedAt,
      content: [`GTM search lane: ${item.lane}`, sourceContent].join("\n\n"),
      authorityScore: authorityForTier(sourceTier)
    }));
  }));

  const deepResearchDecision = decideDeepResearch(evidence, searchBatches.map((batch) => batch.lane));
  if (deepResearchDecision.shouldRun && (options.tryAcquireDeepResearch?.() ?? true)) {
    try {
      const deepResearch = await collectDeepResearchEvidence({ company, competitor, fetchedAt, focusAreas: deepResearchDecision.focusAreas });
      if (deepResearch) evidence.push(deepResearch);
    } catch (error) {
      laneFailures.push({ lane: "Deep Research Agent", error: errorDetail(error) });
    }
  }
  if (laneFailures.length > 0) {
    evidence.push(makeEvidence({
      title: `Search lane warnings: ${competitor.name}`,
      url: `internal://search-lane-warnings/${competitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceType: "web_search",
      sourceTier: "INF",
      region: competitor.region,
      fetchedAt,
      content: laneFailures.map((failure) => `${failure.lane}: ${failure.error}`).join("\n"),
      authorityScore: 0.4
    }));
  }

  return evidence.filter((item) => item.content.trim().length > 0);
}

async function scrapeWithFirecrawl(url: string): Promise<{ title: string; content: string }> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { title: "", content: "" };

  const cached = firecrawlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = firecrawlInflight.get(url);
  if (pending) return pending;

  const task = fetchFirecrawlWithRetries(url, key);
  firecrawlInflight.set(url, task);
  try {
    const value = await task;
    firecrawlCache.set(url, { value, expiresAt: Date.now() + 15 * 60 * 1000 });
    return value;
  } finally {
    firecrawlInflight.delete(url);
  }
}

async function fetchFirecrawlWithRetries(url: string, key: string): Promise<{ title: string; content: string }> {
  let lastError = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await queueFirecrawlRequest(() => fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 60000,
        removeBase64Images: true,
        blockAds: true,
        maxAge: 172800000
      })
    }));

    if (response.ok) {
      const payload = (await response.json()) as FirecrawlScrapeResponse;
      return {
        title: payload.data?.title || payload.data?.metadata?.title || url,
        content: payload.data?.markdown || ""
      };
    }

    const body = await response.text().catch(() => "");
    lastError = `HTTP ${response.status} ${body.slice(0, 200)}`;
    if (!isRetryableFirecrawlStatus(response.status) || attempt === 4) break;
    await delay(firecrawlRetryDelayMs(response.headers.get("retry-after"), body, attempt));
  }
  throw new Error(`Firecrawl scrape failed for ${url}: ${lastError}`);
}

function queueFirecrawlRequest<T>(request: () => Promise<T>): Promise<T> {
  const task = firecrawlQueue.then(async () => {
    const spacing = boundedNumber(process.env.FIRECRAWL_MIN_INTERVAL_MS, 5_500, 1_000, 60_000);
    const wait = Math.max(0, nextFirecrawlRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    nextFirecrawlRequestAt = Date.now() + spacing;
    return request();
  });
  firecrawlQueue = task.then(() => undefined, () => undefined);
  return task;
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function firecrawlRetryDelayMs(retryAfter: string | null, body: string, attempt: number) {
  const headerSeconds = Number(retryAfter);
  const bodySeconds = Number(/retry after\s+(\d+)s/i.exec(body)?.[1]);
  const requested = Number.isFinite(headerSeconds) ? headerSeconds * 1000 : Number.isFinite(bodySeconds) ? bodySeconds * 1000 : 0;
  return Math.max(5_500, requested, Math.min(2 ** attempt, 30) * 1000 + Math.floor(Math.random() * 1000));
}

function isRetryableFirecrawlStatus(status: number) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function searchWithYou(query: string, count: number, competitorName: string, options: { requireCompetitorMatch?: boolean; freshness?: "month" } = {}) {
  const key = process.env.YOUCOM_API_KEY;
  if (!key) return [];

  const response = await fetch("https://api.you.com/v1/search", {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, count, ...(options.freshness ? { freshness: options.freshness } : {}) })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`You.com search failed: HTTP ${response.status} ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as YouSearchResponse;
  const webItems = payload.results?.web ?? payload.web ?? [];
  const newsItems = payload.results?.news ?? payload.news ?? [];
  const web = webItems.map((item) => ({ ...item, kind: "web" as const, content: item.contents?.markdown }));
  const news = newsItems.map((item) => ({ ...item, kind: "news" as const, content: item.contents?.markdown }));
  const competitorToken = competitorName.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((token) => token.length > 2);
  return [...news, ...web].filter((item) => {
    const haystack = `${item.title ?? ""} ${item.description ?? ""} ${item.url ?? ""} ${(item.snippets ?? []).join(" ")}`.toLowerCase();
    const competitorMatch = competitorToken.some((token) => haystack.includes(token));
    return competitorMatch || (!options.requireCompetitorMatch && (haystack.includes("ehs") || haystack.includes("esg")));
  });
}

type SearchResult = Awaited<ReturnType<typeof searchWithYou>>[number];
type LaneSearchResult = SearchResult & { lane: string };

function selectDiverseSourceCandidates(batches: Array<{ lane: string; results: SearchResult[] }>, limit: number) {
  const selected: LaneSearchResult[] = [];
  const seen = new Set<string>();
  let resultIndex = 0;
  while (selected.length < limit) {
    let added = false;
    for (const batch of batches) {
      const item = batch.results[resultIndex];
      if (!item) continue;
      const key = item.url || item.title || "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push({ ...item, lane: batch.lane });
      added = true;
      if (selected.length === limit) break;
    }
    if (!added && batches.every((batch) => batch.results.length <= resultIndex)) break;
    resultIndex += 1;
  }
  return selected;
}

function classifySearchSource(item: SearchResult | LaneSearchResult): CollectedEvidence["sourceType"] {
  if ("lane" in item && (item.lane === "Regional footprint" || item.lane === "Regional contacts and coverage")) return "regional_search";
  const haystack = `${item.kind} ${item.title ?? ""} ${item.description ?? ""} ${item.url ?? ""}`.toLowerCase();
  if (/\b(partner|partners|partnership|alliance|integrations?|marketplace|system integrator|ecosystem)\b/.test(haystack)) return "partner_search";
  if (/\b(event|webinar|conference|summit|speaking|session|expo|forum)\b/.test(haystack)) return "event_search";
  if (/\b(ai|artificial intelligence|copilot|machine learning|patent|automation|agentic)\b/.test(haystack)) return "ai_search";
  if (/\b(careers?|jobs?|hiring|role|roles|sales|customer success|product manager|engineer)\b/.test(haystack)) return "hiring_search";
  if (/\b(revenue|earnings|annual report|funding|private equity|owner|acquisition|investor|financial)\b/.test(haystack)) return "financial_search";
  if (/\b(case stud|customer stor|customer success|customers?|logo)\b/.test(haystack)) return "case_study_search";
  if (/\b(verdantix|gartner|magic quadrant|forrester|wave|idc marketscape|green quadrant|leader|analyst)\b/.test(haystack)) return "ranking_search";
  if (item.kind === "news" || /\b(news|press-release|press release|events?|webinar|launch|acquisition|partnership)\b/.test(haystack)) return "news_search";
  if (/\b(g2\.com|capterra|trustradius|gartner|peerinsights|softwareadvice|getapp)\b/.test(haystack)) return "review_search";
  return "web_search";
}

function primaryFieldsMentionCompetitor(item: SearchResult, competitorName: string) {
  const tokens = competitorName.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((token) => token.length > 2);
  const primary = `${item.title ?? ""} ${item.url ?? ""}`.toLowerCase();
  return tokens.some((token) => primary.includes(token));
}

function primaryFieldsMentionCompetitorOrParent(item: SearchResult, competitorName: string) {
  const aliases = [competitorName, ...(parentAliases[competitorName.toLowerCase()] ?? [])];
  return aliases.some((alias) => primaryFieldsMentionCompetitor(item, alias));
}

function requiresDirectCompetitorPrimary(sourceType: CollectedEvidence["sourceType"]) {
  return sourceType === "partner_search" ||
    sourceType === "event_search" ||
    sourceType === "hiring_search" ||
    sourceType === "case_study_search";
}

function recentOnlyLane(lane: string) {
  return ["Brand mention monitor", "Events watch", "AI initiatives", "Hiring motion", "Financial and ownership", "The signal sourcer"].includes(lane);
}

function regionalTargetsFor(region: string) {
  const targets: Record<string, string[]> = {
    Global: ["North America", "Europe", "APAC"],
    "North America": ["United States", "Canada"],
    EMEA: ["Europe", "Middle East", "Africa"],
    "UK & Ireland": ["United Kingdom", "Ireland"],
    DACH: ["Germany", "Austria", "Switzerland"],
    ANZ: ["Australia", "New Zealand"],
    APAC: ["Asia Pacific", "Australia", "Singapore"],
    Nordics: ["Sweden", "Norway", "Denmark", "Finland"]
  };
  return targets[region] ?? [region];
}

function allowsParentCompanyPrimary(sourceType: CollectedEvidence["sourceType"]) {
  return sourceType === "ai_search" ||
    sourceType === "financial_search" ||
    sourceType === "ranking_search";
}

const parentAliases: Record<string, string[]> = {
  enablon: ["Wolters Kluwer"],
  sphera: ["Blackstone"],
  "benchmark gensuite": ["Benchmark Gensuite", "Vista Equity"],
  velocityehs: ["VelocityEHS", "CVC", "Partners Group"],
  intelex: ["Fortive", "Industrial Scientific"],
  quentic: ["AMCS"],
  ecoonline: ["EcoOnline"],
  isometrix: ["IsoMetrix"]
};

function decideDeepResearch(evidence: CollectedEvidence[], lanes: string[]) {
  const mode = process.env.DEEP_RESEARCH_POLICY ?? "auto";
  if (!isDeepResearchConfigured() || mode === "off") {
    return { shouldRun: false, focusAreas: [] as string[] };
  }
  if (mode === "always") {
    return { shouldRun: true, focusAreas: ["full competitive intelligence sweep"] };
  }

  const requiredSignals: Array<{ label: string; types: CollectedEvidence["sourceType"][]; keywords: string[]; deepWhenMissing: boolean }> = [
    { label: "pricing and packaging", types: ["review_search", "web_search"], keywords: ["pricing", "price", "package", "plan", "cost", "implementation"], deepWhenMissing: true },
    { label: "case studies and customer logos", types: ["case_study_search", "competitor_site"], keywords: ["case stud", "customer story", "customer success", "logo"], deepWhenMissing: false },
    { label: "analyst rankings", types: ["ranking_search"], keywords: ["verdantix", "gartner", "forrester", "idc", "leader", "ranking"], deepWhenMissing: true },
    { label: "partner ecosystem", types: ["partner_search"], keywords: ["partner", "alliance", "integration", "marketplace", "system integrator"], deepWhenMissing: true },
    { label: "events and webinars", types: ["event_search", "news_search"], keywords: ["event", "webinar", "conference", "summit", "speaking"], deepWhenMissing: false },
    { label: "AI initiatives", types: ["ai_search", "ranking_search"], keywords: ["ai", "artificial intelligence", "copilot", "machine learning", "patent"], deepWhenMissing: true },
    { label: "hiring motion", types: ["hiring_search"], keywords: ["hiring", "jobs", "careers", "role", "sales", "customer success"], deepWhenMissing: true },
    { label: "financial and ownership context", types: ["financial_search"], keywords: ["revenue", "earnings", "funding", "private equity", "owner", "acquisition", "annual report"], deepWhenMissing: true },
    { label: "review and community themes", types: ["review_search"], keywords: ["review", "pros", "cons", "g2", "capterra", "trustradius", "peer insights"], deepWhenMissing: true },
    { label: "regional footprint and localization", types: ["regional_search", "competitor_site", "web_search"], keywords: ["regional footprint", "region", "global", "emea", "europe", "north america", "apac", "localization", "localisation"], deepWhenMissing: true }
  ];

  const focusAreas = requiredSignals
    .filter((signal) => signal.deepWhenMissing && !evidence.some((item) => matchesSignal(item, signal.types, signal.keywords)))
    .map((signal) => signal.label);
  const lowRecall = evidence.length < Math.max(10, lanes.length);

  return {
    shouldRun: lowRecall || focusAreas.length >= 3,
    focusAreas: lowRecall ? Array.from(new Set(["low overall evidence recall", ...focusAreas])) : focusAreas
  };
}

function matchesSignal(item: CollectedEvidence, types: CollectedEvidence["sourceType"][], keywords: string[]) {
  if (!types.includes(item.sourceType)) return false;
  if (item.sourceType !== "web_search") return true;
  const haystack = `${item.title} ${item.url} ${item.content}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function tierForSourceType(sourceType: CollectedEvidence["sourceType"]): CollectedEvidence["sourceTier"] {
  if (sourceType === "case_study_search") return "A";
  if (sourceType === "regional_search") return "B";
  if (sourceType === "news_search" || sourceType === "ranking_search" || sourceType === "partner_search" || sourceType === "event_search" || sourceType === "ai_search" || sourceType === "financial_search") return "B";
  if (sourceType === "review_search" || sourceType === "hiring_search") return "C";
  return "D";
}

function authorityForTier(tier: CollectedEvidence["sourceTier"]) {
  if (tier === "A") return 0.9;
  if (tier === "B") return 0.78;
  if (tier === "C") return 0.62;
  if (tier === "INF") return 0.5;
  return 0.45;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorDetail(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}

function makeEvidence(input: Omit<CollectedEvidence, "id" | "contentHash">): CollectedEvidence {
  const contentHash = sha256(`${input.url}\n${input.content}`);
  return {
    ...input,
    id: contentHash.slice(0, 16),
    contentHash
  };
}
