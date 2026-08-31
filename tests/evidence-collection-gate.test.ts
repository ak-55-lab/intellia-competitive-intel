import { describe, expect, it } from "vitest";
import { vetEvidenceCollection } from "../src/server/intelligence/evidence-collection-gate";
import type { CollectedEvidence } from "../src/server/intelligence/pilot-types";

function evidence(sourceType: CollectedEvidence["sourceType"], url: string): CollectedEvidence {
  return { id: url, title: sourceType, url, sourceType, sourceTier: sourceType === "review_search" ? "C" : "B", region: "Global", fetchedAt: "2026-01-01T00:00:00.000Z", content: "Verified public evidence content that is long enough to be considered for the collection quality gate.", contentHash: url, authorityScore: 0.8 };
}

describe("evidence collection gate", () => {
  it("accepts diverse, direct, regional evidence", () => {
    const result = vetEvidenceCollection([
      evidence("company_site", "https://company.example"), evidence("competitor_site", "https://competitor.example"),
      evidence("regional_search", "https://regional.example"), evidence("news_search", "https://news.example"),
      evidence("partner_search", "https://partner.example"), evidence("review_search", "https://reviews.example")
    ]);
    expect(result.passed).toBe(true);
  });

  it("rejects a thin collection before extraction", () => {
    const result = vetEvidenceCollection([evidence("web_search", "https://thin.example")]);
    expect(result.passed).toBe(false);
    expect(result.issues).toContain("Focal-company homepage could not be retrieved.");
  });
});
