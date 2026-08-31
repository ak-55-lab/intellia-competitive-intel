import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for migrations");

const sql = postgres(connectionString, { prepare: false });
try {
  await sql`create table if not exists intellia_schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from intellia_schema_migrations`).map((row) => row.name));
  const directory = join(process.cwd(), "drizzle");
  const files = readdirSync(directory).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = readFileSync(join(directory, file), "utf8").split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
    await sql.begin(async (transaction) => {
      for (const statement of statements) await transaction.unsafe(statement);
      await transaction`insert into intellia_schema_migrations (name) values (${file})`;
    });
    console.log(`Applied ${file}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
