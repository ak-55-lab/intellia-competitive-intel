import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepResearchConfigured } from "@/server/intelligence/deep-research";
import { vetEvidenceCollection } from "@/server/intelligence/evidence-collection-gate";
import { collectEvidence } from "@/server/intelligence/source-collector";
import { extractClaimsAndDraftBattlecard } from "@/server/intelligence/claim-extractor";
import { persistPilotOutput } from "@/server/intelligence/persistence";
import { vetResearchOutput } from "@/server/intelligence/qa-agent";
import type { PilotCompetitor, PilotRunOutput } from "@/server/intelligence/pilot-types";

export async function runSingleCompetitorPilot(input: {
  company: PilotCompetitor;
  competitor: PilotCompetitor;
  writeArtifacts?: boolean;
  tryAcquireDeepResearch?: () => boolean;
}) {
  const startedAt = new Date().toISOString();
  const runId = `${input.competitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${startedAt.replace(/[:.]/g, "-")}`;
  const agents: PilotRunOutput["agents"] = [];

  const evidence = await collectEvidence(input.company, input.competitor, { tryAcquireDeepResearch: input.tryAcquireDeepResearch });
  const collectionReview = vetEvidenceCollection(evidence);
  agents.push({
    name: "Source Collector",
    status: collectionReview.passed ? "completed" : "skipped",
    notes: `Collected ${evidence.length} evidence items through Firecrawl, You.com${isDeepResearchConfigured() ? ", and OpenAI deep research when the evidence-gap policy selected it" : ""}. Evidence gate: ${collectionReview.usableSources} usable sources across ${collectionReview.sourceTypes} types.${collectionReview.issues.length ? ` ${collectionReview.issues.join(" ")}` : ""}`
  });
  if (!collectionReview.passed) throw new Error(`evidence_collection_gate_failed:${input.competitor.name}:${collectionReview.issues.join(" ")}`);
  agents.push({
    name: "Deep Research Agent",
    status: evidence.some((item) => item.sourceType === "deep_research") ? "completed" : "skipped",
    notes: evidence.some((item) => item.sourceType === "deep_research")
      ? "OpenAI web-grounded deep research report was added as cited evidence."
      : "Skipped because the evidence-gap policy did not select it, its per-run budget was exhausted, or OpenAI deep research is disabled."
  });

  const extraction = await extractClaimsAndDraftBattlecard({
    company: input.company,
    competitor: input.competitor,
    evidence
  });
  assertReviewableOutput(extraction);

  agents.push({
    name: "Claim Extractor",
    status: "completed",
    notes: `Extracted ${extraction.claims.length} claims for PM review.`
  });
  agents.push({
    name: "Battlecard Strategist",
    status: "completed",
    notes: "Drafted snapshot, positioning, objections, questions and pricing signals."
  });

  const qaReview = vetResearchOutput({
    evidence,
    claims: extraction.claims,
    battlecardDraft: extraction.battlecardDraft
  });
  agents.push({
    name: "QA Agent",
    status: qaReview.passed ? "completed" : "skipped",
    notes: `Usefulness ${qaReview.usefulness}; usability ${qaReview.usability}; evidence coverage ${qaReview.evidenceCoverage}. ${qaReview.passed ? "Passed PM-ready quality gate." : "Needs another evidence pass before seller use."}`
  });

  const persistence = await persistPilotOutput({
    company: input.company,
    competitor: input.competitor,
    evidence,
    claims: extraction.claims
  });
  agents.push({
    name: "Persistence Gate",
    status: persistence.postgres === "written" ? "completed" : "skipped",
    notes: `Postgres ${persistence.postgres}.`
  });

  const output: PilotRunOutput = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: "single_competitor_live_pilot",
    company: input.company,
    competitor: input.competitor,
    agents,
    evidence,
    claims: extraction.claims,
    battlecardDraft: extraction.battlecardDraft,
    qaReview,
    persistence,
    findings: [
      ...extraction.findings,
      persistence.postgres === "skipped_unreachable" ? "Postgres is not reachable from the current DATABASE_URL, so system-of-record writes were not performed." : "Postgres connectivity is available.",
      "Postgres persists the source ledger, source snapshots, claims, and claim-to-source links."
    ]
  };

  let artifactDir: string | undefined;
  if (input.writeArtifacts ?? true) {
    artifactDir = resolve(process.cwd(), "data", "pilot-runs", runId);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(resolve(artifactDir, "output.json"), JSON.stringify(output, null, 2));
  }

  return { output, artifactDir };
}

function assertReviewableOutput(extraction: Awaited<ReturnType<typeof extractClaimsAndDraftBattlecard>>) {
  const failures = [
    extraction.claims.length === 0 ? "no claims extracted" : "",
    extraction.battlecardDraft.snapshot.length === 0 ? "empty snapshot" : "",
    extraction.battlecardDraft.positioning.trim().length === 0 ? "empty positioning" : "",
    extraction.battlecardDraft.likelyObjections.length === 0 ? "no complete objections" : "",
    extraction.battlecardDraft.questionsToAsk.length === 0 ? "no discovery questions" : ""
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Pilot output failed PM reviewability gate: ${failures.join(", ")}`);
  }
}
