import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadLatestResearchRun, persistResearchRun } from "@/server/intelligence/research-run-store";
import { runLiveResearch } from "@/server/intelligence/live-research-runner";
import { registerPublicResearchRequest, releasePublicResearchRequest } from "@/server/intelligence/public-run-rate-limit";
import { withRefreshLock } from "@/server/intelligence/refresh-lock";
import { markResearchJobCollecting, markResearchJobCompleted, markResearchJobFailed } from "@/server/intelligence/research-job-state";

const publicRunSchema = z.object({
  companyWebsite: z.string().trim().url().max(2048),
  companyName: z.string().trim().min(2).max(120).optional(),
  competitorCount: z.number().int().min(1).max(10).default(3)
});

// A top-10 live research run can legitimately need more than the default
// serverless window while providers pace and verify evidence.
export const maxDuration = 900;

export async function GET() {
  try {
    const persisted = await loadLatestResearchRun();
    if (persisted?.dataMode === "live" && isFresh(persisted.generatedAt)) return NextResponse.json(persisted);
    if (persisted) return NextResponse.json({ run: null, stale: true });
  } catch {
    // Database outages must not return stale filesystem artifacts in production.
  }
  return NextResponse.json({ run: null });
}

export async function POST(request: NextRequest) {
  const parsed = publicRunSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isSafePublicWebsite(parsed.data.companyWebsite)) {
    return NextResponse.json({ error: "invalid_public_website" }, { status: 400 });
  }
  const missingProviders = missingLiveProviders();
  if (missingProviders.length > 0) return NextResponse.json({ error: "live_research_not_configured", missing: missingProviders }, { status: 503 });
  const limit = await registerPublicResearchRequest(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
  if (!limit.allowed) {
    const status = limit.reason === "rate_limited" ? 429 : 503;
    return NextResponse.json({
      error: limit.reason === "rate_limited" ? "public_run_rate_limited" : "public_runs_unavailable",
      retryAfterMinutes: limit.reason === "rate_limited" ? limit.retryAfterMinutes : undefined,
      maxRunsPerHour: limit.reason === "rate_limited" ? limit.maxRunsPerHour : undefined
    }, { status });
  }
  const input = parsed.data;
  const companyName = input.companyName || new URL(input.companyWebsite).hostname.replace(/^www\./, "");
  markResearchJobCollecting();
  void (async () => {
    let completed = false;
    try {
      const result = await withRefreshLock(async () => runLiveResearch({
        companyWebsite: input.companyWebsite,
        companyName,
        competitorCount: input.competitorCount
      }));
      if (!result.acquired) throw new Error("research_already_running");
      if (result.value.dataMode !== "live") throw new Error("live_coverage_incomplete");
      if (!await persistResearchRun(result.value)) throw new Error("research_persistence_failed");
      completed = true;
      markResearchJobCompleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      console.error("Intellia public research run failed", { error: message });
      markResearchJobFailed(publicJobFailure(message));
    } finally {
      if (!completed) await releasePublicResearchRequest(limit.requestId).catch(() => undefined);
    }
  })();
  return NextResponse.json({ status: "collecting" }, { status: 202 });
}

function publicJobFailure(message: string) {
  if (message.startsWith("evidence_collection_gate_failed") || message.startsWith("live_evidence_quality_gate_failed") || message.startsWith("live_persistence_coverage_incomplete") || message.startsWith("live_output_coverage_incomplete") || message === "live_coverage_incomplete") return "live_coverage_incomplete";
  if (message.startsWith("competitor_discovery_")) return "competitor_discovery_failed";
  if (message.includes("Firecrawl scrape failed") || message.includes("Rate limit exceeded")) return "research_provider_throttled";
  if (message === "research_already_running") return "research_already_running";
  return "research_collection_failed";
}

function isSafePublicWebsite(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || isIP(hostname)) return false;
    return hostname !== "localhost" && !hostname.endsWith(".localhost") && !hostname.endsWith(".local") && !hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

function isFresh(generatedAt: string) {
  const generated = Date.parse(generatedAt);
  const configuredHours = Number(process.env.EXTERNAL_INTELLIGENCE_MAX_AGE_HOURS ?? "36");
  const maxAgeHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 36;
  return Number.isFinite(generated) && Date.now() - generated <= maxAgeHours * 60 * 60 * 1000;
}

function missingLiveProviders() {
  const required: Array<[string, string | undefined]> = [
    ["LIVE_RESEARCH_ENABLED", process.env.LIVE_RESEARCH_ENABLED === "true" ? "true" : undefined],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["FIRECRAWL_API_KEY", process.env.FIRECRAWL_API_KEY],
    ["YOUCOM_API_KEY", process.env.YOUCOM_API_KEY],
    ["INTELLIA_AUTH_SECRET", process.env.INTELLIA_AUTH_SECRET]
  ];
  return required.filter(([, value]) => !value?.trim()).map(([name]) => name);
}
