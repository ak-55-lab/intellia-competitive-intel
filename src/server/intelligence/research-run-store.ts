import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { sql } from "@/db/client";
import type { ResearchRun } from "@/types/research";

const tenantName = "Intellia Default Tenant";
const tenantSlug = "intellia-default";

export async function loadLatestResearchRun(): Promise<ResearchRun | null> {
  if (!sql) return null;
  try {
    const rows = await sql<{ payload: ResearchRun }[]>`
      select payload from research_runs order by generated_at desc limit 1
    `;
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

export async function persistResearchRun(run: ResearchRun) {
  if (!sql) return false;
  try {
    await sql.begin(async (transaction) => {
      const tenantId = await ensureTenant(transaction);
      await transaction`
        insert into research_runs (id, tenant_id, company_website, company_name, data_mode, generated_at, payload)
        values (${run.id}, ${tenantId}, ${run.companyWebsite}, ${run.companyName}, ${run.dataMode}, ${run.generatedAt}, ${JSON.stringify(run)}::jsonb)
        on conflict (id) do update set data_mode = excluded.data_mode, generated_at = excluded.generated_at, payload = excluded.payload, updated_at = now()
      `;
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureTenant(transaction: postgres.TransactionSql) {
  const rows = await transaction<{ id: string }[]>`
    insert into tenants (id, name, slug)
    values (${randomUUID()}, ${tenantName}, ${tenantSlug})
    on conflict (slug) do update set name = excluded.name, updated_at = now()
    returning id
  `;
  return rows[0].id;
}
