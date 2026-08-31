# Intellia External Intelligence

Intellia is a public, seller-facing competitive-intelligence workspace. A user supplies a company website, selects one to ten competitors, and receives source-linked external intelligence, seller battlecards, a signal graph, evidence matrix, retrieval traces, and Ask Intellia answers grounded in the active run.

Production app: <https://intellia-competitive-intel-production.up.railway.app/research>

## Production guarantees

- No preview or seeded seller content is available in the live runtime.
- A run is returned only when every requested competitor has external evidence, passes QA, includes regional-footprint evidence, and persists successfully to Postgres.
- Firecrawl collection is globally rate-paced and retried; the focal company page is reused within a run.
- Seller nodes expose sources and retrieval traces. When evidence is insufficient, the product states uncertainty rather than inferring a claim.
- Public research and Ask Intellia are database-backed, IP-rate-limited; failed runs release their reservation.

## Stack

- Next.js 15 / React 19 / TypeScript
- PostgreSQL + Drizzle SQL migrations
- Firecrawl, You.com Search, and OpenAI Responses API
- Optional OpenAI web-grounded deep research
- Railway hosting / Postgres and GitHub Actions daily refresh

## Local setup

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Set the required variables in `.env.example`. A live run needs `DATABASE_URL`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `YOUCOM_API_KEY`, `INTELLIA_AUTH_SECRET`, and `LIVE_RESEARCH_ENABLED=true`.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

See [production architecture and operations](docs/production-architecture.md) for the data flow, agents and research skills, quality gates, security posture, deployment, monitoring, and trade-offs.
