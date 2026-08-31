import { NextResponse } from "next/server";
import type { SellerProfile } from "@/lib/seller-profile";

export async function GET() {
  const companyName = process.env.SELLER_COMPANY_NAME?.trim();
  const companyWebsite = process.env.SELLER_COMPANY_WEBSITE?.trim();
  if (!companyName || !isHttpsWebsite(companyWebsite)) return NextResponse.json({ error: "seller_configuration_missing" }, { status: 503 });

  return NextResponse.json({
    companyName,
    companyWebsite,
    defaultCompetitorCount: configuredCompetitorCount(),
    primaryMarket: "External competitive intelligence",
    sellerFocus: "Source-backed seller intelligence",
    mode: "live" as const
  } satisfies SellerProfile & { mode: "live" });
}

function configuredCompetitorCount() {
  const value = Number(process.env.SELLER_COMPETITOR_COUNT ?? "3");
  return Math.max(1, Math.min(10, Number.isFinite(value) ? Math.trunc(value) : 3));
}

function isHttpsWebsite(value: string | undefined): value is string {
  try { return new URL(value ?? "").protocol === "https:"; } catch { return false; }
}
