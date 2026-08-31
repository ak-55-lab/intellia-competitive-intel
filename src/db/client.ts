import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

export const sql = connectionString
  ? postgres(connectionString, { prepare: false })
  : null;

export const db = sql ? drizzle(sql) : null;
