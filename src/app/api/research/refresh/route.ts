import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runLiveResearch } from "@/server/intelligence/live-research-runner";
import { persistResearchRun } from "@/server/intelligence/research-run-store";
import { withRefreshLock } from "@/server/intelligence/refresh-lock";

export const maxDuration = 900;

const refreshSchema = z.object({
  trigger: z.enum(["daily", "event"]).default("daily"),
  event: z.string().min(2).max(160).optional()
});

export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.LIVE_RESEARCH_ENABLED !== "true") {
    return NextResponse.json({ error: "live_research_not_enabled" }, { status: 503 });
  }

  const parsed = refreshSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data;
  const companyName = process.env.SELLER_COMPANY_NAME?.trim();
  const companyWebsite = process.env.SELLER_COMPANY_WEBSITE?.trim();
  if (!companyName || !isHttpsWebsite(companyWebsite)) return NextResponse.json({ error: "seller_configuration_missing" }, { status: 503 });
  let result;
  try {
    result = await withRefreshLock(async () => {
      const run = await runLiveResearch({
        companyName,
        companyWebsite,
        competitorCount: configuredCompetitorCount()
      });
      if (run.dataMode !== "live") return { status: 422, body: { error: "live_coverage_incomplete", trigger: input.trigger, event: input.event } };
      if (!await persistResearchRun(run)) return { status: 503, body: { error: "persistence_failed" } };
      return { status: 200, body: { ok: true, trigger: input.trigger, event: input.event, runId: run.id, generatedAt: run.generatedAt } };
    });
  } catch (error) {
    // Keep provider credentials and raw payloads out of logs while preserving
    // enough operational context to diagnose a failed scheduled collection.
    console.error("Intellia live research refresh failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    return NextResponse.json({ error: "research_collection_failed" }, { status: 502 });
  }
  if (!result.acquired) return NextResponse.json({ error: "refresh_already_running" }, { status: 409 });
  return NextResponse.json(result.value.body, { status: result.value.status });
}

function configuredCompetitorCount() {
  const value = Number(process.env.SELLER_COMPETITOR_COUNT ?? "5");
  return Math.max(1, Math.min(10, Number.isFinite(value) ? Math.trunc(value) : 5));
}

function isAuthorized(header: string | null) {
  const secret = process.env.INTELLIA_REFRESH_SECRET;
  const candidate = header?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isHttpsWebsite(value: string | undefined): value is string {
  try { return new URL(value ?? "").protocol === "https:"; } catch { return false; }
}
