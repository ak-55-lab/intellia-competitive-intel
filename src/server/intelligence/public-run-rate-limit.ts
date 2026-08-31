import { createHmac, randomUUID } from "node:crypto";
import { sql } from "@/db/client";

function maxRunsPerWindow() {
  const configured = Number(process.env.PUBLIC_RESEARCH_RUNS_PER_HOUR ?? "2");
  return Number.isFinite(configured) ? Math.min(20, Math.max(1, Math.trunc(configured))) : 2;
}

export async function registerPublicResearchRequest(requestIp: string | null) {
  if (!sql || !process.env.INTELLIA_AUTH_SECRET) return { allowed: false as const, reason: "unavailable" as const };
  const requestKey = createHmac("sha256", process.env.INTELLIA_AUTH_SECRET).update(requestIp || "unknown").digest("base64url");
  const recent = await sql<{ count: number }[]>`
    select count(*)::int as count from public_research_requests
    where request_key = ${requestKey} and created_at > now() - interval '60 minutes'
  `;
  if ((recent[0]?.count ?? 0) >= maxRunsPerWindow()) {
    return { allowed: false as const, reason: "rate_limited" as const, retryAfterMinutes: 60, maxRunsPerHour: maxRunsPerWindow() };
  }
  const requestId = randomUUID();
  await sql`
    insert into public_research_requests (id, request_key)
    values (${requestId}, ${requestKey})
  `;
  return { allowed: true as const, requestId };
}

export async function releasePublicResearchRequest(requestId: string) {
  if (!sql) return;
  await sql`delete from public_research_requests where id = ${requestId}`;
}
