import { NextResponse } from "next/server";
import { isRefreshRunning } from "@/server/intelligence/refresh-lock";
import { loadLatestResearchRun } from "@/server/intelligence/research-run-store";
import { currentResearchJobState } from "@/server/intelligence/research-job-state";

export async function GET() {
  const [running, latest] = await Promise.all([isRefreshRunning(), loadLatestResearchRun()]);
  const job = currentResearchJobState();
  return NextResponse.json({
    status: running === true || job.status === "collecting" ? "collecting" : job.status === "failed" ? "failed" : running === false ? "idle" : "unavailable",
    latestRunAt: latest?.generatedAt ?? null,
    latestCompany: latest?.companyName ?? null,
    error: job.status === "failed" ? job.failure : null
  });
}
