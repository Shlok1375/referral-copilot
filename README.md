# Referral Copilot

**[Live demo →](https://referral-copilot-7474645521939750.aws.databricksapps.com)**

A healthcare facility referral tool that matches patients to the right facility by care need and location, ranked by relevance and distance, with transparent evidence for every match.

Originally built at the **Databricks Data + AI Summit 2026 — Apps & Agents for Good Hackathon** (Top 7 of 122 projects, 480+ hackers). This repo contains my own continued development on the project after the hackathon: a cleanup and hardening pass over the original submission, plus ongoing feature work.

## What it does

Type a query like `dialysis near Jaipur` or `cardiac surgery near 400001`, and the app:

1. Parses the care need and location out of natural language (city name or 6-digit Indian pincode)
2. Resolves the location to coordinates via a postal-code/district lookup
3. Pulls every facility within 50km using a haversine distance calculation
4. Scores each facility against the care need using a **weighted keyword-relevance model** — fields like `capability` and `procedure` carry more weight than a generic `description`, because they're more authoritative signals of an actual match
5. Surfaces **evidence** for every match (the exact text snippet that matched) and **flags missing data** on fields the scoring model couldn't check — so the person using it can see *why* a result ranked where it did, and where to double check before acting on it

That evidence-and-missing-data pattern is the core design idea: a bare ranked list asks the user to trust a black box. Showing the supporting text, and being explicit about what's unknown, is what makes the ranking usable for a real referral decision.

The app also includes a facility directory (search by name/specialty/state), a district-level public health indicators view (NFHS-5 data), and a standalone pincode lookup tool.

## What I refined after the hackathon

The version submitted at the hackathon worked, but the original deployment was running with two corrupted build configuration files (lost during the original export), which masked a real amount of latent type-safety debt. Bringing the project back up cleanly surfaced and let me fix:

- **Restored broken TypeScript project configuration** (`tsconfig.shared.json` and `tsconfig.client.json` had been lost/corrupted), which had been silently suppressing ~126 lint findings
- **Fixed unsafe type coercion** throughout the facility-scoring code — raw Postgres row values were being passed through `String()` without narrowing, which is a real risk of producing `"[object Object]"` instead of actual data if a column ever returns something unexpected
- **Fixed two race conditions** in the frontend: rapid filter changes or quick clicks between facilities could let a slower, superseded request's response land *after* a newer one and silently overwrite fresher data. Both are now properly cancelled via `AbortController` on cleanup
- **Extracted a reusable `useFetchJson` hook** to replace three near-identical copies of fetch/loading/error/cancellation boilerplate, aligned with the React Compiler's recommended patterns for state derived from effects
- **Added unit test coverage for the core matching logic** (query parsing and the weighted scoring algorithm) — the original project had only a Playwright smoke test verifying pages load, with no coverage of the actual ranking behavior

The full list of changes is in the commit history.

## Architecture

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui (via Radix), React Router
- **Backend:** Express, TypeScript, [Databricks AppKit](https://www.databricks.com/devhub/docs/appkit/v0/) SDK
- **Database:** Postgres via [Databricks Lakebase](https://www.databricks.com/product/lakebase) — the hackathon dataset (facilities, NFHS-5 district health indicators, India Post pincode directory) is synced from Unity Catalog
- **Validation:** Zod for request body parsing
- **Testing:** Vitest (unit), Playwright (smoke/e2e)
- **Deployment:** Databricks Apps, via Databricks Asset Bundles

### Why a weighted keyword model, not embeddings

The honest tradeoff: a semantic/embedding-based matcher would generalize better to phrasing the keyword model can't see (e.g., matching "kidney dialysis" to a facility that only lists "renal replacement therapy"). The current approach was the right scope for a ~24-hour hackathon — it's fast, fully explainable (every match traces back to a literal substring you can show the user), and has zero inference cost. Replacing it with an embedding-based similarity score, while keeping the same evidence/missing-data UI pattern, is the most interesting open improvement — see [Roadmap](#roadmap) below.

## Getting Started

### Prerequisites

- Node.js v22+ and npm
- A Databricks workspace with a Lakebase Postgres instance (for running against real data)
- [Databricks CLI](https://docs.databricks.com/dev-tools/cli/index.html), for deployment

### Local development

```bash
npm install
cp .env.example .env   # then fill in your workspace details
npm run dev
```

The app needs a live Databricks workspace connection to serve real data (Lakebase, plus the synced facility/pincode/health-indicator tables) — see `.env.example` and the [AppKit Lakebase docs](https://www.databricks.com/devhub/docs/appkit/v0/plugins/lakebase) for configuring a local connection.

### Running tests

```bash
npm run test        # unit tests (Vitest) + smoke test (Playwright)
npm run typecheck   # TypeScript, client + server
npm run lint         # ESLint
```

### Deployment

```bash
databricks bundle validate
databricks bundle deploy
```

See `databricks.yml` for the bundle configuration.

## Project Structure

```
client/          React frontend
  src/
    pages/        Route-level pages (search, facilities, districts, pincode)
    hooks/        Shared hooks (useFetchJson)
server/          Express backend
  routes/        API route handlers, incl. the scoring/matching logic
tests/           Vitest unit tests + Playwright smoke test
databricks.yml   Asset Bundle configuration
app.yaml         App runtime configuration
```

## Roadmap

A few directions I'm continuing to explore:

- **Embedding-based semantic matching** as an option alongside (not necessarily replacing) the current keyword model, to catch synonymous phrasing the current substring matching misses
- **LLM-based result validation** — a second-pass check on the top results that can flag a plausible-looking but actually-wrong match (e.g., a facility that lists a specialty but is clearly the wrong type of facility for the specific care need), surfaced with the same confidence/evidence pattern already used elsewhere in the UI
- **Persisting the shortlist server-side** — it currently lives in browser `localStorage`, so it doesn't follow a user across devices despite the app already having a real Postgres backend

## License

Built for the Databricks Data + AI Summit 2026 hackathon. Unlicensed — see `package.json`.
