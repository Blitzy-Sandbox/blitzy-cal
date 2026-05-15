# Technical Specification

# 0. Agent Action Plan

## 0.1 Intent Clarification

### 0.1.1 Core Objective

Based on the provided requirements, the Blitzy platform understands that the objective is to perform a comprehensive read-only security audit of the `blitzy-cal` codebase (the `calcom-monorepo` repository) using only native agent analysis — without invoking any external scanning tool — and to serialize every identified vulnerability into a single-line minified JSON artifact named `findings-config-a.json` that conforms to a strict five-field schema. The audit constitutes **Config A — Bare Blitzy Baseline**, the control measurement in a multi-configuration security tool comparison study.

The user's directives, restated with technical precision:

- **CRITICAL Directive 1 — Audit codebase for security vulnerabilities.** Analyze the entire `blitzy-cal` repository surface — trace data flows from user-controlled inputs to security-sensitive sinks, follow call chains across module boundaries, examine runtime configuration artifacts, and inspect dependency declarations. Every vulnerability identified MUST be captured as a discrete finding and classified by the most specific Common Weakness Enumeration (CWE) identifier the agent is confident about. The pass/fail gate is that "Every identified vulnerability is captured as a finding with a CWE classification."

- **CRITICAL Directive 2 — Produce single-line findings JSON.** Compile all findings from Directive 1 into `findings-config-a.json`. The file MUST be valid JSON, minified to a single line (no pretty-printing, no newlines), UTF-8 encoded. If zero findings are identified, the file MUST contain the empty array literal `[]`. Pass/fail criteria: `cat findings-config-a.json | wc -l` returns `1`, the content parses as valid JSON, every finding object has all five fields populated, and no `description` exceeds 200 characters.

The exact preserved schema for each finding is:

```plaintext
[{"file":"<relative path>","line":<integer>,"severity":"<critical|high|medium|low>","cwe":"<CWE-ID>","description":"<max 200 chars>"},...]
```

The header annotation `[2 directives | ~0 files modified | 1 new file | baseline measurement]` is preserved verbatim and conveys the user's expectation that this is a measurement-only activity — no remediation, no refactoring, no source modifications.

Implicit requirements surfaced by the Blitzy platform:

- **CWE specificity.** The phrase "most specific CWE you are confident about" requires that findings reference precise weaknesses (for example, CWE-89 for SQL injection rather than the generic parent CWE-707 "Improper Neutralization") and that low-confidence findings be either omitted or downgraded — never inflated to satisfy a quota.
- **Reproducibility.** As a baseline control for a comparison study, the audit output must be deterministic given the same agent and same codebase snapshot — running the same audit twice should produce equivalent findings sets so that downstream comparisons against tool-augmented configurations are scientifically meaningful.
- **Line-number precision.** The `line` field is typed as an integer (not a range, not a list). For multi-line vulnerabilities, the most representative single line must be selected — typically the sink line or the declaration line.
- **Path discipline.** The `file` field must be a relative path from the repository root (for example, `apps/web/proxy.ts`, not `/calcom-monorepo/apps/web/proxy.ts` and not an absolute path).
- **Strict severity vocabulary.** Severity is one of exactly four lowercase string literals: `critical`, `high`, `medium`, `low`. Any other casing or vocabulary fails validation.
- **Length-bounded description.** The 200-character ceiling forces descriptions to be specific and code-anchored rather than encyclopedic — they must identify the vulnerable construct, not restate the CWE definition.
- **No file required if empty.** The empty-array fallback `[]` keeps the artifact contract well-defined even when the audit finds nothing — downstream comparison tooling can still parse the file.

### 0.1.2 Task Categorization

| Dimension | Value |
|---|---|
| Primary task type | Security audit (read-only) — Mixed (security audit + configuration artifact production + baseline measurement) |
| Secondary aspects | Tooling (produces an experimental artifact for a comparison study); Documentation (decision log per Explainability rule); Configuration (output JSON file) |
| Scope classification | Isolated change — three new files created at the repository root; zero existing source files modified |

### 0.1.3 Special Instructions and Constraints

The following directives from the user input are captured verbatim or paraphrased without semantic loss:

- **User Directive (Verbatim, Directive 1):** "Analyze the `blitzy-cal` codebase for all security vulnerabilities you can identify. Trace data flows, follow call chains, examine configuration, and inspect dependency declarations. Report every vulnerability you find. Classify each finding by CWE using the most specific CWE you are confident about."
- **User Directive (Verbatim, Directive 2):** "Compile all findings from Directive 1 into `findings-config-a.json`. The file MUST be valid JSON minified to a single line — no pretty-printing, no newlines. Encoding: UTF-8. If zero findings are identified, write an empty array `[]`."
- **User Constraint (Verbatim, Methodology):** "audit the `blitzy-cal` codebase for security vulnerabilities using only native agent analysis — no external scanning tools."
- **User Constraint (Verbatim, Output):** Pass/fail — "`cat findings-config-a.json | wc -l` returns `1`. The content parses as valid JSON. Every finding has all 5 fields populated. No description exceeds 200 characters."
- **User Example (Verbatim, Schema):** `[{"file":"<relative path>","line":<integer>,"severity":"<critical|high|medium|low>","cwe":"<CWE-ID>","description":"<max 200 chars>"},...]`
- **User Annotation (Verbatim, Scope):** `[2 directives | ~0 files modified | 1 new file | baseline measurement]`
- **User Framing (Verbatim, Purpose):** "This is the baseline control for a multi-config security tool comparison."

No web search is required for the audit itself — by user mandate, the agent uses only native repository inspection. Web search may be referenced for CWE definition lookups and best-practice classification guidance, but it is not part of the vulnerability-discovery pipeline.

### 0.1.4 Technical Interpretation

These requirements translate to the following technical implementation strategy:

- **To achieve comprehensive vulnerability discovery, the Blitzy platform will inspect the existing source tree at `apps/`, `packages/`, `scripts/`, and root configuration files using native repository tools (read_file, grep, search_files) — without modifying any of them — and apply a four-lens analysis methodology: (1) data-flow tracing from request-derived taint sources to security-sensitive sinks, (2) call-chain inspection across module boundaries, (3) configuration review of containers, environment templates, and CI workflows, and (4) dependency declaration inspection of `package.json`, `yarn.lock`, and `.yarnrc.yml`.**

- **To achieve CWE classification, the Blitzy platform will map each identified vulnerability to the MITRE CWE catalog by matching the observed weakness pattern to the most specific CWE entry — preferring leaf nodes over parent categories — and recording only findings where confidence in the classification is reasonable.**

- **To achieve the single-line JSON output, the Blitzy platform will construct the findings array in memory, serialize it with a JSON encoder configured to suppress whitespace and newlines, write the result to `findings-config-a.json` at the repository root with UTF-8 encoding and no trailing newline, and verify post-write with `wc -l` (expected: 1) and a JSON parser invocation (expected: valid).**

- **To achieve the Explainability rule, the Blitzy platform will create `decision-log.md` documenting every non-trivial decision made during the audit (severity calibration, CWE selection rationale, deviation from literal requirement interpretation) as a Markdown table per the rule's required schema.**

- **To achieve the Executive Presentation rule, the Blitzy platform will create `executive-summary.html` as a single self-contained reveal.js deck (12–18 slides, target 16) summarizing the audit scope, methodology, headline findings, risk distribution, and recommended next steps — using only Blitzy brand styling, Lucide icons (zero emoji), and Mermaid diagrams.**

## 0.2 Repository Scope Discovery

### 0.2.1 Comprehensive File Analysis

The audit surface is the entire `calcom-monorepo` minus the agent toolchain folder `/app/` and minus folders whose path-patterns are listed in `.blitzyignore` (none present in this repository). The following inventory enumerates every category that will receive read-only inspection.

#### Source Code Audit Targets

| Path Pattern | Role | Audit Lenses |
|---|---|---|
| `apps/web/**/*.{ts,tsx,js,jsx}` | Next.js 16.1.5 web application — App Router under `app/`, legacy Pages Router under `pages/`, ~180 API route directories, modules/, components/, lib/, server/ | Data-flow, call-chain |
| `apps/api/v1/**/*.{ts,js}` | Legacy Next.js API, 37 endpoint groups, `verifyApiKey` middleware, `rateLimitApiKey`, lib/ helpers | Data-flow, call-chain |
| `apps/api/v2/src/**/*.ts` | NestJS API, 30+ modules under `src/modules/`, guards under `auth/guards/`, OAuth2 controller, ApiAuthStrategy | Data-flow, call-chain |
| `apps/api/index.js` | Connect + http-proxy-middleware gateway on port 3002 | Configuration |
| `apps/web/proxy.ts`, `apps/web/lib/csp.ts` | Edge proxy and CSP nonce builder | Configuration, call-chain |
| `packages/lib/**/*.ts` | Shared utility layer — crypto/, auth/, rateLimit, default-cookies, entityPermissionUtils, server/, security/ | Data-flow, call-chain |
| `packages/features/**/*.ts` | Domain feature packages — auth/, pbac/, webhooks/, ee/sso/, ee/impersonation/, credentials/, booking-audit/, routing-forms/, organizations/, teams/, workflows/ | Data-flow, call-chain |
| `packages/prisma/schema.prisma` | Database schema, model attributes, index/constraint declarations | Configuration |
| `packages/prisma/migrations/**` | 589 migration files for additive-only enforcement audit | Configuration |
| `packages/prisma/extensions/**` | Prisma client extensions — `exclude-locked-users`, `exclude-pending-payment-teams`, `disallow-undefined-delete-update-many`, `booking-idempotency-key` | Call-chain |
| `packages/app-store/**` | 80+ third-party integration adapters (Stripe, Google, Outlook, Daily.co, Twilio, BTCPay, HitPay, Alby, HelpScout) | Data-flow, configuration |
| `packages/embeds/{embed-core,embed-react,embed-snippet}/**` | Three-package embed suite, postMessage handshake, custom elements | Data-flow |
| `packages/emails/**`, `packages/sms/**` | Email and SMS dispatch (nodemailer 7.0.12, Twilio) | Data-flow |
| `packages/trpc/**` | Shared tRPC server/client, procedure middlewares | Call-chain |
| `packages/platform/**` | Atoms design system, platform libraries barrel exports | Call-chain |
| `scripts/**/*.{sql,sh,ts,js}` | 20+ utility scripts including `delete-empty-google-credentials.sql`, `auto-grant.sql`, `staging-deploy.sh`, `replace-placeholder.sh`, seed-*.ts files | Configuration, data-flow |

#### Configuration Audit Targets

| Path | Audit Focus |
|---|---|
| `Dockerfile` | Base image, ARGs containing secrets, build-time env exposure, NODE_OPTIONS, multi-stage controls |
| `apps/api/v2/Dockerfile` | NestJS container build, user/permission settings |
| `docker-compose.yml` | Service definitions, exposed ports, environment variables, volume mounts, network configuration |
| `.env.example`, `.env.appStore.example` | Variable names that hint at sensitive configuration (encryption keys, OAuth secrets, DB URLs); checks for example values that could be mistaken for production |
| `example-apps/credential-sync/.env.example` | Example app env template inspection |
| `.yarnrc.yml` | `npmAuditIgnoreAdvisories` accepted-risk list, registry trust |
| `package.json` (root) | `resolutions` forced versions, `engines`, `packageManager`, scripts that could be hijacked |
| `apps/web/package.json`, `apps/api/v1/package.json`, `apps/api/v2/package.json` | Per-workspace dependency surfaces |
| `apps/web/next.config.js`, `apps/api/v1/next.config.js` | Next.js rewrites, headers, CSP, image domains, env exposure to client |
| `biome.json`, `biome-staged.json` | Linter rules — verify security-relevant rules are enabled |
| `playwright.config.ts`, `vitest.workspace.ts`, `checkly.config.ts` | Test runner configuration — look for secrets in test fixtures |
| `app.json` | Heroku buildpack config, addon definitions |
| `turbo.json` | Build orchestration, env variable passing to remote cache |
| `.github/workflows/*.yml` (20+ workflows) | GitHub Actions — secret usage, third-party action pinning, `pull_request_target` misuse, write permissions |
| `.github/actions/*/action.yml` (~10 actions) | Composite actions — input validation, output safety, secrets handling |
| `.well-known/security.txt` | Disclosure contact metadata |

#### Dependency Manifest Audit Targets

| Path | Audit Focus |
|---|---|
| `package.json` (root) | `resolutions` block (axios 1.13.5, lodash 4.17.23, jsonwebtoken 9.0.0, jws 4.0.1, qs 6.14.1, node-forge 1.3.2, validator 13.15.22, tar 7.5.7, form-data 4.0.4), patched deps (dayjs, libphonenumber-js, next-i18next) |
| `yarn.lock` | Transitive resolution truth — cross-reference against known-vulnerable versions |
| `.yarnrc.yml` | Accepted advisory: `fast-xml-parser@4.4.1` — verify rationale and exposure |
| `.yarn/patches/*.patch` | Three patches — inspect for security implications |
| 117 per-workspace `package.json` files | Workspace-specific dependency surfaces |

#### Related-File Discovery (Indirect Impact)

Because this is a read-only audit producing only output artifacts, no related-file modifications cascade. The only "ripple" is the three new files at the repository root (`findings-config-a.json`, `decision-log.md`, `executive-summary.html`), which are isolated additions that touch no existing module's import graph, no test fixture, and no build configuration.

### 0.2.2 Web Search Research Conducted

Per user mandate (Directive 1: "using only native agent analysis"), web search is NOT used for vulnerability discovery. Web search is permitted only for the following supporting purposes:

- **CWE catalog reference** — verifying the most specific CWE identifier and its official MITRE definition when classifying a finding.
- **Library-version vulnerability lookups** — confirming whether a pinned dependency version (for example, `jsonwebtoken@9.0.0`) has a documented known vulnerability that the agent would not otherwise have inherent knowledge of.
- **Best-practice anchoring** — confirming current severity-calibration conventions (CVSS-aligned mappings of "critical/high/medium/low") for the schema's severity field.

No web-search-derived information will be included in finding `description` fields as the primary evidence — descriptions reference the specific code construct observed in the repository.

### 0.2.3 Existing Infrastructure Assessment

The `calcom-monorepo` ships with a mature security infrastructure (documented in detail at §6.4 Security Architecture). The audit will identify deviations from these established controls rather than restating the controls themselves as findings.

| Existing Control Category | Implementation | Audit Implication |
|---|---|---|
| Multi-tier authentication | NextAuth (Web JWT), `verifyApiKey` (API v1), `ApiAuthStrategy` multi-method (API v2), BoxyHQ SAML, Platform OAuth2 with PKCE | Findings should target deviations: routes missing the standard guard, hardcoded bypasses, or weakened strategies |
| Dual authorization model | Legacy `MembershipRole` RBAC + PBAC (feature-flag gated by `pbac` Feature row) | Findings should target missing `@Permissions`/`@Pbac` decorators on sensitive endpoints, or `canEditEntity` bypass paths |
| Credential encryption | AES-256-GCM keyring (`CALCOM_KEYRING_CREDENTIALS_<KID>`) with rotation + legacy AES-256-CBC (`CALENDSO_ENCRYPTION_KEY`) | Findings should target plaintext credential paths, missing AAD, or hardcoded keys |
| Password hashing | bcryptjs 12 rounds via `packages/lib/auth/hashPassword.ts` | Findings should target alternate hashers, MD5/SHA-1 password handling, or weak rounds |
| Webhook signing | HMAC-SHA256 + `X-Cal-Signature-256`, `redirect: "manual"`, `timingSafeEqual` for inbound | Findings should target HMAC bypasses, missing signature verification, non-constant-time comparisons |
| Rate limiting | `@unkey/ratelimit` with 8 namespaces + NestJS Throttler (Redis-backed) | Findings should target endpoints lacking rate-limit decorators, especially auth-adjacent routes |
| CSP and headers | CSP nonce only on `/auth/login` and `/login`, Helmet on API v2, header sanitization in `proxy.ts` | Findings should target missing nonce on sensitive pages, unsanitized header echoes |
| Prisma extensions | `exclude-locked-users`, `exclude-pending-payment-teams`, `disallow-undefined-delete-update-many`, `booking-idempotency-key` | Findings should target Prisma operations that bypass these extensions (raw SQL, alternate clients) |
| Audit logging | `BookingAudit` (soft-FK `bookingUid`), `Impersonations`, `WatchlistAudit`, `AuditActor` | Findings should target sensitive operations without audit trail emission |
| Accepted advisory | `fast-xml-parser@4.4.1` (in `.yarnrc.yml npmAuditIgnoreAdvisories`) | Documented exception — not a finding unless its exposure changes |

Existing patterns and conventions to follow during finding generation:

- File paths use forward slashes and are relative to the repository root (matching the convention used throughout the technical specification).
- Module imports and package references use the `@calcom/<workspace>` alias convention; finding descriptions should preserve workspace context.
- Severity calibration follows the user's four-value vocabulary `critical|high|medium|low`, which the audit aligns to CVSS bands (critical: 9.0–10.0, high: 7.0–8.9, medium: 4.0–6.9, low: 0.1–3.9) when CVSS data is available, and otherwise to qualitative reasoning anchored in exploitability and blast-radius.
- The repository has a strong `Spec-First Development` discipline (per `specs/README.md`) and PR Discipline (5–7 files, ≤500 lines per PR). Output artifacts respect these by remaining at the repository root and not introducing scattered changes.

## 0.3 Scope Boundaries

### 0.3.1 Exhaustively In Scope

#### Read-Only Audit Targets (REFERENCE mode — files inspected, not modified)

- **Source code (application surface):**
    - `apps/web/**/*.{ts,tsx,js,jsx}` — Next.js 16.1.5 web app including App Router (`apps/web/app/**`), legacy Pages Router (`apps/web/pages/**`), API route handlers (`apps/web/{app,pages}/api/**`), edge middleware (`apps/web/proxy.ts`), CSP builder (`apps/web/lib/csp.ts`), Sentry instrumentation files
    - `apps/api/v1/**/*.{ts,js}` — Legacy Next.js API including `pages/api/**`, `lib/helpers/{verifyApiKey,rateLimitApiKey,validateRequest,extractUserIdFromQuery}.ts`, `lib/utils/**`
    - `apps/api/v2/src/**/*.ts` — NestJS API including `modules/auth/{guards,strategies,decorators}/**`, `modules/oauth-clients/**`, `modules/tokens/**`, `modules/billing/**`, `modules/webhooks/**`, `modules/events-types-2024-04-15/**`, `bootstrap.ts`, `vercel-webhook.guard.ts`
    - `apps/api/index.js` — Connect + http-proxy-middleware gateway
- **Source code (shared business logic and infrastructure):**
    - `packages/lib/**/*.ts` — auth/, crypto/, server/, security/, rateLimit, default-cookies, entityPermissionUtils, checkRateLimitAndThrowError
    - `packages/features/**/*.ts` — auth/, pbac/, webhooks/, ee/sso/, ee/impersonation/, ee/workflows/, ee/teams/, ee/organizations/, credentials/, booking-audit/, routing-forms/, membership/
    - `packages/app-store/**` — 80+ integration folders (especially webhook handlers under `*/api/webhook.ts`)
    - `packages/embeds/{embed-core,embed-react,embed-snippet}/**`
    - `packages/emails/**`, `packages/sms/**`
    - `packages/trpc/**`, `packages/platform/**`, `packages/kysely/**`
    - `packages/prisma/{schema.prisma,extensions/**,client.ts,selects/**,auto-migrations.ts,zod-utils.ts}`
- **Database schema and migrations:**
    - `packages/prisma/schema.prisma` — model definitions, indexes, constraints
    - `packages/prisma/migrations/**` — 589 chronological migrations
- **Configuration files:**
    - `Dockerfile`, `apps/api/v2/Dockerfile` — container build, ARG handling, secret hygiene
    - `docker-compose.yml` — service definitions, port exposure, env wiring
    - `.env.example`, `.env.appStore.example`, `example-apps/credential-sync/.env.example` — environment variable templates
    - `.yarnrc.yml` — npmAuditIgnoreAdvisories, registry trust
    - `package.json` (root) — resolutions, engines, scripts
    - `apps/web/next.config.js`, `apps/api/v1/next.config.js` — rewrites, headers, CSP, image domains, env exposure
    - `biome.json`, `biome-staged.json`, `playwright.config.ts`, `vitest.workspace.ts`, `checkly.config.ts`, `turbo.json`, `app.json`
- **CI/CD and GitHub Actions:**
    - `.github/workflows/*.{yml,yaml}` (~20 workflows including `all-checks.yml`, `release-docker.yaml`, `setup-db.yml`, `cron-*.yml`)
    - `.github/actions/*/action.yml` (~10 composite actions including `yarn-install`, `cache-build-key`, `docker-build-and-test`)
- **Scripts and tooling:**
    - `scripts/**/*.{sql,sh,ts,js}` — `auto-grant.sql`, `delete-empty-google-credentials.sql`, `find-email-case-insensitive-duplicates.sql`, `replace-placeholder.sh`, `staging-deploy.sh`, `seed-*.ts`, `pull-coss-ui-components.ts`
    - `deploy/**` — deployment bootstrap helpers
- **Dependency manifests (per audit lens 4):**
    - `package.json` (root + 116 workspace manifests under `apps/**/package.json` and `packages/**/package.json`)
    - `yarn.lock`
    - `.yarn/patches/{dayjs,libphonenumber-js,next-i18next}*.patch`

#### Output Artifacts (CREATE mode — new files at repository root)

| Target File | Purpose |
|---|---|
| `findings-config-a.json` | Minified single-line JSON array of CWE-classified vulnerability findings (CRITICAL Directive 2 — primary user-mandated deliverable) |
| `decision-log.md` | Markdown table documenting non-trivial decisions, alternatives, rationale, and risks (mandated by Explainability rule) |
| `executive-summary.html` | Self-contained reveal.js executive presentation (mandated by Executive Presentation rule — always included independent of other documentation) |

### 0.3.2 Explicitly Out of Scope

- **All source code modifications.** Zero files under `apps/**`, `packages/**`, `scripts/**`, `.github/**`, `deploy/**`, or any other existing source tree will be modified, created, or deleted. The audit is purely observational.
- **Remediation and fixes.** Findings are reported, not fixed. No PRs to patch vulnerabilities are part of this configuration.
- **Refactoring.** No code restructuring, dead-code removal, or pattern alignment.
- **Third-party security scanners.** No invocation of Snyk, Semgrep, CodeQL, Bandit, ESLint security plugins, npm audit, Trivy, Grype, OSV-Scanner, or any other external scanning tool. This is explicit per the Config A baseline definition and is the controlled variable in the multi-config comparison.
- **Dependency changes.** No `package.json` updates, no `yarn upgrade`, no lockfile regeneration, no advisory acceptance changes in `.yarnrc.yml`.
- **New test files.** No security regression tests are authored under `apps/**/test/**`, `packages/**/test/**`, or any other test location.
- **CI/CD workflow changes.** No new GitHub Actions workflows, no security-scan job additions, no composite action updates.
- **Database changes.** No migrations, no schema modifications, no seed data updates.
- **Environment variable additions.** No `.env.example` updates, no new variable names introduced.
- **Documentation updates beyond the rule-mandated outputs.** No README updates, no SECURITY.md changes, no PERMISSIONS.md updates, no tech spec section additions.
- **Documentation folders excluded from finding generation.** `blitzy/**`, `blitzy-docs/**`, `agents/**`, `specs/**`, and `docs/**` are not application code and will not be the source of CWE findings; they may be inspected for contextual cross-reference only.
- **The `/app/` folder** (agent toolchain) and any folder matching a `.blitzyignore` pattern (none in this repository) is never inspected.
- **Performance optimizations.** No performance findings unless they have a documented security implication (for example, algorithmic DoS — CWE-1333).
- **Feature additions or behavioral changes.** No new endpoints, no new permissions, no new UI surfaces.
- **Compiled artifacts and `node_modules/`.** Transitive vulnerability inference uses `yarn.lock` and `package.json` metadata only; no inspection of installed package source under `node_modules/`.

## 0.4 Dependency Inventory

### 0.4.1 Key Private and Public Packages

This audit introduces **no new dependencies** and modifies **no existing dependencies**. The codebase's existing dependency surface is the read-only audit target, not a deliverable. The following table enumerates the security-relevant existing packages that the audit will inspect (versions pinned in the root `package.json` `resolutions` block, in `apps/web/package.json`, in `apps/api/v2/package.json`, and in `apps/api/v1/package.json`):

| Registry | Package Name | Version | Purpose | Audit Significance |
|---|---|---|---|---|
| npm | next | 16.1.5 | Web framework (apps/web) | App Router/Pages Router boundary, edge middleware |
| npm | next-auth | (declared in apps/web) | Authentication framework | Identity providers, JWT handling, cookie config |
| npm | @nestjs/* | (declared in apps/api/v2) | NestJS framework | Guard order, validation pipe, exception filters |
| npm | @prisma/client | 6.16.1 | ORM | Query construction, raw SQL boundary, extensions |
| npm | prisma | 6.16.1 | Migration tooling | Schema integrity, additive-only invariant |
| npm | bcryptjs | (via packages/lib) | Password hashing (12 rounds) | Hash rounds, comparison constant-time property |
| npm | jsonwebtoken | 9.0.0 | JWT signing (legacy OAuth) | Algorithm pinning (HS256), secret handling |
| npm | jose | (via signJwt.ts) | JWT signing (magic-link) | 2-minute expiry, HS256, CALENDSO_ENCRYPTION_KEY usage |
| npm | jws | 4.0.1 | JWT primitives | Transitive — alg=none defense |
| npm | otplib | (via TOTP routes) | TOTP authenticator | Secret length-32 assertion, backup code flow |
| npm | @boxyhq/saml-jackson | 1.52.2 | SAML SSO (BoxyHQ) | Tenant isolation, SAML_DATABASE_URL |
| npm | helmet | 7.1.0 | HTTP security headers (API v2) | bootstrap.ts header config |
| npm | ioredis | 5.3.2 | Redis client | Throttler storage, PBAC cache |
| npm | @unkey/ratelimit | (via packages/lib/rateLimit) | Rate limiting | 8 namespaces — bypass risk |
| npm | dompurify | (via apps/web) | HTML sanitization | XSS sink — sanitize call coverage |
| npm | sanitize-html | (via apps/web) | HTML sanitization | XSS sink — sanitize call coverage |
| npm | handlebars | 4.7.7 | Webhook payload templating | Template injection — `{{ }}` vs `{{{ }}}` |
| npm | axios | 1.13.5 | HTTP client (forced resolution) | SSRF source — outbound request control |
| npm | node-forge | 1.3.2 | Cryptographic primitives | Legacy crypto usage |
| npm | qs | 6.14.1 | Query string parsing | Prototype pollution defense |
| npm | lodash | 4.17.23 | Utility functions (forced resolution) | Prototype pollution defense |
| npm | validator | 13.15.22 | String validation | Input validation coverage |
| npm | tar | 7.5.7 | Archive extraction (security) | Path traversal during extract |
| npm | form-data | 4.0.4 | Multipart encoding | Boundary handling |
| npm | nodemailer | 7.0.12 | SMTP email delivery | Outbound email — header injection |
| npm | dayjs | 1.11.4 (patched) | Date/time manipulation | Patch context (timezone DST) |
| npm | libphonenumber-js | 1.11.18 (patched) | Phone number validation | Patch context (edge case) |
| npm | googleapis | 84.0.0 (apps/api/v2) | Google API client | OAuth scope handling |
| npm | @sentry/nextjs | 10.33.0 | Web observability | PII scrubbing, log injection |
| npm | @sentry/nestjs | 9.46.0 | API v2 observability | PII scrubbing, log injection |
| npm | stripe | 9.16.0 (web) / 15.4.0 (api/v2) | Payment SDK | Webhook signature, secret handling |
| npm | next-i18next | 15.4.2 (patched) | i18n | Server/client symmetry |
| npm | botid | 1.5.7 | Bot detection | Bypass paths |
| npm | @upstash/redis | 1.35.2 | Serverless Redis (edge) | Edge runtime data handling |
| npm | @vercel/edge-config | (via apps/web) | Vercel edge config | Feature-flag kill switch — isSignupDisabled |
| npm | backblaze-b2 | (via apps/web) | B2 object storage | Credential handling, SSRF |
| npm | retell-sdk | 4.41.0 | Retell AI voice | Outbound API key handling |

The accepted-advisory exception documented in `.yarnrc.yml`:

| Advisory Package | Version | Status |
|---|---|---|
| `fast-xml-parser` | 4.4.1 | Accepted via `npmAuditIgnoreAdvisories` — documented in `.yarnrc.yml` (per Tech Spec §3.3.6) |

### 0.4.2 Dependency Updates

This audit applies **no** dependency changes. Specifically:

- **New dependencies to add:** None. Per CRITICAL Directive 1 ("using only native agent analysis — no external scanning tools"), the audit cannot install Snyk, Semgrep, CodeQL, or any other scanner package.
- **Dependencies to update:** None. The accepted-advisory exception for `fast-xml-parser@4.4.1` remains intact. Existing pinned resolutions remain at their current versions.
- **Dependencies to remove:** None.
- **Import / Reference Updates:** None. No source file modifications means no import statements change. The three new files at the repository root (`findings-config-a.json`, `decision-log.md`, `executive-summary.html`) are not imported by any existing source file and do not participate in the workspace's TypeScript module graph or build pipeline.

The output `executive-summary.html` loads its runtime libraries from public CDNs (not from `node_modules`) per the Executive Presentation rule:

| CDN-Loaded Library | Pinned Version | Loading Mechanism |
|---|---|---|
| reveal.js | 5.1.0 | `<link>` and `<script>` tags pointing to the pinned CDN |
| Mermaid | 11.4.0 | `<script>` tag |
| Lucide | 0.460.0 | `<script>` tag |
| Google Fonts (Inter, Space Grotesk, Fira Code) | N/A (Google Fonts versioning) | `<link>` to `fonts.googleapis.com` |

These are runtime, browser-loaded resources — they do not affect the Node.js workspace dependency graph, do not appear in `package.json`, and do not trigger any `yarn` operation.

## 0.5 Implementation Design

### 0.5.1 Technical Approach

The Blitzy platform will execute the audit and produce its artifacts by following a four-lens analysis methodology, then serializing the findings array with strict schema compliance and producing two rule-mandated supporting artifacts. The approach prioritizes deterministic, code-anchored findings over breadth — Config A is a measurement, not a remediation effort.

**Primary objectives with implementation approach:**

- **Achieve comprehensive vulnerability discovery by applying four orthogonal analysis lenses to `apps/**`, `packages/**`, `scripts/**`, and root configuration files,** using only native repository inspection (read_file, bash grep, search_files, search_folders). Rationale: the user explicitly forbids external scanning tools, making native code-comprehension the only permissible discovery channel.

- **Achieve CWE classification by matching each observed weakness pattern to the most specific MITRE CWE leaf-node identifier,** preferring children over parents (CWE-89 over CWE-707, CWE-1004 over CWE-200 when both are technically valid). Rationale: the directive explicitly requests "the most specific CWE you are confident about," and downstream comparison metrics depend on classification consistency.

- **Achieve schema-compliant JSON output by constructing the findings array in memory, validating each record against the five-field contract (file, line, severity, cwe, description) and the 200-character description ceiling, then serializing with `json.dumps(separators=(',', ':'), ensure_ascii=False)` semantics** (Python idiom; equivalent `JSON.stringify(arr)` in Node with no spacing). Rationale: the pass/fail gate is `wc -l == 1` AND valid JSON AND all five fields populated — both must hold simultaneously.

- **Achieve verification by running `cat findings-config-a.json | wc -l` and a JSON parse step after writing the file,** failing the audit if either check fails. Rationale: directly mirrors the user's stated pass/fail criteria.

- **Achieve Explainability rule compliance by emitting `decision-log.md` containing one row per non-trivial decision** (severity calibration boundary cases, CWE selection between near-equivalent candidates, audit scope boundaries, deviation entries for any departure from literal requirements). Rationale: the rule defines a non-trivial decision as one a competent engineer could reasonably have chosen differently, and the audit involves many such boundary calls.

- **Achieve Executive Presentation rule compliance by emitting `executive-summary.html` as a single self-contained reveal.js deck** with 12–18 slides covering scope of work, business value, architecture context, risk distribution, mitigation guidance, and team onboarding. Rationale: the rule mandates this artifact "always included independent of any other documentation that exists" and prescribes precise styling, slide types, and CDN versions.

**Logical implementation flow (NOT a timeline):**

- **First, establish audit context** by reading the repository structure (`get_source_folder_contents` on root), retrieving relevant technical-specification sections (1.1 Executive Summary, 1.2 System Overview, 3.3 Open Source Dependencies, 6.4 Security Architecture), and indexing the existing security infrastructure (NextAuth, ApiAuthStrategy, PBAC, keyring, rate-limit, webhook signing) — so that the audit identifies deviations rather than restating documented controls.

- **Next, traverse Lens 1 (Data-flow tracing)** by following user-controllable inputs (HTTP request body/query/header/cookie, env vars `process.env.*`, DB-stored content, OAuth callback parameters, webhook payload fields) through to security-sensitive sinks (Prisma `$queryRawUnsafe`, `child_process.exec*`, `fs` operations on caller-supplied paths, `fetch`/`axios` with caller-supplied URLs, response body composition, redirect destinations, HTML rendering, eval/Function/setTimeout(string)) across `apps/web`, `apps/api/v1`, `apps/api/v2`, `packages/lib`, `packages/features`, and `packages/app-store/*/api/`.

- **Next, traverse Lens 2 (Call-chain inspection)** by examining guard chains on each route handler (NextAuth → PermissionsGuard → PbacGuard → ThrottlerGuard ordering), tRPC procedure middleware composition, Prisma extension coverage (`exclude-locked-users`, `disallow-undefined-delete-update-many`), and audit-trail emission for sensitive operations (impersonation, role change, credential rotation, watchlist updates, booking deletion).

- **Next, traverse Lens 3 (Configuration review)** by reading `Dockerfile`, `apps/api/v2/Dockerfile`, `docker-compose.yml`, `.env.example`, `.env.appStore.example`, `.yarnrc.yml`, `apps/web/next.config.js`, `biome.json`, and every file under `.github/workflows/**` and `.github/actions/**` — looking for hardcoded secrets, ARG-leaked credentials, unsanitized GitHub Action inputs, `pull_request_target` misuse, missing minimum permissions, and unpinned third-party actions.

- **Next, traverse Lens 4 (Dependency declaration inspection)** by cross-referencing pinned versions in the root `package.json` `resolutions` block, `apps/{web,api/v1,api/v2}/package.json`, and `yarn.lock` against known-vulnerable version constraints — flagging any that are inherent agent knowledge as having documented CVEs. The accepted advisory for `fast-xml-parser@4.4.1` is documented as a baseline accepted exception, not a new finding.

- **Next, deduplicate and rank** all findings by severity (critical first, then high, medium, low) and within each severity by file path lexicographically, then by line number ascending — so that the output is deterministic.

- **Next, serialize the findings array** to `findings-config-a.json` with strict minification (no whitespace, no newlines, UTF-8 without BOM), and verify with `wc -l` and `python -m json.tool` (or equivalent) before considering the directive complete.

- **Finally, produce supporting artifacts** by writing `decision-log.md` (Markdown table of decisions) and `executive-summary.html` (reveal.js deck), each verified to render without errors.

### 0.5.2 Component Impact Analysis

**Direct modifications required:** None. This is a read-only audit. No file under `apps/**`, `packages/**`, `scripts/**`, `.github/**`, `deploy/**`, `docs/**`, `blitzy/**`, `blitzy-docs/**`, `agents/**`, or `specs/**` will be modified.

**Indirect impacts and dependencies:** None. Because no source files are modified:

- No import graph changes — no consumer of any existing module needs updating.
- No type contract changes — no `.d.ts` files or type-only imports are affected.
- No test invalidation — no Vitest or Playwright test needs re-execution as part of this configuration.
- No build pipeline activation — Turborepo's `build`, `lint`, `type-check` tasks are not triggered.
- No CI workflow runs — the three new root-level files are not bound to any workflow trigger.
- No runtime behavior change — the application's deployed binary is byte-identical before and after this audit.

**New components introduction:** Three new files at the repository root, none of which is a source-code module:

- `findings-config-a.json` — Data artifact. Schema: JSON array of finding objects. Consumed by external multi-config comparison tooling.
- `decision-log.md` — Documentation artifact. Schema: Markdown table. Consumed by stakeholders auditing the agent's reasoning.
- `executive-summary.html` — Presentation artifact. Schema: HTML document with embedded CSS/JS. Consumed by non-technical leadership in a browser.

Rationale for each:

- `findings-config-a.json` exists because CRITICAL Directive 2 mandates it as the audit's primary deliverable.
- `decision-log.md` exists because the Explainability rule mandates it independently of the audit task.
- `executive-summary.html` exists because the Executive Presentation rule mandates it for "every deliverable" independent of any other documentation.

### 0.5.3 User-Provided Examples Integration

The user provided one verbatim schema example, preserved here without modification:

> **User Example:** `[{"file":"<relative path>","line":<integer>,"severity":"<critical|high|medium|low>","cwe":"<CWE-ID>","description":"<max 200 chars>"},...]`

This example will be implemented in `findings-config-a.json` as follows:

- `file` — Relative path from the repository root using forward slashes. Example value: `apps/web/proxy.ts`.
- `line` — Integer (not a string, not a range). Example value: `42`.
- `severity` — Lowercase string literal from the set `{critical, high, medium, low}`. Example value: `"medium"`.
- `cwe` — String of the form `CWE-<integer>`, with `CWE-` prefix in uppercase and a hyphen separator. Example value: `"CWE-89"`.
- `description` — UTF-8 string of length 1–200 characters (inclusive) describing the specific code construct identified. Example value: `"SQL injection sink at $queryRawUnsafe with caller-supplied identifier"` (60 chars).

The trailing `,...` ellipsis in the example indicates the array may contain zero or more such objects. The empty-array case `[]` is the only valid serialization when no findings are identified. There is no syntactic difference between an array containing the schema example object and an empty array — both are valid single-line JSON.

### 0.5.4 Critical Implementation Details

**Specific design patterns to be employed:**

- **Severity calibration policy.** When CVSS data exists for a finding (typically for dependency advisories), the severity field is mapped from the CVSS v3.1 base score: `critical` (9.0–10.0), `high` (7.0–8.9), `medium` (4.0–6.9), `low` (0.1–3.9). For code-construct findings without published CVSS data, severity is assigned qualitatively based on exploitability (unauthenticated remote vs. requiring local access), blast radius (single-tenant vs. cross-tenant), and reversibility (transient vs. persistent).

- **CWE specificity policy.** When two CWE identifiers could apply, the deeper/leaf identifier wins (CWE-89 over CWE-707, CWE-1004 over CWE-200). When a finding genuinely spans multiple CWEs, the agent picks the one most representative of the root cause and notes the other in the description if space permits within the 200-character ceiling.

- **Deterministic ordering.** Findings are sorted by `(severity DESC, file ASC, line ASC)` before serialization. Severity ordering uses the explicit ranking `critical=4, high=3, medium=2, low=1`. This ensures byte-stable output across runs.

**Key algorithms and approaches:**

- **JSON serialization with no whitespace.** Python: `json.dumps(findings, separators=(',', ':'), ensure_ascii=False)`. Node: `JSON.stringify(findings)` (default behavior produces no whitespace). The output is written without a trailing newline character via explicit `sys.stdout.buffer.write` or `fs.writeFileSync(..., {flag: 'w'})` followed by length verification.

- **Post-write verification.** Three-step verification before declaring the artifact complete: (a) `cat findings-config-a.json | wc -l` returns `1`; (b) `python -m json.tool findings-config-a.json > /dev/null` exits with code 0; (c) `python -c "import json; arr=json.load(open('findings-config-a.json')); assert all(set(o.keys())=={'file','line','severity','cwe','description'} and len(o['description'])<=200 and o['severity'] in {'critical','high','medium','low'} for o in arr)"` exits with code 0.

**Integration strategies between components:** None — the three new files are independent artifacts at the repository root. They do not import each other and do not participate in any build pipeline.

**Data flow modifications required:** None — the application's data flow is unchanged because no source file is modified.

**Error handling and edge case considerations:**

- **Zero findings case.** If the audit identifies zero confidently classifiable vulnerabilities, the output is exactly `[]` (two characters, no whitespace, no newline). This is a valid JSON document and passes all four pass/fail gates.
- **High-volume findings case.** No upper bound is specified by the user; if findings exceed 1000, the JSON remains a single line regardless of size. File-system limits are not a practical concern at audit-realistic finding counts.
- **CWE uncertainty case.** When the agent cannot confidently select a CWE, the finding is omitted — the directive explicitly says "the most specific CWE you are confident about," which implicitly licenses dropping unclassifiable observations.
- **Description-ceiling overflow.** If the natural description exceeds 200 characters, it is truncated to the most informative 200-character prefix, with no ellipsis (the character count is the contract, not a content sentinel).
- **Encoding edge cases.** Non-ASCII characters in descriptions are encoded as UTF-8 bytes (no `\u` escapes). Code paths or identifiers that contain quotes or backslashes are JSON-escaped per RFC 8259.

**Performance and security considerations:**

- The audit itself executes in milliseconds to seconds — file inspection is the dominant cost, all I/O is local.
- The output JSON file contains no executable code and no secrets — every value is a metadata reference (path, line number, classification label, descriptive sentence).
- The decision log and executive presentation contain no secrets — they reference file paths and CWE identifiers, not credentials, tokens, or PII.

### 0.5.5 Audit Categories and CWE Coverage

The audit will inspect the following weakness categories, each anchored to the corresponding CWE family. This catalog defines the lens of attention; whether any specific finding is captured depends on the actual code observed in the repository.

| Category | Representative CWEs | Primary Source Locations |
|---|---|---|
| Injection — SQL | CWE-89, CWE-564 | `packages/prisma/**`, `apps/api/v2/src/modules/**/*.service.ts`, `apps/web/{app,pages}/api/**` (Prisma queries, raw SQL paths via `$queryRawUnsafe`) |
| Injection — Command/OS | CWE-78, CWE-77 | `scripts/**/*.{sh,ts,js}`, `apps/api/v2/src/**` (any `child_process` usage) |
| Injection — Code/Template | CWE-94, CWE-95, CWE-1336 | `packages/features/webhooks/lib/sendPayload.ts` (Handlebars 4.7.7 — `{{ }}` escaping vs. `{{{ }}}` raw), `packages/emails/**` |
| Injection — XML/XXE | CWE-611, CWE-776 | `packages/features/ee/sso/**` (BoxyHQ SAML XML parsing), `packages/app-store/**` (ICS/calendar XML) |
| Authentication — Bypass | CWE-287, CWE-288, CWE-294 | `packages/features/auth/lib/next-auth-options.ts`, `apps/api/v1/lib/helpers/verifyApiKey.ts`, `apps/api/v2/src/modules/auth/strategies/**` |
| Authentication — Brute Force | CWE-307 | `packages/features/auth/lib/next-auth-options.ts` (authorizeCredentials rate-limit), TOTP routes |
| Authentication — Weak Credentials | CWE-521, CWE-798, CWE-916 | `packages/lib/auth/{isPasswordValid,hashPassword}.ts`, `.env.example` (any default secrets) |
| Authorization — IDOR | CWE-639, CWE-285 | tRPC procedures, NestJS controllers, `canEditEntity`/`canAccessEntity` call sites |
| Authorization — Missing Check | CWE-862, CWE-863 | API v2 controllers without `@Permissions` or `@Pbac` decorators, API v1 routes without `verifyApiKey` |
| Cryptography — Broken/Weak | CWE-327, CWE-326, CWE-916 | `packages/lib/crypto/keyring.ts`, `packages/lib/crypto.ts`, any MD5/SHA-1 usage |
| Cryptography — Randomness | CWE-330, CWE-338 | API key generation, OAuth state nonce, CSP nonce, password reset tokens |
| Cryptography — Insecure JWT | CWE-347, CWE-345 | `signJwt.ts`, `oAuthAuthorization.ts`, NextAuth JWT decode paths |
| Secrets — Hardcoded | CWE-798, CWE-259 | `Dockerfile` ARG defaults (`NEXTAUTH_SECRET=secret`, `CALENDSO_ENCRYPTION_KEY=secret`), `.env.example`, source files |
| Secrets — Information Disclosure | CWE-532, CWE-209, CWE-200 | Logger calls, error message bodies, response shapes containing secrets/PII |
| SSRF | CWE-918 | Any outbound HTTP call with user-influenced URL — webhooks (`packages/features/webhooks/lib/sendPayload.ts`), OAuth callbacks, image proxies, `next.config.js` image domains |
| XSS — Reflected/Stored | CWE-79, CWE-80, CWE-87 | React `dangerouslySetInnerHTML` usage, untrusted Markdown rendering, `dompurify`/`sanitize-html` call coverage |
| CSRF | CWE-352 | NextAuth csrfToken cookie, OAuth state nonce in `encodeOAuthState.ts`, state-changing GET endpoints |
| Open Redirect | CWE-601 | NextAuth `callbackUrl` handling, post-login redirects, return-to cookies |
| Session — Cookie Attributes | CWE-1004, CWE-1275, CWE-614 | `packages/lib/default-cookies.ts`, `apps/web/proxy.ts` |
| Path Traversal | CWE-22, CWE-23 | Any `fs.readFile(callerInput)`, S3/B2 key construction from request data, ICS file dispatch |
| Insecure Deserialization | CWE-502 | JSON parsing of untrusted webhook bodies, OAuth state decoding |
| Race Conditions / TOCTOU | CWE-362, CWE-367 | Booking creation, double-spend in payments, idempotency-key extension coverage gaps |
| Improper Resource Shutdown | CWE-404, CWE-772 | Long-lived connection handlers, websocket-like flows |
| Dependency — Known Vulnerable | CWE-1104, CWE-937 | Root `package.json` resolutions, `yarn.lock`, per-workspace manifests |
| Dependency — Audit Acceptance | (none) | `.yarnrc.yml` `npmAuditIgnoreAdvisories` (documented exception, not a finding) |
| Misconfiguration — Container | CWE-732, CWE-668, CWE-269 | `Dockerfile`, `apps/api/v2/Dockerfile`, `docker-compose.yml` (USER, ARG, port exposure) |
| Misconfiguration — CI/CD | CWE-829, CWE-1395 | `.github/workflows/**` (unpinned actions, `pull_request_target`, secrets in logs) |
| Misconfiguration — Headers/CSP | CWE-693, CWE-1021, CWE-1275 | `apps/web/proxy.ts`, `apps/web/lib/csp.ts`, `apps/api/v2/src/bootstrap.ts` Helmet config |
| Resource Exhaustion / DoS | CWE-400, CWE-770, CWE-1333 | Unbounded loops, regex with catastrophic backtracking, missing rate-limit decorators |
| Improper Input Validation | CWE-20, CWE-129 | Zod schema coverage, NestJS ValidationPipe whitelist usage |

The catalog above is intentionally broader than any single finding set; it documents the audit's scan-of-attention, not its scan-of-result.

## 0.6 File Transformation Mapping

### 0.6.1 File-by-File Execution Plan

File Transformation Modes:
- **CREATE** — Create a new file
- **UPDATE** — Update an existing file (NOT USED in this audit)
- **DELETE** — Remove an obsolete file (NOT USED in this audit)
- **REFERENCE** — Use as an example, pattern, or read-only inspection target (the dominant mode for this audit)

| Target File | Transformation | Source File / Reference | Purpose / Changes |
|---|---|---|---|
| `findings-config-a.json` | CREATE | — | Minified single-line JSON array of CWE-classified vulnerability findings (CRITICAL Directive 2 — primary deliverable). Schema: `[{"file":"<path>","line":<int>,"severity":"<critical\|high\|medium\|low>","cwe":"CWE-<id>","description":"<≤200 chars>"},...]`. Encoding UTF-8, no trailing newline, no whitespace, no pretty-printing. Empty case: `[]`. |
| `decision-log.md` | CREATE | — | Markdown decision-log table per Explainability rule. Columns: Decision, Alternatives, Why, Risks. Includes severity-calibration boundary cases, CWE-selection rationale for near-equivalent candidates, audit-scope-boundary entries, and at minimum one explicit deviation entry covering the gap between user-stated "1 new file" and the three rule-mandated outputs. |
| `executive-summary.html` | CREATE | — | Self-contained reveal.js executive deck per Executive Presentation rule. 12–18 slides (target 16), Blitzy brand palette, Inter/Space Grotesk/Fira Code via Google Fonts CDN, reveal.js 5.1.0 + Mermaid 11.4.0 + Lucide 0.460.0 from pinned CDN. Slide ordering: Title → Headline KPIs → Architecture/Methodology Diagram → Section Dividers + Content alternating → Closing. Zero emoji; every slide has ≥1 non-text visual. |
| `apps/web/**/*.{ts,tsx,js,jsx}` | REFERENCE | — | Next.js 16.1.5 web app — App Router, Pages Router, ~180 API routes, edge proxy, CSP builder. Inspected for data-flow vulnerabilities, missing guards, XSS sinks, redirect handling. |
| `apps/web/proxy.ts` | REFERENCE | — | Edge middleware — header sanitization, CSP nonce injection, signup-disabled toggle, embed COEP/COOP. Inspected for header-smuggling defenses and matcher coverage. |
| `apps/web/lib/csp.ts` | REFERENCE | — | CSP policy builder — 22-byte nonce, login-only enforcement. Inspected for directive completeness. |
| `apps/web/next.config.js` | REFERENCE | — | Next.js config — rewrites, headers, image domains, env exposure. Inspected for unsafe rewrites and overly permissive image allow-lists. |
| `apps/web/{pages,app}/api/**` | REFERENCE | — | Web API routes (~180 dirs). Inspected for auth coverage, input validation, sensitive operation audit emission. |
| `apps/api/v1/**/*.{ts,js}` | REFERENCE | — | Legacy Next.js API — 37 endpoint groups. Inspected for `verifyApiKey` coverage, rate-limit hookup, query-parameter trust. |
| `apps/api/v1/lib/helpers/verifyApiKey.ts` | REFERENCE | — | API key verification — license check, hash comparison, auto-lock. Inspected for time-of-check/time-of-use and bypass paths. |
| `apps/api/v1/lib/helpers/rateLimitApiKey.ts` | REFERENCE | — | API v1 rate limit — auto-lock trigger. Inspected for differential 401/429 response semantics. |
| `apps/api/v2/src/**/*.ts` | REFERENCE | — | NestJS API — 30+ modules. Inspected for guard ordering, validation pipe coverage, exception filter order, `@Permissions`/`@Pbac` decorator presence. |
| `apps/api/v2/src/bootstrap.ts` | REFERENCE | — | API v2 bootstrap — Helmet, CORS allow-list, ValidationPipe whitelist+transform, exception filter ordering. Inspected for permissive `ALLOWED_ORIGINS` fallback and header allow-list overreach. |
| `apps/api/v2/src/modules/auth/guards/**/*.ts` | REFERENCE | — | API v2 auth guards — ApiAuthGuard, PermissionsGuard, PbacGuard, CustomThrottlerGuard. Inspected for bypass conditions and trusted-credential overreach. |
| `apps/api/v2/src/modules/auth/strategies/**/*.ts` | REFERENCE | — | API v2 auth strategies — multi-method classification (NextAuth/OAuth-Basic/API-key/Access-Token/Third-Party). Inspected for cross-strategy contamination. |
| `apps/api/v2/src/vercel-webhook.guard.ts` | REFERENCE | — | Inbound Vercel webhook — HMAC-SHA1 + timingSafeEqual. Inspected for raw-body capture correctness. |
| `apps/api/index.js` | REFERENCE | — | Connect proxy gateway on port 3002. Inspected for SSRF, host-header trust, prefix-routing logic. |
| `packages/lib/auth/**/*.ts` | REFERENCE | — | Auth helpers — `hashPassword.ts` (bcryptjs 12 rounds), `isPasswordValid.ts` (strict/non-strict modes). Inspected for hashing strength and policy coverage. |
| `packages/lib/crypto/keyring.ts` | REFERENCE | — | AES-256-GCM keyring with rotation. Inspected for AAD correctness, key-length assertion (32 bytes), `decryptAndMaybeReencrypt` race conditions. |
| `packages/lib/crypto.ts` | REFERENCE | — | Legacy AES-256-CBC. Inspected for IV reuse, padding-oracle exposure, 32-byte Latin1 key derivation. |
| `packages/lib/default-cookies.ts` | REFERENCE | — | NextAuth cookie config — `__Secure-` prefix, httpOnly, sameSite. Inspected for nonce-cookie sameSite override correctness. |
| `packages/lib/rateLimit.ts` | REFERENCE | — | 8-namespace rate limit via `@unkey/ratelimit`. Inspected for permissive fallback when `UNKEY_ROOT_KEY` missing. |
| `packages/lib/checkRateLimitAndThrowError.ts` | REFERENCE | — | 429 HttpError helper. Inspected for identifier construction (hashEmail). |
| `packages/lib/server/queries/teams/index.ts` | REFERENCE | — | `isTeamAdmin/Owner/Member` predicates. Inspected for membership-state preconditions. |
| `packages/lib/entityPermissionUtils.ts` | REFERENCE | — | `canEditEntity/canAccessEntity/getEntityPermissionLevel`. Inspected for ownership-check completeness. |
| `packages/features/auth/lib/next-auth-options.ts` | REFERENCE | — | Canonical NextAuth config. Inspected for `authorizeCredentials` flow, admin downgrade, provider registration, JWT encode timeout handling. |
| `packages/features/auth/lib/signJwt.ts` | REFERENCE | — | jose HS256 magic-link JWT (2-min expiry). Inspected for algorithm pinning and secret source. |
| `packages/features/auth/lib/verifyPassword.ts` | REFERENCE | — | bcryptjs constant-time compare. Inspected for hash format trust. |
| `packages/features/auth/lib/oAuthAuthorization.ts` | REFERENCE | — | Legacy OAuth jsonwebtoken (HS256). Inspected for algorithm restriction and verification call shape. |
| `packages/features/pbac/services/**/*.ts` | REFERENCE | — | PBAC services — PermissionCheckService, RoleService, PBACRoleManager, LegacyRoleManager, RoleManagementFactory. Inspected for last-owner protection, wildcard match correctness, fallback-array safety. |
| `packages/features/pbac/lib/resource-permissions.ts` | REFERENCE | — | `getResourcePermissions`, `getSpecificPermissions`. Inspected for scope leakage. |
| `packages/features/pbac/infrastructure/**` | REFERENCE | — | Permission/Role repositories, Zustand store. Inspected for client/server boundary respect. |
| `packages/features/webhooks/lib/sendPayload.ts` | REFERENCE | — | Outbound HMAC-SHA256 signing, `redirect: "manual"`, FIFO template cache. Inspected for empty-secret behavior and template-injection escaping (`{{ }}` vs `{{{ }}}`). |
| `packages/features/webhooks/lib/handleWebhookScheduledTriggers.ts` | REFERENCE | — | Scheduled dispatch signing. Inspected for parallel `Promise.allSettled` isolation. |
| `packages/features/webhooks/lib/schedulePayload.ts` | REFERENCE | — | Tasker queue dispatch. Inspected for queue-poisoning resistance. |
| `packages/features/webhooks/lib/sendOrSchedulePayload.ts` | REFERENCE | — | `TASKER_ENABLE_WEBHOOKS` routing. Inspected for fallback safety. |
| `packages/features/ee/sso/lib/{jackson,saml,sso}.ts` | REFERENCE | — | BoxyHQ Jackson SAML integration. Inspected for SAML assertion verification, signature validation, replay protection, audience binding. |
| `packages/features/ee/impersonation/lib/ImpersonationProvider.ts` | REFERENCE | — | PBAC impersonation + audit trail. Inspected for self-impersonation, role-elevation, audit-record completeness. |
| `packages/features/credentials/services/CredentialDataService.ts` | REFERENCE | — | Credential encryption orchestration. Inspected for AAD construction and null-on-failure semantics. |
| `packages/features/ee/common/server/private-api-utils.ts` | REFERENCE | — | Nonce + HMAC-SHA256 private API signing. Inspected for replay window and nonce entropy. |
| `packages/features/booking-audit/lib/service/BookingAuditViewerService.ts` | REFERENCE | — | Audit log read service. Inspected for authZ on viewer surface. |
| `packages/app-store/{btcpayserver,hitpay,alby}/api/webhook.ts` | REFERENCE | — | Inbound HMAC webhooks. Inspected for raw-body capture, timing-safe compare, header verification. |
| `packages/app-store/**/api/webhook.ts` | REFERENCE | — | All third-party webhook handlers. Inspected for signature verification completeness across 80+ integration adapters. |
| `packages/app-store/_utils/oauth/encodeOAuthState.ts` | REFERENCE | — | OAuth state CSRF — `randomUUID` nonce + HMAC-SHA256 binding to `userId`. Inspected for `NONCE_EXEMPT_APPS` scope and `timingSafeEqual` comparison. |
| `packages/prisma/schema.prisma` | REFERENCE | — | Database schema. Inspected for missing `@unique` constraints, sensitive fields lacking encryption-at-rest, model-level access leak risks. |
| `packages/prisma/extensions/**/*.ts` | REFERENCE | — | `exclude-locked-users`, `exclude-pending-payment-teams`, `disallow-undefined-delete-update-many`, `booking-idempotency-key`. Inspected for extension coverage of sensitive Prisma operations. |
| `packages/prisma/selects/credential.ts` | REFERENCE | — | `safeCredentialSelect` omits `encryptedKey`. Inspected for accidental usage of unsafe alternative `credentialForCalendarServiceSelect` in non-calendar paths. |
| `packages/prisma/migrations/**` | REFERENCE | — | 589 migrations. Inspected for additive-only invariant (no column drops/renames) and any SQL containing privilege grants. |
| `packages/emails/**/*.ts` | REFERENCE | — | Email service dispatchers, template catalog, nodemailer 7.0.12 usage. Inspected for header injection, template injection, email-content sanitization. |
| `packages/sms/**/*.ts` | REFERENCE | — | SMS/WhatsApp via Twilio. Inspected for rate-limit coverage, recipient validation, content sanitization. |
| `packages/embeds/{embed-core,embed-react,embed-snippet}/**` | REFERENCE | — | Three-package embed suite. Inspected for postMessage origin validation, custom-element attribute trust, iframe sandbox correctness. |
| `packages/trpc/**/*.ts` | REFERENCE | — | Shared tRPC server/client. Inspected for procedure middleware chain, context construction, superjson deserialization safety. |
| `packages/platform/libraries/pbac.ts` | REFERENCE | — | Platform barrel re-exports. Inspected for accidental private-API exposure. |
| `scripts/*.sql` | REFERENCE | — | `auto-grant.sql`, `delete-empty-google-credentials.sql`, `find-email-case-insensitive-duplicates.sql`, `get-table-storage-sizes.sql`, `connection-activity.sql`. Inspected for dangerous DDL, privilege grants, and missing transaction safety. |
| `scripts/*.sh` | REFERENCE | — | `staging-deploy.sh`, `replace-placeholder.sh`. Inspected for unquoted variable expansion, command injection, and unsafe `eval`/`source` patterns. |
| `scripts/seed-*.ts` | REFERENCE | — | Seed scripts. Inspected for default credentials, hardcoded secrets, and write paths that could be triggered in production. |
| `Dockerfile` | REFERENCE | — | Web/main Dockerfile. Inspected for ARG-leaked secrets (`NEXTAUTH_SECRET=secret`, `CALENDSO_ENCRYPTION_KEY=secret` defaults visible at line 11–12 of Dockerfile), USER directive presence, image base pinning. |
| `apps/api/v2/Dockerfile` | REFERENCE | — | API v2 container build. Inspected for USER directive, multi-stage controls, secret hygiene. |
| `docker-compose.yml` | REFERENCE | — | Local compose. Inspected for default credentials in env blocks, exposed ports, volume mounts of sensitive paths. |
| `.env.example`, `.env.appStore.example` | REFERENCE | — | Env templates. Inspected for example values that could be mistaken for production defaults, missing entries for security-relevant vars. |
| `.yarnrc.yml` | REFERENCE | — | Yarn config. Inspected for registry trust and the `npmAuditIgnoreAdvisories` exception (`fast-xml-parser@4.4.1` — documented). |
| `package.json` (root) | REFERENCE | — | Root manifest. Inspected for pinned resolutions, engines (`node>=20`, `yarn>=4.12.0`), and any scripts that could be hijacked via lifecycle hooks. |
| `apps/{web,api/v1,api/v2}/package.json` | REFERENCE | — | Per-workspace dependency declarations. Inspected for divergent versions of security-critical packages. |
| `yarn.lock` | REFERENCE | — | Transitive resolution truth. Inspected for known-vulnerable transitive versions. |
| `.github/workflows/*.{yml,yaml}` | REFERENCE | — | 20+ GitHub Actions workflows. Inspected for `pull_request_target` misuse, unpinned third-party actions, `secrets:` exposure in logs, missing minimum permissions, `if: contains(github.event.pull_request.title, ...)` injection. |
| `.github/actions/*/action.yml` | REFERENCE | — | 10+ composite actions. Inspected for `${{ inputs.* }}` expansion in `run:` blocks (command injection), output safety. |
| `biome.json`, `biome-staged.json` | REFERENCE | — | Linter rules. Inspected for missing security-relevant rules. |
| `playwright.config.ts`, `vitest.workspace.ts`, `checkly.config.ts` | REFERENCE | — | Test runner config. Inspected for secrets in fixtures and environment exposure. |
| `app.json` | REFERENCE | — | Heroku buildpack config. Inspected for env exposure. |
| `turbo.json` | REFERENCE | — | Turborepo config. Inspected for env passing to remote cache. |

### 0.6.2 New Files Detail

- **`findings-config-a.json`** — Audit deliverable artifact (primary)
    - Content type: data (JSON)
    - Based on: User-provided schema preserved verbatim in §0.5.3
    - Key structural properties: single-line UTF-8 JSON array; each element is an object with exactly five keys (`file`, `line`, `severity`, `cwe`, `description`); `severity` ∈ `{critical, high, medium, low}`; `cwe` matches `^CWE-\d+$`; `description` ≤ 200 chars
    - Verification: `wc -l == 1`, `python -m json.tool < findings-config-a.json` exits 0, all-field-presence check exits 0

- **`decision-log.md`** — Explainability rule deliverable
    - Content type: documentation (Markdown)
    - Based on: Explainability rule schema — Markdown table with columns Decision / Alternatives / Why / Risks
    - Key sections (rows expected at minimum):
        - Decision: "Treat the audit as read-only" — Alternatives considered, rationale anchored in CRITICAL Directive 1
        - Decision: "Adopt 4-lens methodology" — Alternatives considered, rationale anchored in user mandate
        - Decision: "Use CVSS-band severity mapping where data exists" — Alternatives considered
        - Decision: "Prefer CWE leaf nodes over parent categories" — Alternatives considered
        - Decision: "Sort findings by (severity DESC, file ASC, line ASC) for byte-stable output" — Alternatives considered
        - Decision: "Omit unclassifiable findings" — Alternatives considered, anchored in "the most specific CWE you are confident about"
        - Decision: "Three deliverables instead of one" — DEVIATION entry from user's stated "1 new file"; explicit Explainability + Executive Presentation rule citation as justification
    - Verification: file parses as valid Markdown, table has all rows complete, every deviation has an explicit entry

- **`executive-summary.html`** — Executive Presentation rule deliverable
    - Content type: self-contained HTML presentation
    - Based on: Executive Presentation rule schema — reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0, Blitzy brand palette, Inter/Space Grotesk/Fira Code Google Fonts
    - Key slide structure (16 slides target):
        1. Title slide — project name "blitzy-cal Security Audit", scope "Config A Baseline", audience "Non-technical leadership"
        2. Headline KPIs — Total findings count, severity distribution (KPI cards)
        3. Methodology — Mermaid diagram of 4-lens audit approach
        4. Section divider — "Scope"
        5. Audit Scope — codebase summary table (workspaces, files, lines)
        6. Section divider — "Findings"
        7. Severity Distribution — KPI/Mermaid breakdown
        8. CWE Distribution — table of top CWEs by count
        9. Section divider — "Risk and Architecture"
        10. Risk Heatmap — Mermaid by category
        11. Architecture Context — Mermaid simplified system diagram
        12. Section divider — "Onboarding"
        13. Team Onboarding — how to consume `findings-config-a.json`
        14. Section divider — "Forward Path"
        15. Recommended Next Steps — top 3–4 mitigation tracks
        16. Closing — key takeaway, brand lockup, gradient accent bar
    - Verification: opens in browser, renders all Mermaid diagrams and Lucide icons, contains 12–18 `<section>` elements, every `<section>` contains ≥1 non-text visual element

### 0.6.3 Files to Modify Detail

No existing files are modified. This audit is read-only per CRITICAL Directive 1's "audit" framing and the user's annotation `~0 files modified`.

### 0.6.4 Configuration and Documentation Updates

No configuration changes:
- No `package.json` updates
- No `.yarnrc.yml` changes (the accepted `fast-xml-parser@4.4.1` advisory remains intact)
- No `Dockerfile` / `docker-compose.yml` changes
- No `.env.example` updates
- No GitHub Actions workflow changes
- No Prisma schema or migration changes
- No biome / vitest / playwright / checkly config changes

No documentation updates beyond rule-mandated outputs:
- `README.md` unchanged
- `SECURITY.md` unchanged (preserves existing `security@cal.com` disclosure contact and 3-business-day SLA)
- `PERMISSIONS.md` unchanged
- Technical-specification sections unchanged
- The only documentation artifact added is `decision-log.md` per Explainability rule
- The only presentation artifact added is `executive-summary.html` per Executive Presentation rule

### 0.6.5 Cross-File Dependencies

No cross-file dependencies are created or modified:
- The three new files at the repository root do not import or reference any source module.
- No existing file gains or loses imports.
- No type contracts shift.
- The `findings-config-a.json` artifact is data-only — it does not participate in TypeScript compilation, ESLint linting, Biome formatting, or Turborepo task graph.
- The `decision-log.md` artifact is plain Markdown — no MDX expansion, no front matter parsing, no Mintlify build participation.
- The `executive-summary.html` artifact loads all runtime dependencies from public CDNs — no Node.js module graph participation.

## 0.7 Rules

### 0.7.1 User-Specified Rules

The user supplied two explicit project rules. Both apply to this configuration and are captured here verbatim in summary, with implementation-binding clauses extracted.

#### Rule 1 — Explainability

**Verbatim (summarized):** "Every non-trivial implementation decision MUST be documented with rationale. A decision is non-trivial if a competent engineer could reasonably have chosen differently. Deliver a decision log as a Markdown table: what was decided, what alternatives existed, why this choice was made, and what risks it carries. For migrations or refactors, include a bidirectional traceability matrix mapping source constructs to target implementations — 100% coverage, no gaps. Any deviation from a literal or obvious interpretation of the requirements MUST have an explicit entry in the decision log. Unexplained deviations are treated as defects. Do not embed rationale in code comments. The decision log is the single source of truth for 'why' decisions."

**Implementation-binding clauses for this audit:**

- MUST CREATE `decision-log.md` at repository root.
- MUST format as a Markdown table with columns at least covering: Decision, Alternatives, Why, Risks.
- MUST include an entry for every non-trivial decision; the audit identifies the following classes of non-trivial decisions: (a) severity-calibration boundaries between adjacent CVSS bands, (b) CWE selection when two leaf-node CWEs both apply, (c) inclusion/exclusion threshold for low-confidence findings, (d) scope-boundary decisions (what counts as "code" vs. "documentation"), (e) deviation entries.
- MUST include an explicit deviation entry covering the gap between the user's stated `[~0 files modified | 1 new file]` and the actual three new files produced (`findings-config-a.json` + `decision-log.md` + `executive-summary.html`), with the Explainability rule and Executive Presentation rule cited as authoritative justifications.
- MUST NOT embed any of the above rationale in code comments — `decision-log.md` is the single source of truth.
- Traceability matrix N/A — this is a security audit, not a migration or refactor.

#### Rule 2 — Executive Presentation

**Verbatim (summarized):** "Every deliverable MUST include an executive summary as a single self-contained reveal.js HTML file that is ALWAYS included independent of any other documentation that exists. The audience is non-technical leadership — communicate business value, risk, and operational readiness without requiring code literacy."

**Implementation-binding clauses for this audit:**

- MUST CREATE `executive-summary.html` at repository root, ALWAYS, independent of `decision-log.md` and `findings-config-a.json`.
- MUST cover: (1) What was done — scope of work and deliverables; (2) Why it was done — business value unlocked; (3) What changed architecturally — component/data-flow diagrams; (4) What risks exist and how they are mitigated; (5) How the team onboards and continues development.
- MUST be a single self-contained HTML file, no build steps, no local file dependencies.
- MUST contain 12–18 `<section>` elements (target 16), four slide types (`slide-title`, `slide-divider`, default content, `slide-closing`).
- MUST include at least one non-text visual element per slide (Mermaid diagram, KPI card, styled table, or Lucide SVG icon).
- MUST contain content-slide constraints: max 4 bullets, max 40 words body text, min 1 non-text visual.
- MUST use ZERO emoji — use Lucide SVG icons via `<i data-lucide="icon-name"></i>` only.
- MUST NOT include fenced code blocks inside slides; inline Fira Code for short expressions is permitted.
- MUST use Blitzy brand palette: `#5B39F3` primary, `#2D1C77` dark, `#94FAD5` teal accent, `#1A105F` navy, `#7A6DEC`/`#4101DB` gradient stops; neutrals `#333333`, `#999999`, `#D9D9D9`, `#F4EFF6`, `#F5F5F5`, `#FFFFFF`.
- MUST load fonts: Inter (body 400/500/600/700), Space Grotesk (display 500/600/700), Fira Code (mono/eyebrows 400/500) via Google Fonts `<link>`.
- MUST use hero gradient on title: `linear-gradient(68deg, #7A6DEC 15.56%, #5B39F3 62.74%, #4101DB 84.44%)` with white text and eyebrow in Fira Code teal.
- MUST use dividers with dark purple `#2D1C77` or gradient background, large centered heading, thematic Lucide icon.
- MUST use closing slide with navy `#1A105F` background, 3–6 word takeaway heading, max 3 bullets, brand lockup, gradient accent bar.
- MUST embed Mermaid diagrams as `<pre class="mermaid">` with raw syntax, initialize with `startOnLoad: false`, call `mermaid.run()` after reveal.js `ready` and on every `slidechanged`.
- MUST configure Mermaid theme: `primaryColor: '#F2F0FE'`, `primaryTextColor: '#333333'`, `primaryBorderColor: '#5B39F3'`, `lineColor: '#999999'`, `secondaryColor: '#F4EFF6'`.
- MUST CDN-pin: reveal.js 5.1.0, Mermaid 11.4.0, Lucide 0.460.0.
- MUST configure reveal.js with `hash: true`, `transition: 'slide'`, `controlsTutorial: false`, `width: 1920`, `height: 1080`.
- MUST call `lucide.createIcons()` after `ready` and on every `slidechanged` event.
- MUST embed the full Blitzy reveal.js theme inline in a `<style>` tag with the required CSS custom properties defined in the rule.
- MUST follow slide ordering: Title → Headline/KPI → Architecture (Mermaid) → alternating Section Dividers + Content for each major topic → Closing.

### 0.7.2 Implicit Rules Derived From User Input

- **Rule (derived): JSON minification is non-negotiable.** The user's pass/fail explicitly tests `wc -l == 1` AND valid-JSON parsing AND all-five-fields populated AND description ≤200 chars. The audit treats these four conditions as a single atomic gate.
- **Rule (derived): No external scanners may be invoked.** The audit pipeline does not run npm audit, `yarn audit`, Snyk CLI, Semgrep, CodeQL, or any other scanner. The agent's native code-comprehension is the only discovery channel.
- **Rule (derived): The output is deterministic.** Because Config A is a baseline control, the same audit on the same codebase snapshot must produce the same findings set. The agent achieves this via deterministic ordering (severity DESC, file ASC, line ASC) and consistent severity-band semantics.
- **Rule (derived): CWE specificity is preferred.** "The most specific CWE you are confident about" implicitly de-prioritizes generic parent-category CWEs (CWE-707, CWE-693) when more specific children are confidently applicable.
- **Rule (derived): The schema is closed.** Each finding object has exactly the five named keys — no additional metadata fields (no `tool`, no `confidence`, no `references`).

## 0.8 Special Instructions

### 0.8.1 Special Execution Instructions

- **Read-only execution.** No edits to any file under `apps/**`, `packages/**`, `scripts/**`, `.github/**`, `deploy/**`, `docs/**`, `blitzy/**`, `blitzy-docs/**`, `agents/**`, `specs/**`, `__checks__/**`, `example-apps/**`, or any other existing source tree.
- **No tool installation.** No `yarn add`, `yarn upgrade`, `npm install`, `pip install`, `apt-get install`, or equivalent operation that mutates the dependency or system state. The audit operates with the toolchain already present in the environment.
- **No build, no test, no deploy.** Turborepo's `build`, `lint`, `type-check`, `test`, `e2e` tasks are not invoked. Playwright is not executed. Vitest is not executed. Checkly is not deployed.
- **No external network calls for vulnerability discovery.** The audit's discovery channel is the local repository. Web search may be used for CWE definition reference and library-CVE confirmation only — never for fetching scanner rules or external vulnerability databases.
- **No invocation of vulnerability scanners.** Explicitly excluded: Snyk CLI, Semgrep CLI/SaaS, CodeQL, GitHub Advanced Security, Bandit, ESLint security plugins, OWASP Dependency-Check, Trivy, Grype, OSV-Scanner, Mend (WhiteSource), Sonatype, Sonar, Checkmarx, Veracode, Fortify, and any other commercial or open-source SAST/SCA/DAST tool.
- **Single-line JSON enforcement.** The output `findings-config-a.json` MUST NOT contain `\n`, `\r`, `\t`, or any whitespace between JSON tokens. Verification: `wc -l < findings-config-a.json` returns `1`; absence of trailing newline can be confirmed via `xxd | tail -1`.
- **UTF-8 encoding without BOM.** The file is plain UTF-8 (no byte-order mark). Non-ASCII characters appear as literal UTF-8 bytes, not as `\uXXXX` escapes.
- **Empty array is the valid zero-finding output.** If no vulnerabilities are identified with sufficient CWE-classification confidence, write exactly `[]` (two characters: `0x5B`, `0x5D`).
- **Three deliverables produced together.** Although the user's annotation says "1 new file," the rules require three. The deviation is captured explicitly in `decision-log.md`.

### 0.8.2 Constraints and Boundaries

**Technical constraints specified by the user:**

- Audit method is bounded to "native agent analysis" — no third-party scanners.
- Output schema is fixed: five fields per finding, four-value severity vocabulary, integer line numbers, ≤200-char descriptions.
- File format is single-line, valid, minified UTF-8 JSON.

**Process constraints (what should / shouldn't be done):**

- DO trace data flows from sources to sinks.
- DO follow call chains across module boundaries.
- DO examine configuration files.
- DO inspect dependency declarations.
- DO classify every finding with the most specific confident CWE.
- DO produce the rule-mandated decision log and executive presentation.
- DO NOT install scanners.
- DO NOT modify source code.
- DO NOT add tests.
- DO NOT change dependencies.
- DO NOT bypass the JSON schema (no extra fields, no missing fields, no schema variants).

**Output constraints (what should / shouldn't be generated):**

- DO generate `findings-config-a.json` at the repository root (no subdirectory).
- DO generate `decision-log.md` at the repository root.
- DO generate `executive-summary.html` at the repository root as a fully self-contained HTML file.
- DO NOT generate scanner reports, SARIF files, CSV exports, or alternative finding formats.
- DO NOT generate fix PRs, remediation snippets, or pseudo-patches.
- DO NOT generate test fixtures, fuzzing harnesses, or proof-of-concept exploit code.
- DO NOT generate per-finding evidence trees, call graphs, or supplementary attachments.

**Timeline / dependency constraints:**

- None specified. The user provides no temporal deadline — the audit completes when all four lenses have been traversed and the three artifacts are present and verified.

**Compatibility requirements:**

- The audit output must remain consumable by downstream multi-config comparison tooling that expects the exact five-field schema. Schema additions, even backward-compatible ones, would break parity with the other configurations being compared.
- The `executive-summary.html` must render correctly in modern browsers (Chrome 120+, Firefox 121+, Safari 17+, Edge 120+) without local dependencies.
- The `decision-log.md` must render correctly in standard Markdown viewers (GitHub-Flavored Markdown, VS Code preview, Mintlify).

### 0.8.3 Quality Criteria

- **Determinism.** Re-running the audit on an unchanged codebase yields the same findings set (post-sort).
- **Specificity.** CWE identifiers are leaf nodes where possible; descriptions name the specific code construct, not the generic CWE definition.
- **Conservatism.** Findings reflect confident classifications only; low-confidence observations are omitted rather than inflated.
- **Schema integrity.** Every finding object has exactly the five required keys with correctly typed values.
- **Reproducibility.** The output JSON is byte-stable across runs given identical input.

## 0.9 References

### 0.9.1 Citation Discipline

This Agent Action Plan applies the citation convention `[<path>:<locator>]` for every claim about the existing system. Locators are line ranges, section headings, or key paths as natural to the file type. Claims marked `[inferred — no direct source]` represent reasoned inferences flagged for downstream verification.

Representative citations referenced in this AAP:

- `[package.json:L170-L173]` — root engines block declares `npm >=7.0.0`, `yarn >=4.12.0`, packageManager `yarn@4.12.0`.
- `[package.json:L120-L162]` — root `resolutions` block pins axios 1.13.5, lodash 4.17.23, jsonwebtoken 9.0.0, jws 4.0.1, qs 6.14.1, node-forge 1.3.2, validator 13.15.22, tar 7.5.7, form-data 4.0.4, dayjs 1.11.4 (patched), among others.
- `[Dockerfile:L1]` — `FROM --platform=$BUILDPLATFORM node:20 AS builder` confirms Node.js 20 runtime.
- `[Dockerfile:L11-L12]` — `ARG NEXTAUTH_SECRET=secret` and `ARG CALENDSO_ENCRYPTION_KEY=secret` confirm default secret ARGs visible to audit Lens 3.
- `[.yarnrc.yml:npmAuditIgnoreAdvisories]` — accepted exception for `fast-xml-parser@4.4.1` (per Tech Spec §3.3.6).
- `[apps/api/index.js]` — Connect proxy gateway on port 3002, forwarding `/v2` to port 3004 (per Tech Spec §1.2.2).
- `[apps/web/proxy.ts]` — edge middleware with CSP nonce injection, header sanitization, signup-disabled toggle (per Tech Spec §6.4.4.5).
- `[apps/web/lib/csp.ts:L8]` — `process.env.CSP_POLICY` is read; CSP enforcement is matcher-scoped to login pages.
- `[packages/lib/crypto/keyring.ts]` — AES-256-GCM keyring with rotation via `decryptAndMaybeReencrypt` (per Tech Spec §6.4.4.2).
- `[packages/lib/crypto.ts]` — legacy AES-256-CBC with `CALENDSO_ENCRYPTION_KEY` (per Tech Spec §6.4.4.3).
- `[packages/lib/auth/hashPassword.ts]` — bcryptjs with 12 rounds (per Tech Spec §6.4.2.6).
- `[packages/features/auth/lib/next-auth-options.ts]` — canonical NextAuth config including `authorizeCredentials`, admin downgrade, provider registration (per Tech Spec §6.4.2.1).
- `[packages/features/auth/lib/signJwt.ts]` — jose HS256 magic-link JWT with 2-minute expiry (per Tech Spec §6.4.2.5).
- `[packages/features/webhooks/lib/sendPayload.ts]` — HMAC-SHA256 outbound signing with `X-Cal-Signature-256` and `redirect: "manual"` (per Tech Spec §6.4.4.8).
- `[apps/api/v2/src/bootstrap.ts]` — Helmet, CORS allow-list, ValidationPipe whitelist+transform, exception filter ordering (per Tech Spec §6.4.4.5).
- `[apps/api/v2/src/modules/auth/guards/pbac/pbac.guard.ts]` — NestJS PBAC guard with Redis cache TTL 300s (per Tech Spec §6.4.3.4).
- `[apps/api/v2/src/modules/auth/guards/permissions/permissions.guard.ts]` — Platform OAuth permission enforcement (per Tech Spec §6.4.3.6).
- `[packages/features/pbac/services/pbac-role-manager.service.ts:validateNotLastOwner]` — last-owner protection (per Tech Spec §6.4.3.3).
- `[packages/lib/rateLimit.ts]` — `@unkey/ratelimit` with 8 namespaces (per Tech Spec §6.4.4.6).
- `[packages/lib/default-cookies.ts]` — NextAuth cookie config with `__Secure-` prefix and sameSite semantics (per Tech Spec §6.4.2.4).
- `[packages/prisma/schema.prisma]` — Prisma model definitions for audit-relevant tables (per Tech Spec §6.2).
- `[packages/prisma/migrations/]` — 589 chronological migrations from `20210605225044_init` through latest (per Tech Spec §1.2.1).
- `[SECURITY.md]` — disclosure policy: `security@cal.com`, 3-business-day SLA, RFC 9116 security.txt alignment (per Tech Spec §6.4.6.2).
- `[PERMISSIONS.md]` — legacy-to-PBAC mapping documentation (per Tech Spec §6.4.3.2).
- Inferred claim: `[inferred — no direct source]` — applied to any claim about a specific finding's exploitability that depends on runtime context not directly observable in the static source.

### 0.9.2 Search Log Appendix

The following table documents the comprehensive set of repository search and inspection operations conducted to derive the conclusions in this Agent Action Plan.

| # | Tool | Target | Purpose | Result Used |
|---|---|---|---|---|
| 1 | `get_source_folder_contents` | `""` (root) | Inventory root-level files and folders | 35 files + 22 folders enumerated |
| 2 | `bash` | `find /tmp/environments_files` | Check for user-provided environment files | None — no attachments |
| 3 | `bash` | `find / -name .blitzyignore` | Locate ignore-pattern files | None present |
| 4 | `read_file` | `package.json` (lines 1-50) | Identify workspaces and scripts | 12 workspace patterns confirmed |
| 5 | `read_file` | `package.json` (lines 50-180) | Identify devDependencies, resolutions, engines | Pinned versions captured |
| 6 | `bash` | `cat .nvmrc; head -20 Dockerfile` | Identify runtime version | Node.js 20 confirmed from `FROM node:20` |
| 7 | `bash` | `find apps packages -name package.json -not -path "*/node_modules/*"` | Count workspace manifests | 117 manifests |
| 8 | `bash` | `find . -maxdepth 3 -name "yarn.lock"` | Confirm single lockfile | `./yarn.lock` only |
| 9 | `bash` | `find . -name ".env*example*"` | Locate env templates | `.env.example`, `.env.appStore.example`, `example-apps/credential-sync/.env.example` |
| 10 | `bash` | `find apps/api/v1/pages/api -maxdepth 2 -type d` | Count v1 endpoint groups | 37 groups |
| 11 | `bash` | `find apps/web/{pages,app}/api -type d` | Count web API route directories | ~180 directories |
| 12 | `bash` | `find apps/api/v2/src/modules -maxdepth 1 -type d` | Count v2 API modules | 30+ modules |
| 13 | `bash` | `find apps packages -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx"` | Count source files | 7,399 |
| 14 | `bash` | `ls packages/prisma/migrations \| wc -l` | Count migrations | 589 |
| 15 | `bash` | `ls scripts/` | Enumerate utility scripts | 20+ scripts including SQL, shell, TS |
| 16 | `bash` | `find .github -name "*.yml"` | Enumerate CI workflows | 20+ workflows |
| 17 | `get_source_folder_contents` | `apps` | Survey API and web app boundaries | apps/api and apps/web confirmed |
| 18 | `get_source_folder_contents` | `packages` | Survey shared library structure | 20+ packages enumerated |
| 19 | `bash` | `ls apps/api/v1/; ls apps/api/v2/` | Confirm v1/v2 structure | v1 uses Next.js; v2 uses NestJS |
| 20 | `get_tech_spec_section` | `1.1 EXECUTIVE SUMMARY` | Background context | Project overview captured |
| 21 | `get_tech_spec_section` | `1.2 SYSTEM OVERVIEW` | Tech stack and components | Stack versions and component map captured |
| 22 | `get_tech_spec_section` | `3.3 OPEN SOURCE DEPENDENCIES` | Pinned dependency surface | Resolutions table, patched deps, accepted advisory |
| 23 | `get_tech_spec_section` | `6.4 Security Architecture` | Existing security control inventory | Authentication, authorization, crypto, rate-limiting, audit controls catalogued |

#### Folders Inspected (Categorical Summary)

- Root — `""` (full directory listing including all 35 files and 22 folders)
- `apps/` — top-level boundary between API and web app
- `apps/api/` — proxy gateway and versioned API services
- `apps/api/v1/` — legacy Next.js API
- `apps/api/v2/src/modules/` — NestJS module enumeration
- `packages/` — 20+ shared workspace packages
- `packages/prisma/migrations/` — migration filename listing (chronologically ordered)
- `scripts/` — utility script directory listing
- `.github/workflows/` — 20+ workflow YAML files
- `.github/actions/` — 10+ composite actions

#### Files Inspected (Selected Highlights)

- `package.json` (lines 1-180) — workspaces, devDependencies, resolutions, engines, packageManager
- `Dockerfile` (lines 1-20) — base image, ARG declarations
- `.env.example`, `.env.appStore.example`, `example-apps/credential-sync/.env.example` — env templates (inventoried via `find`, content not displayed to avoid secret echo)
- `.yarnrc.yml` — referenced via Tech Spec §3.3.6 documentation
- `apps/web/lib/csp.ts` (line 8) — CSP_POLICY env access confirmed via grep

### 0.9.3 Attachments

The user attached zero environment files and zero document attachments. The `/tmp/environments_files` directory is empty. No user-provided files exist to summarize.

### 0.9.4 Figma Frames

No Figma frames or screens were provided. The Design System Alignment Protocol does not apply to this AAP because (a) no UI design system is specified in the user input and (b) no Figma attachments accompany the request. The only UI artifact produced — `executive-summary.html` — uses the in-rule-defined Blitzy reveal.js theme, which is treated as the proprietary design system for the presentation only.

### 0.9.5 External Specifications Referenced

- **MITRE Common Weakness Enumeration (CWE)** — `https://cwe.mitre.org/` — the canonical CWE taxonomy used for the `cwe` field classification.
- **MITRE CWE Top 25 (most recent annual release)** — prioritization reference for severity calibration of common weaknesses.
- **CVSS v3.1 Base Score Severity Bands** — `https://www.first.org/cvss/v3.1/specification-document` — used to map CVSS scores to the four-value severity vocabulary `{critical, high, medium, low}`.
- **RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format** — `https://datatracker.ietf.org/doc/html/rfc8259` — authoritative grammar for `findings-config-a.json`.
- **RFC 9116 — A File Format to Aid in Security Vulnerability Disclosure** — referenced in `SECURITY.md` and `.well-known/security.txt`.

### 0.9.6 Technical Specification Sections Consulted

The following Technical Specification sections were retrieved and incorporated into this AAP:

- §1.1 Executive Summary — project overview, business problem, stakeholders, expected impact.
- §1.2 System Overview — current limitations, integration landscape, core technical approach, technology stack, success criteria.
- §3.3 Open Source Dependencies — registry, patched dependencies, pinned resolutions, web app dependencies, API v2 dependencies, security audit management, no-new-public-dependencies mandate.
- §6.4 Security Architecture — authentication framework, authorization system, data protection (cryptography, masking, rate limiting, API key handling, webhook security, OAuth state protection), security zones, compliance controls, security control matrix.

Cross-references within this AAP to other Tech Spec sections (e.g., §6.2 Database Design, §5.4 Cross-Cutting Concerns) are not direct retrievals but are mentioned where Section 6.4's cross-reference summary already established the relationship.

