import { sql } from "@/db/client";

export async function withRefreshLock<T>(work: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }> {
  if (!sql) return { acquired: false };
  const connection = await sql.reserve();
  try {
    const rows = await connection<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('intellia_external_intelligence_refresh')) as locked`;
    if (!rows[0]?.locked) return { acquired: false };
    try {
      return { acquired: true, value: await work() };
    } finally {
      await connection`select pg_advisory_unlock(hashtext('intellia_external_intelligence_refresh'))`;
    }
  } finally {
    connection.release();
  }
}

export async function isRefreshRunning() {
  if (!sql) return null;
  const connection = await sql.reserve();
  try {
    const rows = await connection<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('intellia_external_intelligence_refresh')) as locked`;
    if (!rows[0]?.locked) return true;
    await connection`select pg_advisory_unlock(hashtext('intellia_external_intelligence_refresh'))`;
    return false;
  } finally {
    connection.release();
  }
}
