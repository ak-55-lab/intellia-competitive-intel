import type { CollectedEvidence } from "@/server/intelligence/pilot-types";

export function vetEvidenceCollection(evidence: CollectedEvidence[]) {
  const usable = evidence.filter((item) => item.sourceTier !== "INF" && !item.url.startsWith("internal://") && item.content.trim().length >= 80);
  const uniqueUrls = new Set(usable.map((item) => item.url)).size;
  const sourceTypes = new Set(usable.map((item) => item.sourceType)).size;
  const hasCompanyPage = usable.some((item) => item.sourceType === "company_site");
  const hasCompetitorPage = usable.some((item) => item.sourceType === "competitor_site");
  const hasRegionalEvidence = usable.some((item) => item.sourceType === "regional_search" || item.sourceType === "deep_research");
  const issues = [
    !hasCompanyPage ? "Focal-company homepage could not be retrieved." : "",
    !hasCompetitorPage ? "Competitor homepage could not be retrieved." : "",
    uniqueUrls < 6 ? `Only ${uniqueUrls} distinct usable sources were collected; at least 6 are required.` : "",
    sourceTypes < 3 ? `Only ${sourceTypes} evidence types were collected; at least 3 are required.` : "",
    !hasRegionalEvidence ? "No usable regional-footprint evidence was collected." : ""
  ].filter(Boolean);
  return { passed: issues.length === 0, usableSources: uniqueUrls, sourceTypes, issues };
}
