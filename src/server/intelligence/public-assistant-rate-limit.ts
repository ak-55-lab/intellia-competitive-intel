import { createHmac, randomUUID } from "node:crypto";
import { sql } from "@/db/client";

export async function registerPublicAssistantRequest(requestIp: string | null) {
  if (!sql || !process.env.INTELLIA_AUTH_SECRET) return false;
  const requestKey = createHmac("sha256", process.env.INTELLIA_AUTH_SECRET).update(requestIp || "unknown").digest("base64url");
  const recent = await sql<{ count: number }[]>`
    select count(*)::int as count from public_assistant_requests
    where request_key = ${requestKey} and created_at > now() - interval '60 minutes'
  `;
  if ((recent[0]?.count ?? 0) >= 10) return false;
  await sql`insert into public_assistant_requests (id, request_key) values (${randomUUID()}, ${requestKey})`;
  return true;
}
