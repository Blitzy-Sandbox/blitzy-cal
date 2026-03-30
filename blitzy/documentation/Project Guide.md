# Blitzy Project Guide — Cal.com Calendly Parity Sprints 4–8

---

## 1. Executive Summary

### 1.1 Project Overview

This project implements five Calendly feature parity sprints (Sprints 4–8) across the Cal.com monorepo, delivering Webhooks & Events alignment (Sprint 4), Routing Forms parity (Sprint 5), Embed & Share flows (Sprint 6), Admin & Teams governance (Sprint 7), and Notifications & Workflows (Sprint 8). The target is to close documented feature gaps between Cal.com and Calendly across these five domains, enabling Cal.com to match Calendly's functionality while preserving Cal.com's existing superset advantages. The implementation spans 237 files across 209 commits, with additive-only database migrations and zero breaking changes to existing webhook payloads.

### 1.2 Completion Status

```mermaid
pie title Project Completion Status
    "Completed (AI)" : 148
    "Remaining" : 52
```

| Metric | Value |
|---|---|
| **Total Project Hours** | 200 |
| **Completed Hours (AI)** | 148 |
| **Remaining Hours** | 52 |
| **Completion Percentage** | 74.0% |

**Formula:** 148 / (148 + 52) = 148 / 200 = 74.0%

### 1.3 Key Accomplishments

- ✅ **Spec-first design documents** created for all 5 sprint domains (40 files across `specs/webhooks-events/`, `specs/routing-forms/`, `specs/embed-share/`, `specs/admin-teams/`, `specs/notifications-workflows/`)
- ✅ **Sprint 4 — Webhooks:** Calendly-to-CalCom event mapping module (`calendlyEventMap.ts`), v2025-01-01 versioned builder set with 7 payload builders, DTO extensions with UTM/URI parity fields, v2021-10-20 backward compatibility regression tests
- ✅ **Sprint 5 — Routing Forms:** Checkbox, URL, Date field types added to RAQB config and Zod schemas, conditional routing logic enhancements, API v2 CRUD endpoints in RoutingFormsController, 6 new PrismaRoutingFormRepository methods, Playwright E2E parity tests
- ✅ **Sprint 6 — Embed & Share:** Inline/Modal/FloatingButton CSS custom property support, embed parity constants, share flow link generation utilities, React `Cal` component prop extensions, 30 embed parity tests
- ✅ **Sprint 7 — Admin & Teams:** OrganizationPermissionService/OrganizationRepository role model parity methods, TeamService round-robin/collective routing, managed event type push logic (`managedEventTypePush.ts`), MembershipRepository invitation lifecycle methods, TeamEventTypeForm scheduling type indicators
- ✅ **Sprint 8 — Notifications:** 12 email template enhancements, 9 SMS attendee template enhancements, WorkflowRepository parity fields, InAppNotificationService/ActivityFeedRepository/InAppNotificationRepository, workflow trigger/action enum extensions
- ✅ **Database migrations:** 2 additive-only zero-downtime migrations (Wave 3 + notification tables)
- ✅ **Prisma schema:** Extended with ActivityFeedItem, InAppNotification models; Membership invitation tracking; Webhook payloadVersion; Workflow isEnabled toggle
- ✅ **1,407 tests passing** across all sprint packages with 0 failures
- ✅ **Gap reports and epic catalog** updated with closure evidence for all 5 sprint domains
- ✅ **Validation criteria documentation** updated with gate evidence for Sprints 4–8

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|---|---|---|---|
| End-to-end integration testing across all 5 sprint domains not yet executed in production-like environment | Cannot confirm cross-domain integration behaviors (e.g., routing form embed → webhook fire → notification dispatch) | Human Developer | 1–2 weeks |
| Database migrations not applied to a real PostgreSQL instance | Migration correctness verified structurally but not against production data volume | Human Developer | 2–3 days |
| Environment variables for Twilio SMS, SMTP, and SendGrid not configured | NF-001 and NF-002 features cannot be validated end-to-end | Human Developer | 1 day |
| 114 pre-existing TypeScript errors in 28 unmodified out-of-scope files | Does not block this PR but indicates broader codebase tech debt | Existing Backlog | Ongoing |
| Playwright E2E tests not executed in browser environment | RF-003 field-type-parity tests written but require Playwright runtime | Human Developer | 2–3 days |

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|---|---|---|---|---|
| Twilio API | Service Credentials | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` not configured | Unresolved | Human Developer |
| SMTP/SendGrid | Service Credentials | `SENDGRID_API_KEY` or SMTP credentials needed for email delivery | Unresolved | Human Developer |
| PostgreSQL Database | Infrastructure | No production-equivalent database available for migration testing | Unresolved | Human Developer |
| Calendly Developer API | External Reference | `developer.calendly.com` used as behavioral source of truth — no API key needed for reference | Resolved | N/A |

### 1.6 Recommended Next Steps

1. **[High]** Run Prisma migrations against a staging PostgreSQL database and verify data integrity with existing records
2. **[High]** Configure Twilio and SMTP environment variables, then execute end-to-end notification tests for NF-001 and NF-002
3. **[High]** Execute Playwright E2E tests for routing form field type parity (RF-003) in a browser environment
4. **[Medium]** Perform cross-domain integration testing: create a routing form → submit → verify webhook fires → verify notification dispatches → verify in-app notification created
5. **[Medium]** Conduct security review of new InAppNotification and ActivityFeedItem endpoints before enabling in production

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|---|---|---|
| **Spec Design Documents (All Sprints)** | 10 | Created 40 spec files across 5 domain folders (design.md, implementation.md, decisions.md, CLAUDE.md, prompts.md, future-work.md, docs/README.md) |
| **WH-001: invitee.created Mapping** | 6 | Calendly-to-CalCom event mapping module (`calendlyEventMap.ts`, 170 lines), barrel export, 20 Vitest unit tests |
| **WH-002: invitee.canceled Mapping** | 4 | BOOKING_CANCELLED → invitee.canceled mapping in event map, cancellation DTO extensions, regression tests |
| **WH-003: routing_form_submission.created** | 5 | FORM_SUBMITTED mapping, v2025-01-01 FormPayloadBuilder (103 lines) with Calendly parity fields |
| **WH-004: Payload Structure Alignment** | 10 | DTO type extensions (UTM params, invitee/event URIs, scheduling URL, cancellation metadata), v2021-10-20 BookingPayloadBuilder Calendly field population, 6 backward-compat regression tests |
| **WH-005: Webhook Versioning** | 12 | v2025-01-01 builder set (7 builders, 1,171 lines), PayloadBuilderFactory registry extension, WebhookVersion enum update, payloadVersion column, BOOKING_RESCHEDULED_BY_ATTENDEE trigger event |
| **RF-001: Form Builder Parity** | 8 | CheckboxGroupWidget component, FormInputFields checkbox default value support, DynamicAppComponent JSDoc, App Store metadata update, Zod schema extensions |
| **RF-002: Conditional Routing Logic** | 8 | findMatchingRoute enhancements for Calendly-parity answer matching, getRoutedUrl field type normalization, handleResponse validation extensions, 37 processRoute test cases |
| **RF-003: Field Type Parity** | 10 | CHECKBOX/URL/DATE FieldTypes, RAQB widget/type configs (CheckboxFactory, UrlFactory, DateFactory), getQueryBuilderConfig fallbacks, parseRoutingFormResponse enhancements, Playwright E2E test file, getQueryBuilderConfig test extensions |
| **RF-004: API v2 Endpoint Parity** | 8 | RoutingFormsController CRUD endpoints, 4 input DTOs, 6 PrismaRoutingFormRepository methods, PrismaRoutingFormResponseRepository extensions, interface updates, Biome formatting fixes |
| **EM-001: Inline Embed Parity** | 6 | Inline custom element CSS custom properties (background/text color), EMBED_INLINE_MIN_WIDTH constant, embed type extensions, lifecycle documentation |
| **EM-002: Modal/Popup Embed Parity** | 5 | Modal overlay/close button color CSS custom properties, EMBED_MODAL_DEFAULT_OVERLAY_COLOR/CLOSE_BUTTON_COLOR constants |
| **EM-003: Floating Button Parity** | 4 | data-button-border-radius attribute, CSS syntax bug fix in FloatingButtonHtml, embed event constants |
| **EM-004: Share Flow & Link Generation** | 8 | ShareFlowType enum and constants, useShareFlowConfig hook, getApiNameForShareFlow utility, EmbedCodes share flow generation, EmbedTabs/useEmbedParams/useEmbedDialogCtx extensions, Cal React UiConfig/hideEventTypeDetails props, type re-exports, EmbedButton/EmbedDialogForm components, 12 getApiName tests |
| **AG-001: Admin Role Model Parity** | 8 | OrganizationPermissionService role parity methods, OrganizationRepository admin role methods, OrganizationMembershipService transitionRole/getMembersByRole, AdminOrganizationUpdateService role-based permission check, 40 permission test cases, 23 repository test cases |
| **AG-002: Team Event Routing Parity** | 8 | TeamService round-robin/collective routing methods, TeamRepository rotation/availability/eligibility query methods, teams/lib/queries.ts scheduling extensions, 31 TeamRepository tests, 35 TeamService tests |
| **AG-003: Managed Event Type Push** | 6 | managedEventTypePush.ts business logic (210 lines), checkForEmptyAssignment.ts precondition validation, EventTypeRepository 4 push methods + 14 tests, TeamEventTypeForm scheduling type indicators, childrenEventType pushStatus/pushedAt fields |
| **AG-004: Member Invitation Workflow** | 5 | MembershipRepository invitation lifecycle methods, MembershipService role parity extensions, inviteMemberUtils Calendly workflow parity, Prisma Membership invitation columns, integration tests |
| **NF-001: Email Template Parity** | 10 | 12 email template enhancements (attendee/organizer scheduled/cancelled/rescheduled + workflow), BaseEmailHtml/V2BaseEmailHtml preheader/category props, CallToAction variant/fullWidth, LocationInfo/WhenInfo/WhoInfo/ManageLink Calendly parity, renderEmail metadata injection, 93 email parity tests, ICS generation enhancement |
| **NF-002: SMS/WhatsApp Reminder Parity** | 5 | SMSManager Calendly parity enhancements, 9 attendee SMS template enhancements (scheduled, rescheduled, cancelled, declined, request, reschedule-request, location-changed, awaiting-payment, cancelled-seat) |
| **NF-003: Workflow Automation Parity** | 5 | WorkflowRepository parity fields/query methods, scheduleWorkflowNotifications extensions, scheduleBookingReminders enhancements, scheduleEmailReminders/scheduleSMSReminders cron handler updates, WorkflowService reschedule filter, AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE trigger, ICS attachment for reminders, workflow constants extensions |
| **NF-004: In-App Notification & Activity Feed** | 8 | InAppNotificationService (380 lines), InAppNotificationRepository (258 lines), ActivityFeedRepository (154 lines), notification types/enums/DTOs (283 lines), DI tokens, sendNotification in-app channel, reminderScheduler IN_APP_NOTIFICATION handler, Prisma models + migration, 41 repository tests |
| **Database Migrations** | 3 | 2 additive-only migrations (Wave 3 schema changes + notification tables), Prisma schema updates (68 lines added) |
| **Documentation & Gap Reports** | 5 | 9 doc files updated with gap closure evidence across all 5 sprint domains, epic catalog status updates, validation criteria gate evidence |
| **QA Fixes & Validation** | 5 | 4 QA gap fixes (RF-003 checkbox/date, NF-003 reschedule trigger, NF-004 in-app), security fixes, i18n translations, performance findings, documentation findings |
| **Total** | **148** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|---|---|---|
| **End-to-end integration testing across all 5 sprint domains** | 16 | High |
| **Database migration testing on staging PostgreSQL** | 4 | High |
| **Playwright E2E test execution for RF-003 field type parity** | 4 | High |
| **Twilio/SMTP environment configuration and NF-001/NF-002 E2E validation** | 4 | High |
| **Cross-domain integration testing (routing form → webhook → notification flow)** | 8 | Medium |
| **Security review of InAppNotification/ActivityFeedItem data access** | 4 | Medium |
| **In-app notification UI components (frontend rendering)** | 6 | Medium |
| **Activity feed UI components (frontend rendering)** | 4 | Medium |
| **Production deployment configuration and CI/CD pipeline updates** | 2 | Low |
| **Total** | **52** | |

### 2.3 Verification

- Completed Hours: **148**
- Remaining Hours: **52**
- 148 + 52 = **200** (matches Total Project Hours in Section 1.2) ✅

---

## 3. Test Results

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---|---|---|---|---|---|---|
| Webhooks Unit/Integration | Vitest 4.0.16 | 208 | 208 | 0 | — | Includes v2025-01-01 builder tests, event mapping tests, factory routing tests, regression tests |
| Routing Forms Unit/Integration | Vitest 4.0.16 | 239 | 239 | 0 | — | processRoute (37), widgets (10), getQueryBuilderConfig (13), handleResponse (14), getRoutedUrl (14) |
| Embed Unit | Vitest 4.0.16 | 166 | 165 | 0 | — | 1 skipped (pre-existing); embed-parity (30), EmbedElement (18), embed (36), getApiName (12) |
| Admin/Teams/EventTypes Unit | Vitest 4.0.16 | 468 | 468 | 0 | — | OrganizationPermission (40), TeamRepository (31), TeamService (35), EventTypeParity (58), MembershipRepo integration |
| Notifications/Workflows/Email/SMS Unit | Vitest 4.0.16 | 327 | 327 | 0 | — | email-manager (127), gapFixes (8), NotificationRepo (23), ActivityFeedRepo (18), WorkflowService (19) |
| Routing Forms E2E | Playwright 1.57.0 | — | — | — | — | Test files created (field-type-parity.e2e.ts) but require browser runtime for execution |
| **TOTAL** | | **1,408** | **1,407** | **0** | — | 1 skipped (pre-existing in embed suite) |

All tests originate from Blitzy's autonomous validation execution logs.

---

## 4. Runtime Validation & UI Verification

### Runtime Health
- ✅ All 1,407 unit/integration tests pass across Vitest 4.0.16
- ✅ Zero TypeScript errors in all 237 modified/created files
- ✅ Biome 2.3.10 lint: 0 errors in modified files (warnings/infos match pre-existing codebase patterns)
- ✅ Prisma schema validates structurally (additive-only changes confirmed)
- ✅ v2021-10-20 webhook payload backward compatibility confirmed via 6 regression tests
- ⚠ Playwright E2E tests written but not executed (require browser runtime)
- ⚠ Database migrations not applied to live PostgreSQL (structural validation only)

### API Integration
- ✅ Routing Forms API v2 controller extended with CRUD endpoints (GET, POST, PUT, DELETE)
- ✅ 4 input DTOs created (CreateRoutingFormInput, UpdateRoutingFormInput, SubmitRoutingFormInput, index barrel)
- ✅ Authentication/authorization guards added to routing forms API v2 endpoints
- ⚠ API v2 endpoints not validated against running NestJS server

### UI Verification
- ✅ CheckboxGroupWidget renders with Cal.com Radix Checkbox components
- ✅ TeamEventTypeForm displays Calendly-equivalent scheduling type indicators
- ✅ Embed components accept CSS custom properties for color customization
- ⚠ No visual UI screenshots captured (library packages — no standalone UI server)

---

## 5. Compliance & Quality Review

| Compliance Area | Status | Details |
|---|---|---|
| Spec-first workflow | ✅ Pass | All 5 sprint domains have complete spec folders with design.md, implementation.md, decisions.md, CLAUDE.md |
| Zero-downtime migrations | ✅ Pass | 2 migrations are additive-only: new columns, new enum values, new tables, new indexes. No destructive operations |
| Webhook backward compatibility | ✅ Pass | v2021-10-20 payload structure preserved exactly; 6 regression tests confirm no field removals/renames/type changes |
| Additive-only Prisma changes | ✅ Pass | New columns have defaults or are nullable; new enum values appended (not reordered); no column removals |
| HMAC-SHA256 signing preserved | ✅ Pass | sendPayload.ts signing logic unchanged; X-Cal-Webhook-Version and X-Cal-Signature-256 headers maintained |
| TypeScript strict mode | ✅ Pass | All new files use strict TypeScript; 0 errors in modified files |
| Repository pattern | ✅ Pass | New data access uses repository classes (InAppNotificationRepository, ActivityFeedRepository, PrismaRoutingFormRepository extensions) |
| DI pattern compliance | ✅ Pass | New services use symbol-based DI tokens (notifications/di/tokens.ts) following existing patterns |
| Biome lint compliance | ✅ Pass | 0 errors in modified files; warnings/infos match existing codebase patterns |
| PR size discipline | ⚠ Partial | Individual commits follow focused-change pattern, but the aggregate PR exceeds 500-line guidance (required for 5-sprint scope) |
| Data preservation mandate | ✅ Pass | No destructive schema changes; no data deletions; new columns are nullable with defaults |
| Wave 3 → Wave 4 gating | ✅ Pass | Sprints 4, 5, 7 (Wave 3) complete before Sprints 6, 8 (Wave 4) per commit history |

### Autonomous Validation Fixes Applied
- RF-003: Checkbox checkmark visibility fix in widgets.tsx
- RF-003: DateFactory type corrected to "date" in uiConfig.tsx
- NF-003: isRescheduledByAttendee filter added to WorkflowService
- NF-004: IN_APP_NOTIFICATION handler trigger-to-NotificationType mapping in reminderScheduler
- Security: Webhook info disclosure fix + dependency upgrades
- i18n: Missing translation keys for AG-002, AG-003, EM-004
- Performance: 13 QA performance findings resolved across Sprint 4–8 modules
- Documentation: 22 QA documentation findings resolved

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|---|---|---|---|---|---|
| Database migration failure on production data | Technical | High | Low | Migrations are additive-only; test against staging DB with production-like data volume before deploying | Open |
| In-app notification N+1 query performance | Technical | Medium | Medium | InAppNotificationRepository uses indexed queries (userId, status, createdAt); monitor query plans under load | Open |
| Twilio SMS delivery failures for NF-002 | Integration | Medium | Medium | Configure Twilio credentials in staging; verify message delivery rates; implement retry logic | Open |
| Cross-domain webhook-notification race condition | Technical | Medium | Low | Webhook dispatch and notification dispatch are independent; verify parallel execution doesn't cause duplicate notifications | Open |
| Prisma enum ordering sensitivity | Technical | Medium | Low | New enum values appended at end; verify ORM regeneration produces consistent ordering on all environments | Open |
| RAQB v5.1.2 jsonLogic edge cases with new field types | Technical | Low | Medium | 37 processRoute tests + Playwright E2E cover major cases; monitor for edge case routing failures | Open |
| 114 pre-existing TypeScript errors in unmodified files | Technical | Low | High | Not introduced by this PR; existing tech debt; does not block modified file compilation | Accepted |
| Embed CSS custom property browser compatibility | Technical | Low | Low | CSS custom properties supported in all modern browsers; Cal.com's target browsers include IE11 polyfill | Accepted |
| Unauthorized access to InAppNotification endpoints | Security | High | Low | Repository methods require userId; add API-level auth guards before exposing REST/tRPC endpoints | Open |
| Missing rate limiting on new API v2 endpoints | Security | Medium | Medium | Existing rate limiting middleware applies; verify it covers new routing form CRUD endpoints | Open |

---

## 7. Visual Project Status

```mermaid
pie title Project Hours Breakdown
    "Completed Work" : 148
    "Remaining Work" : 52
```

### Remaining Hours by Category

| Category | Hours |
|---|---|
| End-to-end integration testing | 16 |
| Cross-domain integration testing | 8 |
| In-app notification UI components | 6 |
| Playwright E2E execution | 4 |
| Database migration testing | 4 |
| Twilio/SMTP configuration | 4 |
| Security review | 4 |
| Activity feed UI components | 4 |
| Deployment/CI-CD | 2 |
| **Total** | **52** |

---

## 8. Summary & Recommendations

### Achievement Summary

This project delivers 74.0% completion of the Calendly parity Sprints 4–8 scope, representing 148 hours of autonomous development across 237 files and 209 commits. All five sprint domains have been implemented with design specifications, production source code, additive-only database migrations, comprehensive test suites (1,407 tests passing), and updated documentation with gap closure evidence. The implementation follows Cal.com's established patterns (DI, repository, versioned builders) and strictly adheres to zero-downtime migration, webhook backward compatibility, and additive-only schema change constraints.

### Critical Path to Production

The remaining 52 hours focus primarily on **integration validation** rather than feature implementation. The core business logic, data models, and service layers are implemented and unit-tested. The path to production requires:

1. **Integration testing (24h):** Execute end-to-end tests across domains and validate cross-domain flows (routing form submission → webhook dispatch → notification delivery → in-app notification creation)
2. **Infrastructure setup (8h):** Configure Twilio, SMTP, and staging database; apply migrations to real PostgreSQL
3. **UI completion (10h):** Build frontend components for in-app notifications and activity feed rendering
4. **Security & deployment (10h):** Security review of new data models, CI/CD updates, production deployment

### Production Readiness Assessment

The project is **not yet production-ready** — it requires the 52 remaining hours of integration testing, infrastructure configuration, and UI completion. However, the foundation is solid: all business logic is implemented, all unit tests pass, and the database schema is migration-ready. With focused effort on the remaining tasks, the project can reach production readiness within 1–2 engineering sprints.

---

## 9. Development Guide

### System Prerequisites

| Software | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.x (v20.20.1 tested) | Required by Cal.com monorepo |
| Yarn | ≥ 4.12.0 (v4.12.0 tested) | Berry/PnP workspace manager |
| PostgreSQL | 15.x+ | For database (`DATABASE_URL`) |
| Git | 2.x+ | Version control |

### Environment Setup

```bash
# 1. Clone and checkout the feature branch
git clone <repository-url>
cd cal.com
git checkout blitzy-cf841d3c-c638-407d-bdee-ec714f4a6ea9

# 2. Copy environment configuration
cp .env.example .env

# 3. Configure required environment variables in .env
# DATABASE_URL="postgresql://postgres:@localhost:5450/calendso"
# NEXTAUTH_SECRET="<generate-a-secret>"
# CALENDSO_ENCRYPTION_KEY="<generate-a-32-char-key>"
# NEXT_PUBLIC_WEBAPP_URL="http://localhost:3000"
# NEXTAUTH_URL="http://localhost:3000"

# 4. For NF-001/NF-002 features, also configure:
# SENDGRID_API_KEY="<your-sendgrid-key>"
# TWILIO_SID="<your-twilio-sid>"
# TWILIO_TOKEN="<your-twilio-token>"
# TWILIO_MESSAGING_SERVICE_SID="<your-messaging-service-sid>"
```

### Dependency Installation

```bash
# Install all monorepo dependencies
yarn install

# Generate Prisma client
yarn prisma generate --schema=packages/prisma/schema.prisma

# Apply database migrations (requires running PostgreSQL)
yarn db-deploy
```

### Running Tests

```bash
# Run all sprint-scoped tests (recommended first validation)
TZ=UTC npx vitest run packages/features/webhooks/ packages/features/routing-forms/ packages/app-store/routing-forms/ packages/embeds/ packages/features/embed/ packages/features/ee/organizations/ packages/features/ee/teams/ packages/features/membership/ packages/features/eventtypes/ packages/emails/ packages/sms/ packages/features/ee/workflows/ packages/features/notifications/

# Run tests by sprint domain:
# Sprint 4 — Webhooks
TZ=UTC npx vitest run packages/features/webhooks/

# Sprint 5 — Routing Forms
TZ=UTC npx vitest run packages/features/routing-forms/ packages/app-store/routing-forms/

# Sprint 6 — Embed & Share
TZ=UTC npx vitest run packages/embeds/ packages/features/embed/

# Sprint 7 — Admin & Teams
TZ=UTC npx vitest run packages/features/ee/organizations/ packages/features/ee/teams/ packages/features/membership/ packages/features/eventtypes/

# Sprint 8 — Notifications & Workflows
TZ=UTC npx vitest run packages/emails/ packages/sms/ packages/features/ee/workflows/ packages/features/notifications/

# Run Playwright E2E tests (requires browser runtime)
npx playwright test packages/app-store/routing-forms/playwright/tests/field-type-parity.e2e.ts
```

### Application Startup

```bash
# Start the development server
yarn dev

# The web application will be available at http://localhost:3000
# The API v2 will be available at the configured API endpoint
```

### Verification Steps

```bash
# 1. Verify all unit tests pass
TZ=UTC npx vitest run 2>&1 | tail -5
# Expected: "Tests  XXXX passed"

# 2. Verify TypeScript compilation of modified packages
npx tsc -p packages/features/tsconfig.json --noEmit 2>&1 | grep -c 'error TS'
# Expected: 114 (all pre-existing, none in modified files)

# 3. Verify Biome lint on modified files
git diff --name-only origin/main...HEAD | grep -E '\.(ts|tsx)$' | head -20 | xargs npx biome lint --config-path biome-staged.json 2>&1 | grep 'error'
# Expected: no errors

# 4. Verify Prisma schema validity
yarn prisma validate --schema=packages/prisma/schema.prisma
# Expected: "The schema is valid"
```

### Troubleshooting

| Issue | Resolution |
|---|---|
| `prisma generate` fails | Ensure `packages/prisma/schema.prisma` exists and `DATABASE_URL` is set in `.env` |
| Vitest tests timeout | Run with `--maxWorkers=1` flag for booking handler tests (resource contention) |
| TypeScript errors in unmodified files | 114 pre-existing errors — ignore for this PR scope; focus on modified file compilation |
| RAQB checkbox widget rendering issues | Verify `@calcom/ui` Checkbox component is available; check import paths |
| Webhook payload test failures | Ensure Prisma client is regenerated after schema changes (`yarn prisma generate`) |

---

## 10. Appendices

### A. Command Reference

| Command | Purpose |
|---|---|
| `yarn install` | Install all monorepo dependencies |
| `yarn prisma generate --schema=packages/prisma/schema.prisma` | Regenerate Prisma client |
| `yarn db-deploy` | Apply pending database migrations |
| `yarn dev` | Start development server |
| `yarn build` | Build all packages |
| `yarn test` | Run all tests (`TZ=UTC vitest run`) |
| `yarn lint` | Run Turborepo lint pipeline |
| `npx vitest run <path>` | Run tests for specific package(s) |
| `npx tsc -p packages/features/tsconfig.json --noEmit` | TypeScript type check |
| `npx biome lint --config-path biome-staged.json <files>` | Lint specific files |

### B. Port Reference

| Service | Port | Notes |
|---|---|---|
| Cal.com Web App | 3000 | Next.js development server |
| PostgreSQL | 5450 | Default Cal.com database port |
| Prisma Studio | 5555 | Database UI (`yarn db-studio`) |

### C. Key File Locations

| File/Directory | Purpose |
|---|---|
| `packages/features/webhooks/lib/mapping/calendlyEventMap.ts` | Calendly-to-CalCom webhook event mapping |
| `packages/features/webhooks/lib/factory/versioned/v2025-01-01/` | v2025-01-01 versioned payload builders |
| `packages/features/webhooks/lib/factory/versioned/PayloadBuilderFactory.ts` | Version-aware payload builder factory |
| `packages/app-store/routing-forms/zod.ts` | Routing form Zod schemas (field types, routes) |
| `packages/app-store/routing-forms/lib/processRoute.tsx` | Core route evaluation logic |
| `packages/embeds/embed-core/src/embed.ts` | Embed runtime (inline, modal, floating button) |
| `packages/features/ee/organizations/lib/OrganizationPermissionService.test.ts` | Organization role parity tests |
| `packages/features/ee/teams/services/teamService.ts` | Team event routing logic |
| `packages/features/eventtypes/lib/managedEventTypePush.ts` | Managed event type push business logic |
| `packages/features/notifications/services/InAppNotificationService.ts` | In-app notification service |
| `packages/features/notifications/repositories/` | Notification and activity feed repositories |
| `packages/emails/email-manager.ts` | Email dispatch orchestrator |
| `packages/sms/sms-manager.ts` | SMS/WhatsApp delivery manager |
| `packages/prisma/schema.prisma` | Database schema (ActivityFeedItem, InAppNotification models) |
| `packages/prisma/migrations/20260327000000_calendly_parity_wave3_additive/` | Wave 3 additive migration |
| `packages/prisma/migrations/20260328000000_create_notification_tables/` | Notification tables migration |
| `specs/*/design.md` | Sprint design specifications |
| `docs/gap-report/*.mdx` | Gap closure evidence documentation |

### D. Technology Versions

| Technology | Version |
|---|---|
| Node.js | 20.20.1 |
| Yarn | 4.12.0 |
| TypeScript | 5.9.3 |
| Next.js | 16.1.5 |
| React | 18.2.0 |
| Prisma | 6.16.1 |
| Vitest | 4.0.16 |
| Playwright | 1.57.0 |
| Biome | 2.3.10 |
| Zod | 3.25.76 |
| RAQB | 5.1.2 |
| Tailwind CSS | 4.1.17 |
| Turborepo | 2.7.1 |

### E. Environment Variable Reference

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | NextAuth.js session encryption |
| `CALENDSO_ENCRYPTION_KEY` | Yes | AES-256 credential encryption |
| `NEXT_PUBLIC_WEBAPP_URL` | Yes | Public-facing web app URL |
| `NEXTAUTH_URL` | Yes | NextAuth callback URL |
| `SENDGRID_API_KEY` | For NF-001 | SendGrid email delivery |
| `TWILIO_SID` | For NF-002 | Twilio account SID |
| `TWILIO_TOKEN` | For NF-002 | Twilio auth token |
| `TWILIO_MESSAGING_SERVICE_SID` | For NF-002 | Twilio messaging service |

### F. Developer Tools Guide

| Tool | Usage |
|---|---|
| Prisma Studio | `yarn db-studio` — Visual database browser at port 5555 |
| Vitest UI | `npx vitest --ui` — Interactive test runner UI |
| Biome | `npx biome check .` — Full lint + format check |
| Turborepo | `turbo run build --filter=<package>` — Build specific packages |
| TypeScript | `npx tsc -p packages/features/tsconfig.json --noEmit` — Type check |

### G. Glossary

| Term | Definition |
|---|---|
| AAP | Agent Action Plan — the primary directive document |
| RAQB | React Awesome Query Builder — rule engine for routing forms |
| PBAC | Permission-Based Access Control — Cal.com's permission model |
| DI | Dependency Injection — Cal.com uses symbol-based tokens |
| DTO | Data Transfer Object — typed data containers for API communication |
| ADR | Architecture Decision Record — documented in specs/*/decisions.md |
| Wave 3 | Sprints 4, 5, 7 (parallel execution) |
| Wave 4 | Sprints 6, 8 (sequential after Wave 3) |
| v2021-10-20 | Default webhook payload version (preserved backward-compatible) |
| v2025-01-01 | New Calendly-aligned webhook payload version |
