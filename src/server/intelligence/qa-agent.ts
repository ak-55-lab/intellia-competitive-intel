import type { BattlecardDraft, CollectedEvidence, ExtractedClaim } from "@/server/intelligence/pilot-types";

export function vetResearchOutput(input: {
  evidence: CollectedEvidence[];
  claims: ExtractedClaim[];
  battlecardDraft: BattlecardDraft;
}) {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const sourceIds = new Set(input.evidence.map((item) => item.id));
  const sourcedClaims = input.claims.filter((claim) => claim.sourceIds.some((id) => sourceIds.has(id)));
  const hasAuthority = input.evidence.some((item) => item.sourceTier === "A" || item.sourceTier === "B");
  const hasPricing = input.battlecardDraft.pricingSignals.some((signal) => isSubstantivePricingSignal(signal));
  const hasSellerActions = input.battlecardDraft.questionsToAsk.length > 0 && input.battlecardDraft.likelyObjections.length > 0;
  const hasRegionalEvidence = input.evidence.some((item) => item.sourceType === "regional_search" || item.sourceType === "deep_research");

  if (input.evidence.length < 3) issues.push("Evidence set is thin; collect at least company site, competitor site and market/news context.");
  if (!hasAuthority) issues.push("No tier A/B source found; seller guidance needs higher-authority evidence.");
  if (input.claims.length === 0) issues.push("No extracted claims were produced.");
  if (sourcedClaims.length < input.claims.length) issues.push("Some claims do not reference collected evidence.");
  if (!hasPricing) recommendations.push("Pricing node should remain cautious until public pricing or procurement context is collected.");
  if (!hasSellerActions) issues.push("Seller usability is weak without objections and discovery questions.");
  if (!hasRegionalEvidence) issues.push("No source-backed regional-footprint evidence was collected.");
  if (input.battlecardDraft.positioning.length < 60) issues.push("Positioning summary is too short to be useful in a deal.");

  const uniqueUrls = new Set(input.evidence.map((item) => item.url)).size;
  const sourceTypes = new Set(input.evidence.map((item) => item.sourceType)).size;
  const attributedClaimRatio = input.claims.length === 0 ? 0 : sourcedClaims.length / input.claims.length;
  const authorityCoverage = average(input.evidence.map((item) => authorityWeight(item.sourceTier)));
  const evidenceCoverage = average([
    Math.min(1, uniqueUrls / 12),
    Math.min(1, sourceTypes / 6),
    authorityCoverage,
    hasRegionalEvidence ? 1 : 0
  ]);
  const usefulness = average([
    input.battlecardDraft.snapshot.length >= 3 ? 1 : 0.5,
    input.battlecardDraft.positioning.length >= 60 ? 1 : 0.4,
    hasPricing ? 1 : 0.75
  ]);
  const usability = average([
    input.battlecardDraft.likelyObjections.length > 0 ? 1 : 0,
    input.battlecardDraft.questionsToAsk.length > 0 ? 1 : 0,
    input.battlecardDraft.sourceWarnings.length === 0 ? 1 : input.battlecardDraft.sourceWarnings.length <= 3 ? 0.85 : 0.6
  ]);
  const score = Math.round((
    evidenceCoverage * 0.35 +
    attributedClaimRatio * 0.25 +
    usefulness * 0.25 +
    usability * 0.15
  ) * 100);

  if (score < 70) recommendations.push("Do not advance to seller-facing use without another evidence pass.");
  if (recommendations.length === 0) recommendations.push("Output is suitable for PM review with evidence-linked claims.");

  return {
    passed: score >= 70 && issues.length === 0,
    score,
    evidenceCoverage: Math.round(evidenceCoverage * 100),
    usefulness: Math.round(usefulness * 100),
    usability: Math.round(usability * 100),
    issues,
    recommendations
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function authorityWeight(tier: CollectedEvidence["sourceTier"]) {
  if (tier === "A") return 1;
  if (tier === "B") return 0.88;
  if (tier === "C") return 0.7;
  if (tier === "D") return 0.5;
  return 0;
}

function isSubstantivePricingSignal(signal: string) {
  const normalized = signal.trim().toLowerCase();
  return Boolean(normalized) && !/no (reliable|source-backed|public) (list )?pricing|pricing (details|signal) (was )?found/.test(normalized);
}
