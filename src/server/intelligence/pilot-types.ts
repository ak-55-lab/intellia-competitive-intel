export type PilotCompetitor = {
  name: string;
  website: string;
  segment: string;
  region: string;
};

export type CollectedEvidence = {
  id: string;
  title: string;
  url: string;
  sourceType:
    | "competitor_site"
    | "company_site"
    | "news_search"
    | "web_search"
    | "review_search"
    | "case_study_search"
    | "ranking_search"
    | "partner_search"
    | "event_search"
    | "ai_search"
    | "hiring_search"
    | "financial_search"
    | "regional_search"
    | "deep_research";
  sourceTier: "A" | "B" | "C" | "D" | "INF";
  region: string;
  fetchedAt: string;
  content: string;
  contentHash: string;
  authorityScore: number;
};

export type ExtractedClaim = {
  predicate: string;
  value: string;
  claimType: string;
  confidence: number;
  sourceIds: string[];
  region: string;
  status: "pending";
};

export type BattlecardDraft = {
  snapshot: string[];
  positioning: string;
  likelyObjections: Array<{ objection: string; reframe: string; sayThis: string }>;
  questionsToAsk: string[];
  pricingSignals: string[];
  sourceWarnings: string[];
};

export type PilotRunOutput = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: "single_competitor_live_pilot";
  company: PilotCompetitor;
  competitor: PilotCompetitor;
  agents: Array<{ name: string; status: "completed" | "skipped"; notes: string }>;
  evidence: CollectedEvidence[];
  claims: ExtractedClaim[];
  battlecardDraft: BattlecardDraft;
  qaReview: {
    passed: boolean;
    score: number;
    evidenceCoverage: number;
    usefulness: number;
    usability: number;
    issues: string[];
    recommendations: string[];
  };
  persistence: {
    postgres: "written" | "skipped_unreachable";
  };
  findings: string[];
};
