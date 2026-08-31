type ResearchJobState = {
  status: "collecting" | "idle" | "failed";
  startedAt: string | null;
  failure: string | null;
};

const state: ResearchJobState = { status: "idle", startedAt: null, failure: null };

export function markResearchJobCollecting() {
  state.status = "collecting";
  state.startedAt = new Date().toISOString();
  state.failure = null;
}

export function markResearchJobCompleted() {
  state.status = "idle";
  state.failure = null;
}

export function markResearchJobFailed(failure: string) {
  state.status = "failed";
  state.failure = failure;
}

export function currentResearchJobState() {
  return { ...state };
}
