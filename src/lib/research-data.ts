import type { ResearchCompetitor, ResearchRun } from "@/types/research";

const leverNames = ["Competitive Fit", "Product Breadth", "Customer Proof", "AI / Innovation", "Seller Risk"];

type ResearchCandidate = { name: string; website: string; segment: string; regions: string[] };

export function buildResearchRun(companyWebsite: string, requestedCompetitors: number, companyName: string | undefined, liveOutputs: LiveOutput[], candidates: ResearchCandidate[], discovery: ResearchRun["discovery"]): ResearchRun {
  const requestedCandidates = candidates.slice(0, requestedCompetitors);
  if (requestedCandidates.length !== requestedCompetitors || liveOutputs.length !== requestedCompetitors) throw new Error("live_output_coverage_incomplete");
  const competitors = requestedCandidates.map((item, index) => {
    const id = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const liveOutput = liveOutputs.find((output) => output.competitor.name.toLowerCase() === item.name.toLowerCase());
    if (!liveOutput) throw new Error(`live_output_missing:${item.name}`);
    const liveEvidenceSources = liveOutput.evidence.slice(0, 5).map((evidence) => ({
      title: evidence.title,
      url: evidence.url,
      tier: evidence.sourceTier,
      sourceType: evidence.sourceType
    }));
    const positioningSources = sourcesForNode(liveOutput, ["competitor_site", "company_site", "web_search", "deep_research"], 5);
    const pricingSources = sourcesForNode(liveOutput, ["review_search", "web_search", "competitor_site", "deep_research"], 5, ["pricing", "plans", "packages", "cost"]);
    const featureSources = sourcesForNode(liveOutput, ["competitor_site", "web_search", "case_study_search", "deep_research"], 5);
    const rankingSources = sourcesForNode(liveOutput, ["ranking_search", "review_search", "web_search", "deep_research"], 5, ["verdantix", "gartner", "forrester", "leader", "ranking"]);
    const objectionSources = sourcesForNode(liveOutput, ["review_search", "web_search", "competitor_site", "deep_research"], 5, ["review", "implementation", "support", "weakness", "objection"]);
    const marketSignalSources = sourcesForNode(liveOutput, ["partner_search", "event_search", "ai_search", "hiring_search", "financial_search", "ranking_search", "news_search", "deep_research"], 8);
    const regionalSources = sourcesForNode(liveOutput, ["regional_search", "deep_research"], 8);
    const regionalDetails = regionalDetailsFor(regionalSources, item.regions);
    const liveNews = extractNewsItems(liveOutput, item.name);
    const caseStudies = extractCaseStudyItems(liveOutput, item.name);
    const newsInsightItems = liveNews.map((news, newsIndex) => ({
      id: `${id}-news-item-${newsIndex}`,
      title: news.title,
      category: "News",
      date: news.isoDate,
      urgency: urgencyForDate(news.isoDate, "news_search"),
      summary: news.summary,
      sellerImplication: sellerImplicationFor("news_search", news.title, item.name),
      sources: [{ title: news.sourceTitle, url: news.url, tier: news.tier, sourceType: "news_search" }]
    })).sort(sortInsightItems);
    const marketInsightItems = extractMarketSignals(marketSignalSources, item.name, companyName);
    const marketSignals = marketInsightItems.map((signal) => `${signal.category}: ${signal.title}`);
    const liveFeatureClaims = liveOutput.claims
      .filter((claim) => claim.claimType.includes("competitor") || claim.predicate.toLowerCase().includes(item.name.toLowerCase()))
      .map((claim) => claim.value)
      .slice(0, 5);
    const pricingSignals = liveOutput.battlecardDraft.pricingSignals.filter(Boolean);
    const objections = liveOutput.battlecardDraft.likelyObjections
      .flatMap((objection) => [objection.objection, objection.sayThis])
      .filter(Boolean)
      .slice(0, 4);
    const battlecard = {
      snapshot: liveOutput.battlecardDraft.snapshot,
      questionsToAsk: liveOutput.battlecardDraft.questionsToAsk,
      likelyObjections: liveOutput.battlecardDraft.likelyObjections,
      sourceWarnings: liveOutput.battlecardDraft.sourceWarnings,
      evidenceCount: liveOutput.evidence.length,
      qaScore: liveOutput.qaReview?.score
    };

    return {
      id,
      name: item.name,
      website: item.website,
      rank: index + 1,
      category: item.segment,
      headline: `Latest source-backed external intelligence for ${item.name}.`,
      sellerPositioning: liveOutput.battlecardDraft.positioning || "No source-backed positioning statement was extracted in this run.",
      battlecard,
      pricing: {
        signal: pricingSignals[0] || "No source-backed public pricing signal was extracted in this run.",
        confidence: pricingSignals.length > 0 ? "Moderate" : "Unknown",
        notes: pricingSignals.length > 0 ? pricingSignals : ["No source-backed public pricing details were available in the latest collection."]
      },
      levers: leverNames.map((name) => {
        const score = 0;
        return {
          name,
          score,
          label: "Unknown",
          rationale: "Qualitative seller guidance is shown only with linked evidence; no unsupported strength score is emitted."
        };
      }),
      regions: item.regions.map((region) => ({
        region,
        countries: countriesFor(region),
        strength: "Unknown",
        note: regionalNoteFor(region, regionalSources)
      })),
      contextNodes: [
        {
          id: `${id}-positioning`,
          type: "positioning",
          title: "Positioning",
          sellerImportance: "Use this to frame the first competitive conversation.",
          details: [liveOutput.battlecardDraft.positioning || "No source-backed positioning statement was extracted in this run."],
          newSignals: signalCount(positioningSources),
          trace: traceForNode("Positioning", liveOutput, positioningSources),
          sources: positioningSources
        },
        {
          id: `${id}-pricing`,
          type: "pricing",
          title: "Pricing",
          sellerImportance: "Prevents unsupported pricing claims.",
          details: [
            ...(pricingSignals.length > 0 ? pricingSignals : ["No source-backed public pricing details were available in the latest collection."]),
            ...(caseStudies.length > 0 ? [`Related proof points: ${caseStudies.slice(0, 2).map((study) => study.title).join("; ")}`] : [])
          ],
          newSignals: signalCount(pricingSources),
          trace: traceForNode("Pricing", liveOutput, pricingSources),
          sources: pricingSources
        },
        {
          id: `${id}-features`,
          type: "features",
          title: "Core Components",
          sellerImportance: "Shows the 3-5 levers to pressure-test in a deal.",
          details: [
            ...(liveFeatureClaims.length > 0 ? liveFeatureClaims : ["No source-backed component claims were extracted in this run."]),
            ...(caseStudies.length > 0 ? [`Case study/logo signals: ${caseStudies.map((study) => study.title).slice(0, 3).join("; ")}`] : [])
          ],
          newSignals: signalCount(featureSources) + caseStudies.length,
          trace: traceForNode("Core Components", liveOutput, featureSources),
          sources: featureSources
        },
        {
          id: `${id}-news`,
          type: "news",
          title: "Recent News",
          sellerImportance: "Gives sellers a current-event hook without overstating the account impact.",
          details: liveNews.length > 0 ? liveNews.map((item) => `${item.date ? `${item.date}: ` : ""}${item.title}`) : ["No sourced recent news found in the latest live pull."],
          insightItems: newsInsightItems,
          newSignals: liveNews.length,
          trace: traceForNode("Recent News", liveOutput, liveNews.map((item) => ({ title: item.sourceTitle, url: item.url, tier: item.tier, sourceType: "news_search" }))),
          sources: liveNews.length > 0 ? liveNews.map((item) => ({ title: item.sourceTitle, url: item.url, tier: item.tier, sourceType: "news_search" })) : liveEvidenceSources
        },
        {
          id: `${id}-regions`,
          type: "regions",
          title: "Regional Context",
          sellerImportance: "Use region to avoid global claims that do not fit the buyer.",
          details: regionalDetails,
          newSignals: signalCount(regionalSources),
          trace: traceForNode("Regional Context", liveOutput, regionalSources),
          sources: regionalSources
        },
        {
          id: `${id}-signals`,
          type: "signals",
          title: "Market Signals",
          sellerImportance: "Shows the movements sellers should know before positioning against this competitor.",
          details: marketSignals.length > 0 ? marketSignals : [
            "No partner, event, AI, hiring, financial, or analyst signal survived the latest relevance filters."
          ],
          insightItems: marketInsightItems,
          newSignals: signalCount(marketSignalSources),
          trace: traceForNode("Market Signals", liveOutput, marketSignalSources),
          sources: marketSignalSources
        },
        {
          id: `${id}-objections`,
          type: "objections",
          title: "Likely Objections",
          sellerImportance: "Turns competitor strength into discovery questions.",
          details: [
            ...(objections.length > 0 ? objections : ["No source-backed objection or response was extracted in this run."]),
            ...(rankingSources.length > 0 ? [`Analyst/review signal: ${rankingSources[0].title}`] : [])
          ].filter(Boolean),
          newSignals: signalCount(objectionSources) + signalCount(rankingSources),
          trace: traceForNode("Likely Objections", liveOutput, objectionSources),
          sources: uniqueSourceList([...objectionSources, ...rankingSources])
        }
      ]
    } satisfies ResearchCompetitor;
  });

  const coveredCompetitors = competitors.filter((competitor) => {
    const output = liveOutputs.find((item) => item.competitor.name.toLowerCase() === competitor.name.toLowerCase());
    return Boolean(output && output.qaReview?.passed && output.persistence?.postgres === "written");
  }).length;
  if (coveredCompetitors !== competitors.length) throw new Error("live_persistence_coverage_incomplete");

  return {
    id: `research-${Date.now()}`,
    companyWebsite,
    companyName: companyName?.trim() || new URL(companyWebsite).hostname.replace(/^www\./, ""),
    requestedCompetitors,
    discovery,
    dataMode: "live",
    generatedAt: new Date().toISOString(),
    competitors
  };
}

type LiveOutput = {
  competitor: { name: string };
  evidence: Array<{ title: string; url: string; sourceTier: string; sourceType: string; content: string }>;
  claims: Array<{ predicate: string; value: string; claimType: string }>;
  battlecardDraft: {
    snapshot: string[];
    positioning: string;
    likelyObjections: Array<{ objection: string; reframe: string; sayThis: string }>;
    questionsToAsk: string[];
    pricingSignals: string[];
    sourceWarnings: string[];
  };
  qaReview?: { passed: boolean; score: number };
  persistence?: { postgres: "written" | "skipped_unreachable" };
};


type NodeSource = { title: string; url: string; tier: string; sourceType?: string; lane?: string; date?: string; snippet?: string };

function sourcesForNode(output: LiveOutput, sourceTypes: string[], limit: number, keywords: string[] = []): NodeSource[] {
  const lowerKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const matches = output.evidence.filter((evidence) => {
    const typeMatch = sourceTypes.includes(evidence.sourceType);
    if (!typeMatch) return false;
    if (lowerKeywords.length === 0) return true;
    const haystack = `${evidence.title} ${evidence.url} ${evidence.content}`.toLowerCase();
    return lowerKeywords.some((keyword) => haystack.includes(keyword));
  });

  return uniqueSourceList(matches.map((evidence) => ({
    title: evidence.title,
    url: evidence.url,
    tier: evidence.sourceTier,
    sourceType: evidence.sourceType,
    lane: extractLane(evidence.content),
    date: extractIsoDate(`${evidence.title}\n${evidence.content}`),
    snippet: compactSnippet(evidence.content)
  }))).slice(0, limit);
}

function signalCount(sources: NodeSource[]) {
  return sources.filter((source) => source.tier !== "D").length || sources.length;
}

function regionalDetailsFor(sources: NodeSource[], configuredRegions: string[]) {
  if (sources.length === 0) return ["No source-backed regional coverage conclusion was extracted in this run."];
  return sources.slice(0, 5).map((source) => {
    const excerpt = source.snippet || source.title;
    return `Regional retrieval (${source.tier}): ${excerpt}`;
  });
}

function regionalNoteFor(region: string, sources: NodeSource[]) {
  const normalized = region.toLowerCase();
  const matching = sources.find((source) => `${source.title} ${source.snippet ?? ""}`.toLowerCase().includes(normalized));
  if (matching) return `Relevant regional evidence retrieved: ${matching.title}. Confirm country-specific hosting, language, support, and regulatory fit in discovery.`;
  if (sources.length > 0) return `Regional retrieval completed. Confirm ${region} country-level coverage, hosting, language, support, and regulatory fit in discovery.`;
  return "No source-backed regional coverage conclusion was extracted in this run.";
}

function traceForNode(nodeName: string, output: LiveOutput, sources: NodeSource[]) {
  return [
    { step: "Discovery", status: "found" as const, detail: `Matched latest live run for ${output.competitor.name}.` },
    {
      step: "Search",
      status: sources.length > 0 ? "found" as const : "not_found" as const,
      detail: sources.length > 0 ? `${sources.length} relevant source${sources.length === 1 ? "" : "s"} mapped to ${nodeName}.` : `No source survived relevance filters for ${nodeName}.`,
      input: Array.from(new Set(sources.map((source) => source.lane || source.sourceType || "source"))).join(", ") || `${nodeName} retrieval lane`,
      output: sources.map((source) => source.title).slice(0, 4).join("\n") || "No usable output."
    },
    {
      step: "Extraction",
      status: output.claims.length > 0 ? "found" as const : "needs_review" as const,
      detail: `${output.claims.length} sourced claim${output.claims.length === 1 ? "" : "s"} available in the live artifact.`,
      input: "Source excerpts, source tiers, source IDs",
      output: output.claims.map((claim) => `${claim.predicate}: ${claim.value}`).slice(0, 3).join("\n") || "No claims extracted."
    },
    { step: "QA", status: "found" as const, detail: "QA gate passed before this artifact was exposed to the graph.", input: "Evidence coverage, seller usefulness, usability", output: "Approved for graph display with source warnings." }
  ];
}

function uniqueSourceList(sources: NodeSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url || source.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractNewsItems(output: LiveOutput, competitorName: string) {
  const datePattern = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}$/;
  const items: Array<{ title: string; date: string; isoDate: string; summary: string; url: string; sourceTitle: string; tier: string }> = [];
  const candidateEvidence = output.evidence.filter((evidence) =>
    evidence.sourceType === "news_search" ||
    evidence.sourceType === "event_search" ||
    evidence.sourceType === "ai_search" ||
    evidence.sourceType === "competitor_site" ||
    evidence.title.toLowerCase().includes("news")
  );

  for (const evidence of candidateEvidence) {
    const lines = evidence.content.split("\n").map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!datePattern.test(line)) continue;
      const title = lines.slice(index + 1, index + 8)
        .map((candidate) => candidate.replace(/^#+\s*/, "").replace(/^\[[^\]]*]\(([^)]+)\)$/, "$1"))
        .find((candidate) =>
          candidate.length > 8 &&
          candidate.length < 160 &&
          !candidate.startsWith("http") &&
          !candidate.toLowerCase().includes("learn more")
        );
      if (!title) continue;
      items.push({
        title,
        date: line,
        isoDate: extractIsoDate(line) ?? "",
        summary: summarizeEvidence(evidence.content, title),
        url: evidence.url,
        sourceTitle: evidence.title || competitorName,
        tier: evidence.sourceTier
      });
    }
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}:${item.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (Date.parse(b.isoDate || b.date) || 0) - (Date.parse(a.isoDate || a.date) || 0)).slice(0, 6);
}

function extractCaseStudyItems(output: LiveOutput, competitorName: string) {
  const items: Array<{ title: string; url: string; tier: string }> = [];
  const candidateEvidence = output.evidence.filter((evidence) => {
    const haystack = `${evidence.title} ${evidence.url} ${evidence.content}`.toLowerCase();
    return evidence.sourceType === "case_study_search" ||
      haystack.includes("case stud") ||
      haystack.includes("customer story") ||
      haystack.includes("customer stories") ||
      haystack.includes("customer success");
  });

  for (const evidence of candidateEvidence) {
    items.push({
      title: evidence.title || `${competitorName} customer proof`,
      url: evidence.url,
      tier: evidence.sourceTier
    });
  }

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function extractMarketSignals(sources: NodeSource[], competitorName: string, companyName?: string) {
  const grouped = new Map<string, {
    id: string;
    title: string;
    category: string;
    date?: string;
    urgency: "Urgent" | "This Quarter" | "Monitor";
    summary: string;
    sellerImplication: string;
    sources: NodeSource[];
  }>();
  for (const source of sources) {
    const label = signalLabel(source.sourceType);
    if (grouped.has(label)) continue;
    grouped.set(label, {
      id: `${competitorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: source.title,
      category: label,
      date: source.date,
      urgency: urgencyForSignal(source),
      summary: source.snippet || source.title,
      sellerImplication: sellerImplicationFor(source.sourceType, source.title, competitorName, companyName),
      sources: [source]
    });
  }
  return Array.from(grouped.values()).sort(sortInsightItems).slice(0, 6);
}

function signalLabel(sourceType?: string) {
  if (sourceType === "partner_search") return "Partners";
  if (sourceType === "event_search") return "Events";
  if (sourceType === "ai_search") return "AI initiatives";
  if (sourceType === "hiring_search") return "Hiring";
  if (sourceType === "financial_search") return "Financial / ownership";
  if (sourceType === "ranking_search") return "Analyst ranking";
  if (sourceType === "news_search") return "News";
  if (sourceType === "deep_research") return "Deep research";
  return "Market signal";
}

function sortInsightItems(a: { date?: string; urgency: string }, b: { date?: string; urgency: string }) {
  const dateDelta = (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0);
  if (dateDelta !== 0) return dateDelta;
  return urgencyWeight(a.urgency) - urgencyWeight(b.urgency);
}

function urgencyWeight(value: string) {
  if (value === "Urgent") return 0;
  if (value === "This Quarter") return 1;
  return 2;
}

function urgencyForSignal(source: NodeSource): "Urgent" | "This Quarter" | "Monitor" {
  const dateUrgency = urgencyForDate(source.date, source.sourceType);
  if (dateUrgency !== "Monitor") return dateUrgency;
  if (source.sourceType === "ai_search" || source.sourceType === "ranking_search" || source.sourceType === "financial_search") return "Urgent";
  return "Monitor";
}

function urgencyForDate(value: string | undefined, sourceType?: string): "Urgent" | "This Quarter" | "Monitor" {
  if (!value) return "Monitor";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Monitor";

  const now = new Date();
  const isFuture = date.getTime() > now.getTime();
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  const sameQuarter = sameYear && Math.floor(date.getUTCMonth() / 3) === Math.floor(now.getUTCMonth() / 3);
  if (sameQuarter) return sourceType === "news_search" ? "This Quarter" : "Urgent";

  const ageDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (!isFuture && ageDays <= 45 && (sourceType === "ai_search" || sourceType === "ranking_search" || sourceType === "financial_search")) return "Urgent";
  if (!isFuture && ageDays <= 90) return "This Quarter";
  return "Monitor";
}

function sellerImplicationFor(sourceType: string | undefined, title: string, competitorName: string, companyName = "your company") {
  if (sourceType === "ai_search") return `${competitorName}'s AI motion may shape buyer expectations. Validate ${companyName}'s governance, auditability, and workflow-control proof before positioning.`;
  if (sourceType === "ranking_search") return `Analyst validation can enter executive evaluation. Prepare ${companyName} proof points before this appears in a buying committee.`;
  if (sourceType === "partner_search") return `Partner or integration motion can affect implementation confidence. Ask which ecosystem dependencies matter to the buyer.`;
  if (sourceType === "event_search") return `Event activity can create outreach hooks and announce roadmap direction. Use it as context, not a claim of buyer impact.`;
  if (sourceType === "hiring_search") return `Hiring can indicate where ${competitorName} is investing. Watch sales, CS, product, AI, and regional roles.`;
  if (sourceType === "financial_search") return `Ownership or financial signals can affect roadmap, sales pressure, and M&A posture. Keep ${companyName} positioned around buyer outcomes.`;
  if (sourceType === "news_search") return `Use this as a current-event hook, then connect back to the buyer's EHS, ESG, risk, or operational workflow.`;
  return `Seller relevance should be validated against the deal context before using this signal in outreach: ${title}`;
}

function extractLane(content: string) {
  return content.match(/GTM search lane: ([^\n]+)/)?.[1]?.trim();
}

function compactSnippet(content: string) {
  const cleaned = content
    .replace(/GTM search lane: [^\n]+\n*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 30 && !line.startsWith("http"))
    .join(" ");
  return cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
}

function summarizeEvidence(content: string, title: string) {
  const snippet = compactSnippet(content);
  return snippet || title;
}

function extractIsoDate(value: string) {
  const direct = value.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0];
  if (direct) return direct;
  const named = value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/)?.[0];
  if (!named) return undefined;
  const parsed = new Date(named);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function countriesFor(region: string) {
  const map: Record<string, string[]> = {
    Global: ["US", "Canada", "UK", "EU", "Australia"],
    "North America": ["US", "Canada"],
    EMEA: ["UK", "Germany", "France", "Netherlands"],
    "UK & Ireland": ["UK", "Ireland"],
    DACH: ["Germany", "Austria", "Switzerland"],
    ANZ: ["Australia", "New Zealand"],
    APAC: ["Singapore", "Japan", "Australia"],
    Nordics: ["Sweden", "Norway", "Denmark", "Finland"]
  };
  return map[region] ?? [region];
}
