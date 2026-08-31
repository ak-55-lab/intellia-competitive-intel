import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { sql } from "@/db/client";
import type { CollectedEvidence, ExtractedClaim, PilotCompetitor } from "@/server/intelligence/pilot-types";

export async function checkPostgresWritable() {
  let sql: postgres.Sql | undefined;
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return false;
    const host = new URL(databaseUrl).hostname;
    sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      ssl: ["localhost", "127.0.0.1"].includes(host) ? undefined : "require"
    });
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql?.end({ timeout: 1 }).catch(() => undefined);
  }
}

export async function persistPilotOutput(input: {
  company: PilotCompetitor;
  competitor: PilotCompetitor;
  evidence: CollectedEvidence[];
  claims: ExtractedClaim[];
}) {
  const postgresReady = await persistToPostgres(input);
  return {
    postgres: postgresReady ? "written" as const : "skipped_unreachable" as const
  };
}

async function persistToPostgres(input: {
  company: PilotCompetitor;
  competitor: PilotCompetitor;
  evidence: CollectedEvidence[];
  claims: ExtractedClaim[];
}) {
  if (!sql) return false;
  try {
    await sql.begin(async (transaction) => {
      const tenantId = await upsertTenant(transaction);
      const companyId = await findOrCreateCompany(transaction, tenantId, input.company);
      const competitorId = await findOrCreateCompetitor(transaction, tenantId, input.competitor);
      const sourceIdByEvidenceId = new Map<string, string>();

      for (const evidence of input.evidence) {
        const sourceId = randomUUID();
        sourceIdByEvidenceId.set(evidence.id, sourceId);
        await transaction`
          insert into sources (id, tenant_id, competitor_id, company_id, url, title, source_type, source_tier, region, authority_score, fetched_at)
          values (${sourceId}, ${tenantId}, ${competitorId}, ${companyId}, ${evidence.url}, ${evidence.title}, ${evidence.sourceType}, ${evidence.sourceTier}, ${evidence.region}, ${evidence.authorityScore}, ${evidence.fetchedAt})
        `;
        await transaction`
          insert into source_snapshots (id, source_id, content, content_hash, fetched_at)
          values (${randomUUID()}, ${sourceId}, ${evidence.content}, ${evidence.contentHash}, ${evidence.fetchedAt})
        `;
      }

      for (const claim of input.claims) {
        const claimId = randomUUID();
        await transaction`
          insert into claims (id, tenant_id, subject_type, subject_id, predicate, value, claim_type, region, confidence, status, first_seen_at)
          values (${claimId}, ${tenantId}, ${"competitor"}, ${competitorId}, ${claim.predicate}, ${claim.value}, ${claim.claimType}, ${claim.region}, ${claim.confidence}, ${claim.status}, now())
        `;
        for (const evidenceId of claim.sourceIds) {
          const sourceId = sourceIdByEvidenceId.get(evidenceId);
          if (sourceId) await transaction`
            insert into claim_sources (id, claim_id, source_id)
            values (${randomUUID()}, ${claimId}, ${sourceId})
          `;
        }
      }
    });
    return true;
  } catch (error) {
    // Preserve the fail-closed evidence gate while making database schema and
    // constraint issues observable without logging SQL values or credentials.
    console.error("Intellia evidence persistence failed", {
      error: error instanceof Error ? error.message : "unknown_error"
    });
    return false;
  }
}

async function upsertTenant(transaction: postgres.TransactionSql) {
  const id = randomUUID();
  const rows = await transaction<{ id: string }[]>`
    insert into tenants (id, name, slug)
    values (${id}, ${"Intellia Default Tenant"}, ${"intellia-default"})
    on conflict (slug) do update set name = excluded.name, updated_at = now()
    returning id
  `;
  return rows[0].id;
}

async function findOrCreateCompany(transaction: postgres.TransactionSql, tenantId: string, company: PilotCompetitor) {
  const existing = await transaction<{ id: string }[]>`select id from companies where tenant_id = ${tenantId} and name = ${company.name} limit 1`;
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  await transaction`insert into companies (id, tenant_id, name, website) values (${id}, ${tenantId}, ${company.name}, ${company.website})`;
  return id;
}

async function findOrCreateCompetitor(transaction: postgres.TransactionSql, tenantId: string, competitor: PilotCompetitor) {
  const existing = await transaction<{ id: string }[]>`select id from competitors where tenant_id = ${tenantId} and name = ${competitor.name} limit 1`;
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  await transaction`
    insert into competitors (id, tenant_id, name, website, segment, summary)
    values (${id}, ${tenantId}, ${competitor.name}, ${competitor.website}, ${competitor.segment}, ${"Collected through Intellia external research."})
  `;
  return id;
}
