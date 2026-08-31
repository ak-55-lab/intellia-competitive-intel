import { NextResponse } from "next/server";
import { isDeepResearchConfigured } from "@/server/intelligence/deep-research";

export function GET() {
  const missing = [
    ["LIVE_RESEARCH_ENABLED", process.env.LIVE_RESEARCH_ENABLED === "true"],
    ["DATABASE_URL", Boolean(process.env.DATABASE_URL)],
    ["OPENAI_API_KEY", Boolean(process.env.OPENAI_API_KEY)],
    ["FIRECRAWL_API_KEY", Boolean(process.env.FIRECRAWL_API_KEY)],
    ["YOUCOM_API_KEY", Boolean(process.env.YOUCOM_API_KEY)]
  ].filter(([, configured]) => !configured).map(([name]) => name);
  return NextResponse.json({
    ok: true,
    service: "intellia-external-intelligence",
    mode: "production",
    liveResearchReady: missing.length === 0,
    missing,
    deepResearch: {
      configured: isDeepResearchConfigured(),
      provider: process.env.DEEP_RESEARCH_PROVIDER ?? "openai",
      model: process.env.OPENAI_DEEP_RESEARCH_MODEL ?? "o4-mini-deep-research",
      maxCompetitorsPerRun: configuredDeepResearchLimit()
    },
    timestamp: new Date().toISOString()
  });
}

function configuredDeepResearchLimit() {
  const value = Number(process.env.DEEP_RESEARCH_MAX_COMPETITORS_PER_RUN ?? "2");
  return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.trunc(value))) : 2;
}
