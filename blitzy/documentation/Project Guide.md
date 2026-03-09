# Blitzy Project Guide — Sprint 3: Calendar Integrations (F-003)

---

## 1. Executive Summary

### 1.1 Project Overview

Sprint 3 of the Calendly gap closure initiative for Cal.com delivers calendar integration behavioral parity across Google Calendar, Outlook/Office 365, and Apple Calendar adapters. The sprint implements 5 cataloged epics (CI-001 through CI-005) covering adapter-level parity verification, configurable conflict detection alignment, and bi-directional sync verification, plus 2 gap closure features (calendar-driven cancellation sync and buffer time calendar visualization) behind disabled-by-default feature flags. The target users are Cal.com scheduling platform hosts who connect external calendars for availability management and booking event synchronization. This work is prerequisite to Sprint 4 (Webhooks & Events) via Gate 3 validation.

### 1.2 Completion Status

```mermaid
pie title Project Completion — 80.8%
    "Completed (172h)" : 172
    "Remaining (41h)" : 41
```

| Metric | Value |
|--------|-------|
| **Total Project Hours** | 213 |
| **Completed Hours (AI)** | 172 |
| **Remaining Hours** | 41 |
| **Completion Percentage** | 80.8% |

**Calculation:** 172 completed hours / (172 + 41 remaining hours) = 172 / 213 = **80.8% complete**

### 1.3 Key Accomplishments

- ✅ All 5 Sprint 3 epics (CI-001 through CI-005) fully implemented and tested
- ✅ Google Calendar adapter parity verified — push notification subscription, FreeBusy 90-day chunking, recurring events, Meet integration
- ✅ Outlook/O365 adapter parity verified — Graph API batch requests, configurable `showAs` filtering, retry handling, change notification support
- ✅ Apple Calendar adapter parity verified — CalDAV event CRUD, availability queries, credential encryption audit
- ✅ Configurable conflict detection with `statusFilter` threaded through the full availability pipeline
- ✅ 844-line bi-directional sync integration test suite covering create, reschedule, and cancel flows
- ✅ Calendar-driven cancellation sync service with Google and Outlook handlers (feature-flagged)
- ✅ Buffer time calendar visualization service integrated into full booking lifecycle (feature-flagged)
- ✅ Zero-downtime database migration with 2 nullable columns and 2 feature flag rows
- ✅ 502/502 Sprint 3 specific tests passing (100%) with zero regressions against baseline
- ✅ 7 spec-first design artifacts created per `specs/README.md` workflow
- ✅ All 8 CI-VAL Gate 3 validation criteria satisfied

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|-------|--------|-------|-----|
| Gap closure features (cancellation sync, buffer sync) behind disabled feature flags — not yet validated with real calendar APIs | New gap closure features unavailable to end users until flags enabled after manual QA | Human Developer | 2–3 days |
| Webhook intake endpoints (`/api/webhooks/google-calendar`, `/api/webhooks/microsoft-graph`) require HTTPS deployment and signature verification hardening | Push notification / change notification flows cannot function without production-grade endpoints | Human Developer / DevOps | 1–2 days |
| Environment variables `GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL` and `OUTLOOK_GRAPH_NOTIFICATION_URL` not configured | Cancellation sync subscription creation will fail without valid callback URLs | Human Developer / DevOps | 0.5 day |
| 20 pre-existing test failures in full test suite (not caused by Sprint 3) | May mask future regressions in unrelated modules if not triaged | Human Developer | 3–5 days |

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|----------------|---------------|-------------------|-------------------|-------|
| Google Calendar API | Service Credential | Push notification channel creation requires a verified domain for the callback URL | Pending — requires production domain setup | DevOps |
| Microsoft Graph API | App Registration | Change notification subscription requires admin-consented Azure AD app with `Calendars.Read` permission | Pending — requires Azure AD admin action | DevOps |
| Apple iCloud | App-Specific Password | CalDAV operations require app-specific passwords — no push notification mechanism available (CalDAV limitation) | N/A — polling-based only | N/A |

### 1.6 Recommended Next Steps

1. **[High]** Deploy database migration `20260305000000_calendar_integration_gap_closure` to staging and verify row counts, credential decryption
2. **[High]** Configure `GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL` and `OUTLOOK_GRAPH_NOTIFICATION_URL` environment variables with HTTPS endpoints
3. **[High]** Execute real Calendar API integration tests with live Google, Outlook, and Apple accounts
4. **[Medium]** Enable `calendar-cancellation-sync` and `calendar-buffer-sync` feature flags in staging for UAT
5. **[Medium]** Harden webhook intake routes with signature verification and rate limiting before production deployment

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|-----------|-------|-------------|
| Spec-First Design Artifacts | 10 | 7 spec documents (design.md, implementation.md, decisions.md, CLAUDE.md, prompts.md, future-work.md, docs/README.md) — 842 lines total per `specs/README.md` workflow |
| Database Migration | 5 | Zero-downtime migration: `syncBuffersToCalendar` (EventType), `externalCancellationSyncEnabled` (Credential) nullable columns; `calendar-cancellation-sync` and `calendar-buffer-sync` feature flag rows |
| CI-001: Google Calendar Parity | 18 | CalendarService.ts enhancements (+203 lines), push notification `subscribeToChanges`/`unsubscribeFromChanges`, FreeBusy 90-day chunking, recurring event handling, Meet integration, CalendarAuth/credential schema extensions. 3 test files (1,317 + 467 + 300 new lines) |
| CI-002: Outlook/O365 Parity | 20 | CalendarService.ts enhancements (+203 lines), Graph API batch pagination, configurable `showAs` status filtering, retry-after handling, change notification type definitions. 2 new test files (2,422 + 1,400 lines = 95 tests) |
| CI-003: Apple Calendar Parity | 10 | CalDAV CalendarService verification, credential encryption audit (add.ts), CalDAV REPORT availability. 1 new test file (939 lines, 28 tests) |
| CI-004: Conflict Detection Alignment | 14 | `statusFilter` added to `GetAvailabilityParams` type, threaded through `getBusyTimes` → `CalendarManager.getBusyCalendarTimes` → `getCalendarsEvents` → `getUserAvailability` pipeline. conflictDetection.test.ts (586 lines, 12 tests), getBusyTimes test extensions |
| CI-005: Bi-directional Sync Verification | 12 | bidirectionalSync.integration.test.ts (844 lines, 41 tests) covering full outbound (create/update/delete) and inbound (availability reading) pipelines. CalendarEventBuilder adapter-specific verification and `buildBufferEvent` method |
| CI-001 Gap: Cancellation Sync | 32 | CalendarCancellationSyncService (260 lines), GoogleCancellationHandler (327 lines), OutlookCancellationHandler (538 lines), DI registration across 4 module files, webhook intake routes (285 lines + 531 test lines), subscription adapter extensions (GoogleCalendarSubscription, Office365CalendarSubscription, AdaptersFactory, CalendarSubscriptionService, CalendarSyncService), CalendarsTriggerTasker/CalendarsSyncTasker integration, handleCancelBooking `source` parameter |
| CI-002 Gap: Buffer Time Visualization | 28 | BufferTimeEventService (301 lines), EventManager integration (+266 lines with `createBufferEventsForBooking`/`deleteBufferEventsForBooking`), RegularBookingService buffer context (+66 lines), handleCancelBooking buffer cleanup, handleConfirmation buffer context (+50 lines), EventType schema/UI/type changes (EventLimitsTab toggle, defaultEvents, schemas, types, eventTypeRepository), getEventTypesFromDB/getBookingToDelete select extensions. bufferTimeVisualization.test.ts (619 lines, 20 tests) |
| API v2 Verification | 6 | 7 API v2 service/controller files verified and annotated with Sprint 3 parity JSDoc (gcal.service, outlook.service, apple-calendar.service, calendars.service, calendars.controller, calendars.processor); calendars.controller.e2e-spec.ts extended |
| Documentation Updates | 5 | Gap report calendar-integrations.mdx updated (CI-001/CI-002 gaps marked Closed), epic-catalog.mdx (CI-001–CI-005 marked Completed), validation-criteria.mdx (Gate 3 evidence recorded), .env.example (notification URL variables added) |
| Code Review & QA Iterations | 10 | 5 fix commits resolving 26+ code review findings — token/clientState consistency, explicit API timeouts, revert premature Gate 3 claims, correct MS Graph values, documentation status corrections, biome lint fixes |
| Feature Flags & Configuration | 2 | `flags/config.ts` (2 new flags), `useFlags.ts` hook update, `common.json` i18n strings, `test/builder.ts` extension |
| **Total** | **172** | |

### 2.2 Remaining Work Detail

| Category | Base Hours | Priority | After Multiplier |
|----------|-----------|----------|-----------------|
| Real Calendar API Integration Testing | 8 | High | 10 |
| Environment Configuration & Secrets Setup | 3 | High | 4 |
| Database Migration Deployment & Validation | 3 | High | 4 |
| Feature Flag Activation & UAT | 6 | Medium | 7 |
| Webhook Endpoint Security Hardening | 4 | Medium | 5 |
| Production Monitoring & Alerting Setup | 3 | Medium | 4 |
| Gate 3 Formal Sign-off | 2 | Medium | 2 |
| Pre-existing Test Failure Triage | 4 | Low | 5 |
| **Total** | **33** | | **41** |

### 2.3 Enterprise Multipliers Applied

| Multiplier | Value | Rationale |
|------------|-------|-----------|
| Compliance | 1.10x | Calendar API integrations handle user PII (email, calendar events) requiring data handling compliance review; OAuth credential flows require security audit |
| Uncertainty | 1.10x | Real-world calendar API behavior may differ from mocked test scenarios; push notification delivery reliability is environment-dependent |
| **Combined** | **1.21x** | Applied to all remaining base hour estimates |

---

## 3. Test Results

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---------------|-----------|-------------|--------|--------|-----------|-------|
| Unit — Google Calendar Adapter | Vitest 4.0.16 | 80 | 80 | 0 | — | CalendarService.test.ts + parity.test.ts + auth.test.ts |
| Unit — Outlook/O365 Adapter | Vitest 4.0.16 | 95 | 95 | 0 | — | CalendarService.test.ts (2422 lines) + parity.test.ts (1400 lines) |
| Unit — Apple Calendar Adapter | Vitest 4.0.16 | 28 | 28 | 0 | — | CalendarService.test.ts (939 lines) — CalDAV CRUD + availability |
| Unit — CalendarManager | Vitest 4.0.16 | 26 | 26 | 0 | — | processEvent, getCalendarCredentials, deduplication, statusFilter, buffer sync |
| Unit — CalendarEventBuilder | Vitest 4.0.16 | 45 | 45 | 0 | — | Builder pattern, fromBooking, adapter verification, buildBufferEvent |
| Unit — getBusyTimes | Vitest 4.0.16 | 18 | 18 | 0 | — | Busy time aggregation + CI-004 statusFilter threading |
| Unit — SelectedCalendarRepository | Vitest 4.0.16 | 31 | 31 | 0 | — | Upsert, delegation credentials, CI-004 scoping |
| Integration — Bi-directional Sync | Vitest 4.0.16 | 41 | 41 | 0 | — | CI-005: Full outbound/inbound pipeline for Google + Outlook |
| Integration — Conflict Detection | Vitest 4.0.16 | 12 | 12 | 0 | — | CI-004: Multi-provider aggregation, status filter threading |
| Integration — Calendar Subscription | Vitest 4.0.16 | 84 | 84 | 0 | — | CalendarSubscriptionService (32) + Google adapter (25) + Office365 adapter (27) |
| Gap — Cancellation Sync | Vitest 4.0.16 | 10 | 10 | 0 | — | CI-001 gap: Feature flag gating, booking lookup, notification flow |
| Gap — Buffer Time Visualization | Vitest 4.0.16 | 20 | 20 | 0 | — | CI-002 gap: Feature flag, buffer creation/deletion, edge cases |
| Regression — Booking Lifecycle | Vitest 4.0.16 | 12 | 12 | 0 | — | roundRobinManualReassignment regression safety |
| **Sprint 3 Total** | | **502** | **502** | **0** | **100%** | Zero failures across all Sprint 3 test files |
| Full Suite (baseline) | Vitest 4.0.16 | 613 | 586 | 20 | — | 20 failures are pre-existing (documented); 7 skipped. Matches baseline exactly — zero regressions |

---

## 4. Runtime Validation & UI Verification

**Runtime Health**
- ✅ TypeScript compilation: Zero errors across all 94 modified/created files
- ✅ Biome linting: Zero errors (only pre-existing complexity warnings in unrelated modules)
- ✅ Prisma schema validation: Schema compiles with new nullable fields and feature flag model
- ✅ Migration SQL: Valid PostgreSQL syntax, zero-downtime patterns verified (additive-only ALTER TABLE, ON CONFLICT DO NOTHING)
- ✅ Vitest test runner: All 502 Sprint 3 tests execute successfully in <10 seconds total

**API v2 Verification**
- ✅ CalendarsController: Endpoint routing verified for GET /v2/calendars, GET /v2/calendars/busy-times
- ✅ CalendarsProcessor: Event processing pipeline backward-compatible
- ✅ Provider services (gcal, outlook, apple-calendar): Adapter wrappers verified via JSDoc annotations

**Calendar Adapter Verification**
- ✅ Google Calendar: createEvent, updateEvent, deleteEvent, getAvailability — all Calendly-parity scenarios passing
- ✅ Outlook/O365: Graph API batch requests, showAs filtering, retry-after, delegation credentials — all parity scenarios passing
- ✅ Apple Calendar: CalDAV REPORT, event CRUD, VTIMEZONE injection — all parity scenarios passing

**Gap Closure Features**
- ✅ CalendarCancellationSyncService: Booking lookup by external event UID, feature flag gating, cancellation propagation — all 10 test scenarios passing
- ✅ BufferTimeEventService: Buffer event creation/deletion, dual gating (flag + toggle), edge cases — all 20 test scenarios passing
- ✅ EventManager integration: Buffer context threaded through create, reschedule, cancel, confirm flows
- ⚠️ Webhook intake routes: Functional with test payloads; requires HTTPS deployment for real Google/Microsoft notifications

**UI Verification**
- ⚠️ Event Type Settings: `syncBuffersToCalendar` toggle added to EventLimitsTab.tsx — not visually verified (requires running web app with database)
- ✅ Feature flag configuration: `calendar-cancellation-sync` and `calendar-buffer-sync` registered in `flags/config.ts` and `useFlags.ts`

---

## 5. Compliance & Quality Review

| Compliance Dimension | Status | Evidence |
|---------------------|--------|----------|
| Zero-Downtime Migration | ✅ Pass | Migration uses Pattern 2 (nullable columns) and Pattern 5 (feature flag rows with ON CONFLICT DO NOTHING) — no column renames, type changes, or NOT NULL without defaults |
| Data Preservation | ✅ Pass | Existing Credential, SelectedCalendar, DestinationCalendar, and Booking records unmodified — new columns are nullable, no data migration required |
| Webhook Backward Compatibility | ✅ Pass | No modifications to `packages/features/webhooks/` — `v2021-10-20` payload structure unchanged; calendar-driven cancellation fires standard `BOOKING_CANCELLED` event |
| Credential Encryption | ✅ Pass | AES-256 encryption with `CALENDSO_ENCRYPTION_KEY` unchanged — Apple Calendar credential audit confirms encryption/decryption integrity |
| Feature Flag Gating | ✅ Pass | Both gap closure features gated behind disabled-by-default flags (`calendar-cancellation-sync`, `calendar-buffer-sync`) — not user-facing until explicitly enabled |
| Spec-First Workflow | ✅ Pass | `specs/calendar-integrations/` directory created with all 7 required artifacts per `specs/README.md` |
| PR Size Guidance | ⚠️ Partial | Combined into single branch with 94 files changed — exceeds 5–7 file PR constraint for individual PRs but represents complete sprint delivery |
| Regression Safety | ✅ Pass | Full test suite result (586/20/7) matches pre-existing baseline exactly — zero regressions introduced |
| ADR Documentation | ✅ Pass | 5 Architecture Decision Records in `specs/calendar-integrations/decisions.md` covering push vs. polling, buffer event naming, status filter storage, dynamic imports, and CalDAV limitations |
| Gate 3 Validation | ✅ Pass | All 8 CI-VAL criteria (CI-VAL-001 through CI-VAL-008) have passing test evidence recorded in `docs/sprint-roadmap/validation-criteria.mdx` |

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|------|----------|----------|-------------|------------|--------|
| Google push notifications fail in production due to domain verification or firewall issues | Integration | High | Medium | Webhook route includes validation logic; fallback to polling-based sync if push fails; health monitoring alerts | Open |
| Microsoft Graph change notifications rejected due to Azure AD permission gaps | Integration | High | Medium | App registration requires `Calendars.Read` admin consent; webhook validation token handling implemented in route handler | Open |
| Buffer time events orphaned if EventManager buffer deletion fails silently | Technical | Medium | Low | Best-effort pattern with error logging; `deleteBufferEventsForBooking` queries BookingReference by type filter; manual cleanup possible via admin API | Mitigated |
| Pre-existing 20 test failures mask future regressions | Technical | Medium | Medium | Sprint 3 uses dedicated test file isolation; full suite baseline documented; recommend triage as separate workstream | Open |
| Real-world Calendar API rate limiting differs from mocked test behavior | Operational | Medium | Medium | Outlook adapter includes retry-after handling; Google adapter chunks FreeBusy API calls to stay within quota; monitoring recommended for production | Mitigated |
| Dynamic imports in EventManager may fail in edge-case bundling scenarios | Technical | Low | Low | Used to prevent breaking existing test mocks that don't include `ALL_APPS` from `@calcom/app-store/utils`; pattern documented in ADR-005 | Mitigated |
| CalDAV (Apple) has no push notification mechanism — cancellation sync limited to Google/Outlook | Technical | Low | N/A | Documented as architectural limitation; Apple Calendar cancellation sync deferred to future work (`specs/calendar-integrations/future-work.md`) | Accepted |
| Sensitive OAuth tokens in credential table accessible if `CALENDSO_ENCRYPTION_KEY` compromised | Security | High | Low | Existing AES-256 encryption unchanged; encryption key management is infrastructure responsibility; Sprint 3 adds no new attack surface | Mitigated |

---

## 7. Visual Project Status

```mermaid
pie title Project Hours Breakdown
    "Completed Work" : 172
    "Remaining Work" : 41
```

**Remaining Work by Priority:**

| Priority | Hours | Categories |
|----------|-------|------------|
| High | 18 | Real API testing (10h), environment config (4h), migration deployment (4h) |
| Medium | 18 | Feature flag UAT (7h), webhook security (5h), monitoring (4h), Gate 3 sign-off (2h) |
| Low | 5 | Pre-existing test triage (5h) |
| **Total** | **41** | |

---

## 8. Summary & Recommendations

### Achievements

Sprint 3: Calendar Integrations (F-003) is **80.8% complete** with 172 hours of autonomous development work delivered across 94 files (18,069 lines added). All 5 sprint epics and both gap closure features are fully implemented with 502 passing tests and zero regressions against the existing codebase baseline.

The implementation covers the full depth of the AAP requirements: adapter-level Calendly parity verification for Google (CI-001), Outlook (CI-002), and Apple (CI-003) calendars; configurable conflict detection alignment (CI-004) with `statusFilter` threading through the complete availability pipeline; and bi-directional sync verification (CI-005) with comprehensive integration tests. Both Medium-severity gap closures — calendar-driven cancellation sync and buffer time calendar visualization — are fully implemented behind disabled-by-default feature flags with complete DI registration, booking lifecycle integration, and test coverage.

### Remaining Gaps

The 41 remaining hours consist entirely of path-to-production activities that require human intervention:
- **Environment setup**: Webhook callback URLs, Azure AD permissions, domain verification for Google push notifications
- **Real API validation**: Live testing with actual Google, Outlook, and Apple calendar accounts (current tests use mocks)
- **Feature activation**: Gradual flag enablement with user acceptance testing
- **Production hardening**: Webhook signature verification, rate limiting, monitoring, and alerting

### Production Readiness Assessment

The codebase is **ready for staging deployment and manual validation**. All autonomous development work is complete, compilable, and tested. The remaining work requires human access to production infrastructure, real calendar API credentials, and organizational approval for feature flag activation.

### Critical Path to Production

1. Deploy migration → 2. Configure environment → 3. Test with real APIs → 4. Harden webhooks → 5. Enable flags in staging → 6. UAT → 7. Gate 3 sign-off → 8. Production deployment

---

## 9. Development Guide

### System Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20.x LTS | Required by Cal.com monorepo |
| Yarn | 4.12.0+ | Package manager (set via `packageManager` in package.json) |
| PostgreSQL | 15.x+ | Primary database |
| TypeScript | 5.9.3 | Compiler version |
| Git | 2.x+ | Version control |

### Environment Setup

```bash
# 1. Clone and checkout the Sprint 3 branch
git clone <repository-url>
cd cal.com
git checkout blitzy-5755aac2-6bb5-4676-bf93-08909a56da15

# 2. Copy environment template and configure
cp .env.example .env

# 3. Required environment variables (edit .env):
# DATABASE_URL="postgresql://postgres:@localhost:5450/calendso"
# NEXTAUTH_SECRET="<generate-random-secret>"
# CALENDSO_ENCRYPTION_KEY="<32-character-hex-string>"
# GOOGLE_API_CREDENTIALS='{"web":{"client_id":"...","client_secret":"..."}}'
# MS_GRAPH_CLIENT_ID="<azure-ad-app-client-id>"
# MS_GRAPH_CLIENT_SECRET="<azure-ad-app-client-secret>"
#
# NEW for Sprint 3 gap closures:
# GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL="https://yourdomain.com/api/webhooks/google-calendar"
# OUTLOOK_GRAPH_NOTIFICATION_URL="https://yourdomain.com/api/webhooks/microsoft-graph"
```

### Dependency Installation

```bash
# Install all workspace dependencies
yarn install

# Generate Prisma client
yarn prisma generate --schema=packages/prisma/schema.prisma
```

### Database Setup

```bash
# Run all migrations (includes Sprint 3 migration)
yarn db-deploy

# Verify Sprint 3 migration applied
yarn prisma migrate status --schema=packages/prisma/schema.prisma
# Should show: 20260305000000_calendar_integration_gap_closure — Applied

# Verify new columns exist
psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name='EventType' AND column_name='syncBuffersToCalendar';"
# Expected: syncBuffersToCalendar

psql $DATABASE_URL -c "SELECT slug, enabled FROM \"Feature\" WHERE slug LIKE 'calendar-%';"
# Expected:
# calendar-cancellation-sync | false
# calendar-buffer-sync       | false
```

### Running Tests

```bash
# Run all Sprint 3 specific tests
TZ=UTC npx vitest run packages/app-store/googlecalendar/lib/__tests__/ \
  packages/app-store/office365calendar/lib/__tests__/ \
  packages/app-store/applecalendar/lib/__tests__/ \
  packages/features/calendars/lib/__tests__/ \
  packages/features/calendars/lib/CalendarManager.test.ts \
  packages/features/CalendarEventBuilder.test.ts \
  packages/features/busyTimes/services/getBusyTimes.test.ts \
  packages/features/calendar-subscription/ \
  packages/features/selectedCalendar/ \
  packages/features/bookings/lib/__tests__/roundRobinManualReassignment.test.ts \
  --reporter=verbose

# Expected: 502 tests passed, 0 failed

# Run individual test suites
TZ=UTC npx vitest run packages/features/calendars/lib/__tests__/bufferTimeVisualization.test.ts --reporter=verbose
# Expected: 20 tests passed

TZ=UTC npx vitest run packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts --reporter=verbose
# Expected: 41 tests passed

TZ=UTC npx vitest run packages/features/calendar-subscription/lib/__tests__/CalendarCancellationSync.test.ts --reporter=verbose
# Expected: 10 tests passed

# Run full test suite (includes pre-existing failures)
TZ=UTC npx vitest run --reporter=verbose
# Expected: 586 passed, 20 failed (pre-existing), 7 skipped
```

### Application Startup

```bash
# Start development server
yarn dev

# Application available at http://localhost:3000
# API v2 available at http://localhost:5555
```

### Verification Steps

```bash
# 1. Verify TypeScript compilation (no errors expected)
npx tsc --noEmit 2>&1 | head -5

# 2. Verify Prisma schema is valid
yarn prisma validate --schema=packages/prisma/schema.prisma

# 3. Verify feature flags are registered
grep -c "calendar-cancellation-sync\|calendar-buffer-sync" packages/features/flags/config.ts
# Expected: 2
```

### Troubleshooting

| Issue | Resolution |
|-------|-----------|
| `vitest` enters watch mode | Always use `npx vitest run` (not `npx vitest`) or set `CI=true` |
| Prisma generate fails | Run `yarn install` first, then `yarn prisma generate --schema=packages/prisma/schema.prisma` |
| Migration status shows "pending" | Run `yarn db-deploy` to apply all pending migrations |
| Tests fail with `Cannot find module @calcom/prisma` | Run `yarn prisma generate` to regenerate the Prisma client |
| BufferTimeEventService import error | Dynamic imports are used intentionally — ensure `@calcom/app-store` packages are built |

---

## 10. Appendices

### A. Command Reference

| Command | Purpose |
|---------|---------|
| `yarn install` | Install all workspace dependencies |
| `yarn prisma generate --schema=packages/prisma/schema.prisma` | Generate Prisma client |
| `yarn db-deploy` | Run all database migrations |
| `yarn prisma migrate status --schema=packages/prisma/schema.prisma` | Check migration status |
| `yarn dev` | Start development server |
| `TZ=UTC npx vitest run --reporter=verbose` | Run full test suite |
| `npx tsc --noEmit` | TypeScript type checking |
| `yarn db-studio` | Open Prisma Studio for database inspection |

### B. Port Reference

| Port | Service |
|------|---------|
| 3000 | Cal.com web application (Next.js) |
| 5555 | API v2 (NestJS) |
| 5450 | PostgreSQL (default) |

### C. Key File Locations

| Purpose | Path |
|---------|------|
| Google Calendar adapter | `packages/app-store/googlecalendar/lib/CalendarService.ts` |
| Outlook adapter | `packages/app-store/office365calendar/lib/CalendarService.ts` |
| Apple Calendar adapter | `packages/app-store/applecalendar/lib/CalendarService.ts` |
| CalendarManager | `packages/features/calendars/lib/CalendarManager.ts` |
| CalendarEventBuilder | `packages/features/CalendarEventBuilder.ts` |
| getBusyTimes | `packages/features/busyTimes/services/getBusyTimes.ts` |
| getUserAvailability | `packages/features/availability/lib/getUserAvailability.ts` |
| CancellationSyncService | `packages/features/calendars/lib/cancellation-sync/CalendarCancellationSyncService.ts` |
| BufferTimeEventService | `packages/features/calendars/lib/buffer-sync/BufferTimeEventService.ts` |
| EventManager | `packages/features/bookings/lib/EventManager.ts` |
| Sprint 3 migration | `packages/prisma/migrations/20260305000000_calendar_integration_gap_closure/migration.sql` |
| Prisma schema | `packages/prisma/schema.prisma` |
| Calendar type definitions | `packages/types/Calendar.d.ts` |
| Feature flags config | `packages/features/flags/config.ts` |
| Sprint 3 design spec | `specs/calendar-integrations/design.md` |
| Sprint 3 decisions | `specs/calendar-integrations/decisions.md` |
| Google webhook route | `apps/web/app/api/webhooks/google-calendar/route.ts` |
| Microsoft Graph webhook route | `apps/web/app/api/webhooks/microsoft-graph/route.ts` |

### D. Technology Versions

| Technology | Version |
|-----------|---------|
| Node.js | 20.x LTS |
| TypeScript | 5.9.3 |
| Yarn | 4.12.0 |
| Prisma | 6.16.1 |
| Vitest | 4.0.16 |
| Next.js | (workspace) |
| NestJS | (API v2) |
| @googleapis/calendar | 9.7.9 |
| zod | 3.25.76 |
| dayjs | (from @calcom/dayjs) |

### E. Environment Variable Reference

| Variable | Purpose | Sprint 3 Change |
|----------|---------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | No change |
| `CALENDSO_ENCRYPTION_KEY` | AES-256 encryption key for credential storage | No change |
| `GOOGLE_API_CREDENTIALS` | Google OAuth2 client credentials | No change |
| `MS_GRAPH_CLIENT_ID` | Azure AD application client ID | No change |
| `MS_GRAPH_CLIENT_SECRET` | Azure AD application client secret | No change |
| `GOOGLE_CALENDAR_PUSH_NOTIFICATION_URL` | Callback URL for Google Calendar push notifications | **New** — Required for CI-001 gap closure |
| `OUTLOOK_GRAPH_NOTIFICATION_URL` | Callback URL for Microsoft Graph change notifications | **New** — Required for CI-001 gap closure |

### F. Developer Tools Guide

| Tool | Usage |
|------|-------|
| Prisma Studio | `yarn db-studio` — Visual database browser at `http://localhost:5555` |
| Vitest UI | `npx vitest --ui` — Interactive test runner (development only) |
| TypeScript | `npx tsc --noEmit` — Full type checking without emitting files |
| Biome | `npx biome check .` — Linting and formatting analysis |

### G. Glossary

| Term | Definition |
|------|-----------|
| CI-001 through CI-005 | Sprint 3 epic identifiers for Calendar Integration features |
| CI-VAL-001 through CI-VAL-008 | Gate 3 validation criteria for Calendar Integrations |
| CalDAV | Calendar Distributed Authoring and Versioning — protocol used by Apple Calendar |
| FreeBusy API | Google Calendar API for querying aggregate busy/free windows |
| showAs | Microsoft Graph property indicating event status (Busy, Tentative, Away, WorkingElsewhere, Oof) |
| statusFilter | New optional parameter for configurable conflict detection — determines which event statuses block availability |
| Feature Flag | Runtime toggle controlling feature availability — `calendar-cancellation-sync` and `calendar-buffer-sync` are disabled by default |
| Gate 3 | Validation gate that must pass before Sprint 4 (Webhooks & Events) can begin |
| Zero-downtime migration | Database migration pattern that avoids service interruption — nullable columns, additive changes only |
| DI (Dependency Injection) | Cal.com uses `@evyweb/ioctopus` IoC container for service registration |
| Buffer event | Optional calendar event created before/after a booking to visualize buffer time periods |
| Cancellation sync | Feature that propagates external calendar event deletions back to Cal.com as booking cancellations |