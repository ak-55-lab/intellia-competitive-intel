export type StrengthLabel = "Leading" | "Strong" | "Moderate" | "Emerging" | "Unknown";

export type ScoreLever = {
  name: string;
  score: number;
  label: StrengthLabel;
  rationale: string;
};

export type RegionPresence = {
  region: string;
  countries: string[];
  strength: StrengthLabel;
  note: string;
};

export type InsightItem = {
  id: string;
  title: string;
  category: string;
  date?: string;
  urgency: "Urgent" | "This Quarter" | "Monitor";
  summary: string;
  sellerImplication: string;
  sources?: Array<{ title: string; url: string; tier: string; sourceType?: string }>;
};

export type ResearchCompetitor = {
  id: string;
  name: string;
  website: string;
  rank: number;
  category: string;
  headline: string;
  sellerPositioning: string;
  battlecard: {
    snapshot: string[];
    questionsToAsk: string[];
    likelyObjections: Array<{ objection: string; reframe: string; sayThis: string }>;
    sourceWarnings: string[];
    evidenceCount: number;
    qaScore?: number;
  };
  pricing: {
    signal: string;
    confidence: StrengthLabel;
    notes: string[];
  };
  levers: ScoreLever[];
  regions: RegionPresence[];
  contextNodes: Array<{
    id: string;
    type: "pricing" | "positioning" | "features" | "news" | "regions" | "objections" | "signals";
    title: string;
    sellerImportance: string;
    details: string[];
    newSignals?: number;
    insightItems?: InsightItem[];
    trace?: Array<{ step: string; status: "found" | "not_found" | "needs_review"; detail: string; input?: string; output?: string }>;
    sources?: Array<{ title: string; url: string; tier: string; sourceType?: string }>;
  }>;
};

export type ResearchRun = {
  id: string;
  companyWebsite: string;
  companyName: string;
  requestedCompetitors: number;
  discovery?: {
    provider: "You.com";
    candidatePoolSize: number;
    searchedQueries: number;
    discoveredAt: string;
  };
  dataMode: "partial-live" | "live";
  generatedAt: string;
  competitors: ResearchCompetitor[];
};
