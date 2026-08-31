# Intellia External Intelligence: Production Architecture

## 1. Product overview and scope

Intellia is a seller-facing competitive-intelligence workspace for externally obtainable evidence. A user supplies a focal-company website and selects one to ten competitors. A live Competitor Discovery Agent uses You.com to build and verify a pool of up to 20 relevant competitors for that company, then the orchestrator researches the selected top count. The workspace produces source-linked battlecards, a company-brain overview, a signal graph, an evidence matrix, retrieval traces, and Ask Intellia answers grounded in the active run.

The product deliberately excludes CRM records, call recordings, customer account data, employee data, and other private field intelligence. This makes the evidence boundary repeatable, privacy-conscious, and appropriate for a public prototype.

The current public product is not presented as a multi-tenant history system: focal-company configuration is stored in the browser, and anonymous ad-hoc runs are returned to that browser. Protected scheduled runs persist the configured service-level company run.

## 2. Architecture

```text
Browser
  │ company website + competitor count
  ▼
Next.js API
  │ readiness check · IP rate limit · PostgreSQL advisory lock
  ▼
Live research orchestrator
  ├─ Competitor Discovery Agent ─ You.com ─ candidate pool / official-site verification
  ├─ Source Collector ─ You.com lanes ─┐
  │                     Firecrawl ─────┼─ source-backed evidence ledger
  │                     OpenAI deep research ─┘  (optional gap research)
  ├─ Claim Extractor / Battlecard Strategist ─ OpenAI Responses API
  ├─ QA Agent ─ quality and evidence gate
  └─ Persistence Gate ─ PostgreSQL transaction
  ▼
Live ResearchRun only when every requested competitor passes
  ├─ Graph, battlecards, matrix, source trace
  └─ Ask Intellia with citations
```

## 3. Technology stack and best-practice rationale

| Layer | Technology | Rationale |
| --- | --- | --- |
| Application | Next.js 15, React 19, TypeScript | One typed codebase for the UI, server APIs, and provider-key isolation. Shared types reduce drift across API, graph, and battlecard contracts. |
| Visualization | React Flow | Mature graph primitives enable interactive seller context without custom canvas code. |
| Database | PostgreSQL | Durable sources, snapshots, claims, run records, rate limits, and advisory locks with transactional semantics. |
| Schema changes | Drizzle SQL migrations | Explicit, reviewable, versioned schema changes are safer than implicit production schema creation. |
| Discovery | You.com Search + bounded OpenAI selection | Finds and ranks a verified, company-specific competitor pool before expensive per-competitor research. |
| Extraction | Firecrawl | Converts public web pages into main-content markdown for evidence-led reasoning. |
| Reasoning | OpenAI Responses API | Produces constrained claims/battlecards and source-bounded Ask Intellia responses. |
| Deep research | OpenAI Responses API + web search, optional | Adds citation-oriented research only when the standard pass has material gaps. |
| Hosting | Railway Docker + Railway Postgres | Managed deployment history, health checks, and managed database. |
| Scheduling | GitHub Actions | Calls a protected refresh endpoint; provider secrets remain only in Railway. |
| Browser validation | Playwright | Checks desktop/mobile public UX without consuming external research quota. |

## 4. Agents and research skills

The system uses a deterministic pipeline, not an unconstrained autonomous agent loop. Every stage has a narrow responsibility and inspectable output.

| Component | Module | Purpose | Key guardrail |
| --- | --- | --- | --- |
| Competitor Discovery Agent | `competitor-discovery.ts` | Searches You.com for a company-specific competitor pool, ranks candidates using only the returned evidence, and verifies official websites. | Requires cited search-result indices, rejects aggregators and the focal company, independently confirms the candidate brand on the retrieved homepage, de-duplicates names/domains, retries rate limits, and fails closed if it cannot verify enough candidates. |
| Source Collector | `source-collector.ts` | Collects company/competitor pages, lane results, selected page extracts, and retrieval warnings. | Firecrawl queue, retries, URL cache, deduplication, substantive-content filtering, and an evidence-collection gate before extraction. |
| Deep Research Agent | `deep-research.ts` | Uses OpenAI Responses API with web search to fill difficult retrieval gaps. | Uses only public web evidence, requires at least two returned URL citations, preserves them in the evidence ledger, and runs only when the evidence-gap policy selects it. |
| Claim Extractor | `claim-extractor.ts` | Converts supplied evidence into attributed claims and structured seller guidance. | Model instruction requires supplied-evidence-only claims; source IDs are normalized to the evidence ledger. |
| Battlecard Strategist | Extraction response | Drafts positioning, objections, talk tracks, discovery questions, pricing signals, and caveats. | Reviewability checks require non-empty seller guidance. |
| QA Agent | `qa-agent.ts` | Assesses evidence coverage, authority, claim attribution, seller usability, and regional evidence. | Any issue prevents live publication. |
| Persistence Gate | `persistence.ts` | Writes evidence, snapshots, claims, and claim links. | Transaction failure blocks the competitor. |
| Ask Intellia | `/api/ask` | Answers from a bounded active live run and returns citations. | Rejects non-live/malformed/oversized runs and rate-limits public use. |

### Discovery skills / lanes

The collector deliberately balances candidates across these lanes before ranking sources:

1. Battlecard
2. Competitor positioning
3. Regional footprint
4. Pricing
5. Synthetic voice of customer
6. Brand mention monitor
7. Partner ecosystem
8. Events watch
9. AI initiatives
10. Hiring motion
11. Financial and ownership
12. Case study miner
13. Analyst ranking watch
14. Signal sourcer
15. Community radar
16. Market landscape

Evergreen research is not constrained to one month. Time-sensitive lanes—news, events, AI, hiring, financial, and signal sourcer—retain a one-month recency filter. This is a practical reliability trade-off: broad historical context is retained while current signals are not buried by old results.

## 5. Live-run sequence and quality gates

1. The browser validates a public HTTPS company website and count of 1–10 competitors.
2. `/api/research/run` verifies provider/database readiness and reserves an IP rate-limit slot.
3. A PostgreSQL advisory lock prevents concurrent global collections.
4. The Competitor Discovery Agent runs multiple You.com queries, ranks only result-supported candidates, and verifies candidate official websites. It creates a pool of up to 20 candidates and selects the requested top count.
5. The orchestrator runs selected competitors with bounded concurrency.
6. The Source Collector performs lane-balanced search and queues Firecrawl calls at a safe global rate.
7. Optional deep research runs only for material evidence gaps.
8. OpenAI extracts compact source-linked claims and seller guidance.
9. QA verifies evidence volume/authority, source attribution, seller usability, and regional-footprint evidence.
10. A database transaction writes the source ledger, snapshots, claims, and links.
11. Only if every requested competitor passes all gates does the API return `dataMode: "live"`.

The result is fail-closed. A partial, thin, unpersisted, or regionally unsupported result is not displayed as seller-ready. The browser receives an actionable quality-gate error instead.

### Step gates

| Stage | Verification required before the next stage |
| --- | --- |
| Competitor discovery | Candidate is present in cited You.com results, its official-looking domain is not an aggregator/directory/focal-company domain, and its retrieved homepage confirms the brand. |
| Evidence collection | Focal and competitor homepages are retrieved; at least six distinct substantive public sources, three evidence types, and regional evidence are present. |
| Deep research | The optional report must return at least two URL citations or it is excluded from the evidence ledger. |
| Claim extraction | Strict JSON parses, every claim points to a collected source ID, and the battlecard reviewability fields are non-empty. |
| QA | Authority, attribution, regional evidence, seller usability, and source-warning thresholds pass. |
| Persistence and publication | The source ledger, snapshots, claims, and links commit in PostgreSQL; every requested competitor must pass before a live run is returned. |

## 6. Evidence lineage

Each evidence item records a stable content hash and ID, original URL/title, source type/tier, region, retrieval timestamp, authority score, and captured public content. Claims link back to their source IDs. UI nodes show relevant source links and a trace of discovery, search mapping, extraction, and QA.

The product intentionally does not compute unsupported “winner” scores. The matrix shows observed evidence coverage and signal volume, not a universal competitive ranking.

## 7. Reliability controls

### Provider handling

- Firecrawl is serialized by a process-wide queue, paced at 3.4 seconds by default, and retried on HTTP 429.
- A 15-minute URL cache and in-flight request cache prevent duplicated focal-company scrapes during multi-competitor runs.
- The top three candidate pages per competitor are fully scraped by default; broader lane-balanced snippets remain as evidence. This protects provider quota without discarding breadth.
- Empty search results are not converted into evidence.
- Lane failures are retained as retrieval warnings, never transformed into claims.

### Public product controls

- Two completed research runs per hashed IP per hour.
- Ten Ask Intellia questions per hashed IP per hour.
- Failed, locked, or quality-rejected runs release their research quota reservation.
- HTTPS-only public web targets; internal, localhost, IP-literal, and credential-bearing URLs are rejected.
- Provider secrets remain server-side.

### Explicit uncertainty

When public evidence cannot support a topic, the UI says so. It does not substitute static battlecard assertions, stale demo content, or model-generated “common knowledge.”

## 8. Deployment, refresh, and operations

Railway builds a standalone Next.js Docker image. Startup runs idempotent migrations and then starts the server. Railway health checks call `/api/health`, which reports liveness and safe live-provider readiness without returning secrets.

### Required variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL evidence, run, lock, and rate-limit storage. |
| `OPENAI_API_KEY` | Claim extraction and Ask Intellia. |
| `OPENAI_MODEL`, `OPENAI_FALLBACK_MODEL` | Primary and fallback model selection. |
| `FIRECRAWL_API_KEY` | Public-page extraction. |
| `YOUCOM_API_KEY` | Search-lane discovery. |
| `INTELLIA_AUTH_SECRET` | HMAC secret for hashing public rate-limit keys. |
| `LIVE_RESEARCH_ENABLED=true` | Enables live orchestration. |
| `SELLER_COMPANY_NAME`, `SELLER_COMPANY_WEBSITE`, `SELLER_COMPETITOR_COUNT` | Scheduled default-company configuration. |
| `INTELLIA_REFRESH_SECRET` | Bearer credential for protected refresh. |
| `EXTERNAL_INTELLIGENCE_MAX_AGE_HOURS` | Maximum age of a persisted scheduled run. |
| `DEEP_RESEARCH_ENABLED=true`, `OPENAI_DEEP_RESEARCH_MODEL` | Optional OpenAI web-grounded deep research; defaults to `o4-mini-deep-research`. |
| `DEEP_RESEARCH_MAX_COMPETITORS_PER_RUN` | Cost and latency guardrail; defaults to two gap-selected competitors per run. |
| `FIRECRAWL_MIN_INTERVAL_MS` | Global request spacing. Use `5500` for a 14-request/minute Firecrawl plan; the collector honors `Retry-After` and retries documented transient 408/429/5xx provider failures with jittered backoff. |
| `LIVE_RESEARCH_COMPETITOR_CONCURRENCY` | Independent competitor workers; defaults to `5` for a top-10 run. Firecrawl remains globally paced, while search, extraction, persistence, and deep research overlap to keep the interactive request within its hosting window. |

Interactive research returns immediately with `202 Accepted` and exposes `collecting` through the status endpoint while the always-on Railway service completes the quality-gated pipeline. A successful run is persisted before the UI reloads it; a sanitized failure code is returned to the UI when a gate rejects the run.

### Daily and event refresh

`.github/workflows/daily-refresh.yml` calls `POST /api/research/refresh` at 05:17 UTC. Configure GitHub secrets:

- `INTELLIA_REFRESH_URL`: production base URL
- `INTELLIA_REFRESH_SECRET`: same value held by Railway

For event refresh, a trusted monitor calls the same endpoint with bearer authorization and, for example:

```json
{ "trigger": "event", "event": "competitor_product_launch" }
```

The repository provides the protected trigger; an external monitoring service is responsible for event detection.

## 9. Testing and release checklist

Before release:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

The QA test proves that missing regional evidence blocks publication. Playwright tests assert the desktop/mobile workspace exposes live controls and no preview surface.

After deployment:

1. Confirm Railway deployment status is `SUCCESS`.
2. Check `/api/health`; require `liveResearchReady: true` and no missing dependencies.
3. Check `/api/research/config`; require `mode: "live"` and expected default company values.
4. Run a small live collection before a ten-competitor collection.
5. Inspect a graph node’s sources and trace.
6. Ask Ask Intellia a question and verify citations return.

## 10. Known, intentional trade-offs

- Ten-competitor runs take several minutes because provider limits, QA, and persistence are respected for every competitor.
- Comprehensive means diverse, lane-balanced, source-traceable public research; it does not mean the entire web is crawled or every commercial claim is proven.
- Browser configuration is local. Authenticated tenant workspaces are the next step for a broad public launch, and are not claimed as current functionality.
- Deep research is optional. When its key is absent, it is reported as unavailable rather than fabricated.
- Scheduled default-company runs persist centrally; anonymous ad-hoc runs do not overwrite shared display data.
