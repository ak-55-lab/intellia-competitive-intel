import { buildResearchRun } from "@/lib/research-data";
import { discoverCompetitors } from "@/server/intelligence/competitor-discovery";
import { runSingleCompetitorPilot } from "@/server/intelligence/pilot-runner";
import type { PilotCompetitor } from "@/server/intelligence/pilot-types";

export async function runLiveResearch(input: { companyWebsite: string; companyName: string; competitorCount: number }) {
  if (process.env.LIVE_RESEARCH_ENABLED !== "true") throw new Error("live_research_not_enabled");
  const company: PilotCompetitor = {
    name: input.companyName,
    website: input.companyWebsite,
    segment: "External competitive intelligence target",
    region: "Global"
  };
  const discovery = await discoverCompetitors({ company, minimum: input.competitorCount });
  const candidates = discovery.candidates.slice(0, input.competitorCount);
  if (candidates.length !== input.competitorCount) throw new Error("competitor_discovery_insufficient");
  let deepResearchRemaining = boundedNumber(process.env.DEEP_RESEARCH_MAX_COMPETITORS_PER_RUN, 2, 0, 10);
  const tryAcquireDeepResearch = () => {
    if (deepResearchRemaining < 1) return false;
    deepResearchRemaining -= 1;
    return true;
  };
  // Firecrawl is globally paced in the source collector, so a higher worker
  // count lets independent search, extraction, persistence, and deep-research
  // work overlap without exceeding the scrape provider's plan limit.
  const competitorConcurrency = boundedNumber(process.env.LIVE_RESEARCH_COMPETITOR_CONCURRENCY, 5, 1, 10);
  const outputs = await mapWithConcurrency(candidates, competitorConcurrency, async (candidate) => {
    const result = await runSingleCompetitorPilot({
      company,
      competitor: {
        name: candidate.name,
        website: candidate.website,
        segment: candidate.segment,
        region: candidate.regions[0] ?? "Global"
      },
      writeArtifacts: false,
      tryAcquireDeepResearch
    });
    return result.output;
  });

  const incomplete = outputs.filter((output) => !output.qaReview.passed || output.persistence.postgres !== "written");
  if (incomplete.length > 0) throw new Error(`live_evidence_quality_gate_failed:${incomplete.map((output) => output.competitor.name).join(",")}`);

  return buildResearchRun(input.companyWebsite, input.competitorCount, input.companyName, outputs, candidates, {
    provider: "You.com",
    candidatePoolSize: discovery.candidates.length,
    searchedQueries: discovery.searchedQueries,
    discoveredAt: discovery.discoveredAt
  });
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = [];
  const queue = [...items];
  async function consume() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) results.push(await worker(item));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}
