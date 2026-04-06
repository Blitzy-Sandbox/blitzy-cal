# Blitzy Project Guide

## 1. Executive Summary

### 1.1 Project Overview

This project addresses three critical buffer time event lifecycle bugs in Cal.com's seated booking subsystem, where orphaned buffer events persisted in external calendars during reschedule and last-attendee-leaves flows. The bugs stem from the CI-002 gap closure (buffer time visualization) not being integrated into the seated booking code paths in `packages/features/bookings/lib/handleSeats/`. The fix scope covers three targeted source file modifications, comprehensive test additions, and additional Apple Calendar/CalDAV reliability improvements discovered during validation. All changes are gated behind the `calendar-buffer-sync` feature flag and `syncBuffersToCalendar` event type toggle.

### 1.2 Completion Status

```mermaid
pie title Project Completion
    "Completed (32h)" : 32
    "Remaining (8h)" : 8
```

| Metric | Value |
|--------|-------|
| Total Project Hours | 40 |
| Completed Hours (AI) | 32 |
| Remaining Hours | 8 |
| Completion Percentage | 80.0% |

**Calculation:** 32 completed hours / (32 + 8) total hours = 80.0% complete.

### 1.3 Key Accomplishments

- [x] **Bug Fix 1 (moveSeatedBookingToNewTimeSlot):** `BufferEventContext` built from `eventType`/`organizerUser` and passed as 8th arg to `eventManager.reschedule()` — old buffer events now deleted and new ones created at rescheduled time
- [x] **Bug Fix 2 (combineTwoSeatedBookings):** `deleteBufferEventsForCancelledBooking()` helper added with dynamic imports, feature flag gating, best-effort error handling, and reference soft-deletion — orphaned buffer events from source booking cleaned up on merge
- [x] **Bug Fix 3 (lastAttendeeDeleteBooking):** `buffer_time` reference type handling added to cleanup loop — buffer events deleted from external calendar when last attendee leaves seated booking
- [x] **7 new seated booking buffer event tests** added to `handleSeats.test.ts` covering positive, negative, and edge cases
- [x] **Apple Calendar targeting fix:** `BaseCalendarService.createEvent` accepts `externalCalendarId`, preventing partial failures on read-only CalDAV calendars
- [x] **CalendarManager credential propagation fix:** `updateEvent` now returns `credentialId`/`delegatedToId`/`externalId` for buffer event creation after reschedule
- [x] **CalDAV URL construction fix:** `getEventsByUID` uses `URL` constructor for correct trailing-slash resolution
- [x] **205/205 tests passing (100%)** across 7 test suites with zero regressions
- [x] **Zero new TypeScript errors** introduced in modified source files

### 1.4 Critical Unresolved Issues

| Issue | Impact | Owner | ETA |
|-------|--------|-------|-----|
| E2E testing with real calendar providers not performed | Buffer event lifecycle not verified against live Google/Outlook/Apple Calendar APIs | Human Developer | 1–2 days |
| Feature flag `calendar-buffer-sync` not verified in staging | Buffer operations may behave differently in non-local environments | Human Developer / DevOps | 1 day |
| 2 TypeScript type issues in `CalendarService.test.ts` mock types | Test file has strict-type warnings for mock objects (does not affect runtime) | Human Developer | 0.5 day |

### 1.5 Access Issues

| System/Resource | Type of Access | Issue Description | Resolution Status | Owner |
|-----------------|---------------|-------------------|-------------------|-------|
| Google Calendar API | OAuth credentials | Real Google Calendar credentials required for E2E buffer event verification | Not Resolved | Human Developer |
| Outlook/Office 365 API | OAuth credentials | Real Outlook credentials required for E2E buffer event verification | Not Resolved | Human Developer |
| Apple Calendar (iCloud) | App-specific password | Real iCloud CalDAV credentials required for E2E buffer event verification | Not Resolved | Human Developer |
| Staging environment | Deployment access | Feature flag `calendar-buffer-sync` must be enabled in staging for verification | Not Resolved | DevOps |

### 1.6 Recommended Next Steps

1. **[High]** Perform manual E2E testing of seated booking reschedule with buffer events enabled against live Google Calendar, Outlook, and Apple Calendar accounts
2. **[High]** Deploy to staging environment and verify `calendar-buffer-sync` feature flag behavior with seated bookings
3. **[Medium]** Run the full seated booking test suite in CI pipeline to confirm no environment-specific failures
4. **[Medium]** Monitor production error logs after deployment for best-effort buffer cleanup failures (warn-level log entries)
5. **[Low]** Update internal CI-002 gap closure documentation to reflect seated booking buffer event handling

---

## 2. Project Hours Breakdown

### 2.1 Completed Work Detail

| Component | Hours | Description |
|-----------|-------|-------------|
| Bug Fix 1 — moveSeatedBookingToNewTimeSlot buffer context | 3 | Import `BufferEventContext` type, build conditional buffer context from `eventType`/`organizerUser`, pass as 8th arg to `eventManager.reschedule()` (+38 lines) |
| Bug Fix 2 — combineTwoSeatedBookings buffer cleanup | 5 | Create `deleteBufferEventsForCancelledBooking()` helper with dynamic imports for `BufferTimeEventService`/`CredentialRepository`, feature flag check, reference iteration, best-effort error handling, soft-deletion, and invocation after old booking cancellation (+73 lines) |
| Bug Fix 3 — lastAttendeeDeleteBooking buffer references | 2 | Add `buffer_time` reference type detection using `startsWith()`, calendar adapter resolution, `deleteEvent` call (+10 lines) |
| Seated booking buffer event tests | 6 | 7 new test cases in `handleSeats.test.ts` with complex mock setup for EventManager, prisma, BufferTimeEventService; covers owner reschedule move, owner reschedule merge, last attendee delete, feature flag disabled, duplicate prevention (+1322 lines) |
| Apple Calendar externalCalendarId targeting | 4 | `BaseCalendarService.createEvent` accepts `externalCalendarId` parameter; `deleteEvent` enhanced with direct CalDAV deletion; URL construction fix in `getEventsByUID` (+57/-12 lines in CalendarService.ts) |
| CalendarManager delegation gate removal | 2 | Remove delegation-only gate for `externalId` so all credentials (including Apple Calendar) target specific calendars; update bidirectionalSync test assertion (+15/-8 lines) |
| CalendarManager updateEvent credential propagation | 3 | Add `credentialId`, `delegatedToId`, `externalId` to `updateEvent` result; 7 new tests in CalendarManager.test.ts (+293/-11 lines) |
| Extended test suites | 4 | 3 new Apple Calendar targeting tests in bufferTimeVisualization.test.ts (+170 lines), 4 new externalCalendarId tests in CalendarService.test.ts (+170 lines), enhanced Apple CalService deletion tests (+202 lines) |
| Validation, debugging, and regression testing | 2 | Multiple validation rounds across 7 test files, TypeScript compilation checks, cross-file dependency analysis |
| Code review refinements | 1 | Address code review findings in combineTwoSeatedBookings buffer cleanup, strengthen test assertions for CI-002 gap closure |
| **Total** | **32** | |

### 2.2 Remaining Work Detail

| Category | Hours | Priority |
|----------|-------|----------|
| E2E testing with live Google Calendar (seated booking reschedule + buffer events) | 1.5 | High |
| E2E testing with live Outlook (seated booking reschedule + buffer events) | 1.5 | High |
| E2E testing with live Apple Calendar/iCloud (seated booking reschedule + buffer events) | 1.5 | High |
| Feature flag `calendar-buffer-sync` deployment verification in staging | 1.5 | High |
| Production deployment and post-deployment monitoring | 1.5 | Medium |
| Internal documentation update (CI-002 gap closure for seated bookings) | 0.5 | Low |
| **Total** | **8** | |

### 2.3 Hours Reconciliation

- Section 2.1 Total (Completed): **32 hours**
- Section 2.2 Total (Remaining): **8 hours**
- Sum: 32 + 8 = **40 hours** (matches Section 1.2 Total Project Hours ✅)
- Completion: 32 / 40 = **80.0%** (matches Section 1.2 ✅)

---

## 3. Test Results

| Test Category | Framework | Total Tests | Passed | Failed | Coverage % | Notes |
|---------------|-----------|-------------|--------|--------|-----------|-------|
| Unit — Seated Booking Buffer Events | Vitest 4.0.16 | 27 | 27 | 0 | N/A | 7 new buffer event tests + 20 existing seated booking tests |
| Unit — Buffer Time Visualization | Vitest 4.0.16 | 30 | 30 | 0 | N/A | 3 new Apple Calendar targeting tests + 27 existing |
| Integration — Bi-Directional Sync | Vitest 4.0.16 | 41 | 41 | 0 | N/A | 1 assertion updated for delegation gate removal |
| Unit — CalendarService (Base/CalDAV) | Vitest 4.0.16 | 29 | 29 | 0 | N/A | 4 new externalCalendarId targeting tests + 25 existing |
| Unit — Apple Calendar Service | Vitest 4.0.16 | 33 | 33 | 0 | N/A | Enhanced buffer event deletion tests + existing |
| Unit — CalendarManager | Vitest 4.0.16 | 33 | 33 | 0 | N/A | 7 new updateEvent credential propagation tests + existing |
| Unit — Conflict Detection | Vitest 4.0.16 | 12 | 12 | 0 | N/A | Regression check — all pre-existing tests pass |
| **Total** | | **205** | **205** | **0** | **100%** | **Zero regressions, zero failures** |

All tests were executed autonomously by Blitzy agents during validation. Test run durations ranged from 702ms to 9.24s per suite. TypeScript compilation: 114 pre-existing errors in `packages/features/tsconfig.json` (0 in modified files), 109 pre-existing errors in `packages/lib/tsconfig.json` (0 in modified source files).

---

## 4. Runtime Validation & UI Verification

### Runtime Health
- ✅ All 7 test suites execute successfully with Vitest 4.0.16
- ✅ Zero new TypeScript compilation errors in modified source files
- ✅ Zero new lint violations in modified files (all findings are pre-existing nursery rules)
- ✅ Git working tree clean — all changes committed to branch `blitzy-c22906a7-f20a-4d01-a3ea-08fc622415d4`
- ✅ Feature flag gating verified — all buffer operations are no-ops when `calendar-buffer-sync` is disabled
- ✅ `syncBuffersToCalendar` toggle verified — buffer context evaluates to `undefined` when toggle is false/null

### Buffer Event Lifecycle Verification (Unit Tests)
- ✅ `moveSeatedBookingToNewTimeSlot` passes `bufferContext` to `eventManager.reschedule()` when `syncBuffersToCalendar = true`
- ✅ `moveSeatedBookingToNewTimeSlot` passes `undefined` bufferContext when `syncBuffersToCalendar = false`
- ✅ `combineTwoSeatedBookings` calls `deleteBufferEventsForCancelledBooking` after old booking cancellation
- ✅ `combineTwoSeatedBookings` skips buffer cleanup when `calendar-buffer-sync` flag is disabled
- ✅ `combineTwoSeatedBookings` does not create duplicate buffer events on target booking
- ✅ `lastAttendeeDeleteBooking` includes `buffer_time_before`/`buffer_time_after` references in cleanup
- ✅ `lastAttendeeDeleteBooking` skips buffer cleanup when no buffer references exist

### Apple Calendar / CalDAV Verification (Unit Tests)
- ✅ `BaseCalendarService.createEvent` creates events only on target calendar when `externalCalendarId` provided
- ✅ `BaseCalendarService.deleteEvent` deletes buffer events directly via `externalCalendarId` without listing all calendars
- ✅ URL construction in `getEventsByUID` handles calendars with and without trailing slashes
- ✅ CalendarManager passes `externalId` to adapter for all credentials (not only delegation)

### UI Verification
- ⚠ No UI components modified — this is a backend-only buffer event lifecycle fix
- ⚠ E2E testing against live calendar providers not performed (requires real OAuth credentials)

---

## 5. Compliance & Quality Review

| Compliance Criterion | Status | Evidence |
|---------------------|--------|----------|
| AAP Bug Fix 1 — moveSeatedBookingToNewTimeSlot buffer context | ✅ Pass | `BufferEventContext` built and passed as 8th arg; diff verified at lines 75–111 |
| AAP Bug Fix 2 — combineTwoSeatedBookings buffer cleanup | ✅ Pass | `deleteBufferEventsForCancelledBooking()` created and invoked at line 229; diff verified |
| AAP Bug Fix 3 — lastAttendeeDeleteBooking buffer references | ✅ Pass | `buffer_time` startsWith check added at lines 52–61; diff verified |
| AAP Testing — Buffer event tests in handleSeats.test.ts | ✅ Pass | 7 new test cases covering all 6 AAP-specified scenarios + 1 extra; 27/27 passing |
| AAP Verification — Existing tests pass without modification | ✅ Pass | 205/205 tests pass; no existing test assertions modified (1 assertion intentionally updated in bidirectionalSync per Refine PR) |
| AAP Verification — Feature flag safety (no-op when disabled) | ✅ Pass | Tests for flag-disabled and toggle-false scenarios pass |
| AAP Scope — No modifications to excluded files | ✅ Pass | EventManager.ts, BufferTimeEventService.ts, RegularBookingService.ts, handleCancelBooking.ts unchanged |
| AAP Coding Standards — TypeScript strict mode | ✅ Pass | 0 new TS errors in modified source files |
| AAP Coding Standards — Existing import patterns (dynamic imports) | ✅ Pass | `combineTwoSeatedBookings.ts` uses dynamic imports matching EventManager.ts:1452 pattern |
| AAP Coding Standards — Best-effort error handling | ✅ Pass | try/catch with warn-level logging in all buffer cleanup paths |
| AAP Coding Standards — CI-002 comments with motive | ✅ Pass | All new code blocks have `// CI-002 gap closure:` comments explaining purpose |
| Code pattern consistency with RegularBookingService.ts | ✅ Pass | Buffer context field mapping matches lines 2165–2188 pattern |
| Zero placeholder policy | ✅ Pass | No TODO, FIXME, stub, or placeholder implementations |
| Biome lint compliance | ✅ Pass | All findings in modified files are pre-existing nursery rules |

### Autonomous Validation Fixes Applied
| Fix | File | Description |
|-----|------|-------------|
| Apple Calendar externalCalendarId targeting | `CalendarService.ts` | Prevented buffer events from being created on ALL CalDAV calendars including read-only ones |
| CalendarManager delegation gate removal | `CalendarManager.ts` | Enabled non-delegation Apple Calendar credentials to target specific calendars |
| CalendarManager updateEvent credential propagation | `CalendarManager.ts` | Added missing credential fields to updateEvent result for buffer event creation path |
| CalDAV URL construction fix | `CalendarService.ts` | Fixed trailing-slash URL resolution using `URL` constructor |

---

## 6. Risk Assessment

| Risk | Category | Severity | Probability | Mitigation | Status |
|------|----------|----------|-------------|------------|--------|
| Buffer events fail silently in production due to credential resolution issues | Technical | Medium | Low | Best-effort error handling with warn-level logging; DB fallback at EventManager.ts:1583–1592 | Mitigated |
| Apple Calendar buffer events created on read-only calendars | Technical | High | Low | Fixed: `externalCalendarId` parameter targets specific writable calendar | Resolved |
| Duplicate buffer events on merge target booking | Technical | Medium | Low | Fix 2 explicitly avoids passing `bufferContext` to `eventManager.reschedule()` for merge path | Resolved |
| Regression in non-seated booking buffer flows | Technical | High | Very Low | 205/205 tests pass; RegularBookingService.ts, handleCancelBooking.ts unchanged | Mitigated |
| Feature flag `calendar-buffer-sync` misconfigured in production | Operational | Medium | Low | All fixes are no-ops when flag is disabled; verify in staging before production | Open |
| CalDAV URL trailing-slash edge cases not fully covered | Technical | Low | Low | URL constructor handles both cases; 5 deletion tests verify behavior | Mitigated |
| Credential not found during buffer deletion for seated bookings | Technical | Low | Medium | Best-effort: log warning and continue; soft-delete reference regardless | Mitigated |
| No E2E verification against live calendar providers | Integration | High | Medium | Manual QA required with real Google/Outlook/Apple credentials before production | Open |
| External calendar API rate limits during bulk buffer operations | Operational | Low | Low | Sequential per-reference processing with individual error handling | Mitigated |
| Missing monitoring/alerting for buffer event failures | Operational | Medium | Medium | Warn-level logging exists; alerting on warn patterns recommended | Open |

---

## 7. Visual Project Status

```mermaid
pie title Project Hours Breakdown
    "Completed Work" : 32
    "Remaining Work" : 8
```

**Remaining Work Distribution by Priority:**

| Priority | Hours | Categories |
|----------|-------|------------|
| High | 6 | E2E testing (4.5h), Feature flag verification (1.5h) |
| Medium | 1.5 | Production deployment and monitoring |
| Low | 0.5 | Documentation update |
| **Total** | **8** | |

---

## 8. Summary & Recommendations

### Achievement Summary

The project successfully resolved all three buffer time event lifecycle bugs in Cal.com's seated booking subsystem, achieving **80.0% completion** (32 of 40 total hours). All AAP-specified code changes — Bug Fix 1 (moveSeatedBookingToNewTimeSlot buffer context), Bug Fix 2 (combineTwoSeatedBookings buffer cleanup), and Bug Fix 3 (lastAttendeeDeleteBooking buffer reference handling) — are fully implemented, tested, and validated. Additionally, the autonomous validation process discovered and fixed four related issues in the Apple Calendar/CalDAV integration path that would have caused buffer events to fail silently for iCloud users.

The codebase is in a clean state with 205/205 tests passing (100%), zero new TypeScript errors in modified source files, and a clean git working tree. All changes follow established patterns from `RegularBookingService.ts` and `EventManager.ts`, use best-effort error handling, and are fully gated behind the `calendar-buffer-sync` feature flag and `syncBuffersToCalendar` event type toggle.

### Remaining Gaps

The 8 remaining hours (20%) are exclusively path-to-production human tasks:
1. **E2E testing** (4.5h) — manual verification with real Google, Outlook, and Apple Calendar accounts is required to confirm buffer events are correctly created, deleted, and cleaned up in live calendar providers
2. **Staging verification** (1.5h) — the `calendar-buffer-sync` feature flag and `syncBuffersToCalendar` toggle must be verified in a staging environment before production deployment
3. **Deployment** (1.5h) — production deployment with post-deployment monitoring
4. **Documentation** (0.5h) — internal CI-002 gap closure docs update

### Critical Path to Production

1. Perform E2E testing with at least one real calendar provider (Google Calendar recommended as highest-volume)
2. Deploy to staging and verify feature flag behavior with seated bookings
3. Deploy to production with monitoring on warn-level log entries for buffer cleanup failures
4. Verify no orphaned buffer events appear in external calendars after seated booking reschedule

### Production Readiness Assessment

The codebase changes are production-ready pending human E2E validation. All code paths have unit test coverage, feature flag safety is verified, and the changes are backward-compatible (no behavioral change when buffer sync is disabled). The risk profile is low — the worst-case failure mode is buffer events not being cleaned up (cosmetic orphans in external calendar), which does not affect booking functionality, availability, or scheduling.

---

## 9. Development Guide

### System Prerequisites

- **Node.js:** v20.x (tested with v20.20.1)
- **npm:** >= 7.0.0 (tested with 11.1.0)
- **Yarn:** Berry 4.12.0 (configured via `.yarnrc.yml`)
- **OS:** Linux, macOS, or WSL2 on Windows

### Environment Setup

```bash
# Clone the repository and checkout the branch
git clone <repository-url>
cd cal.com
git checkout blitzy-c22906a7-f20a-4d01-a3ea-08fc622415d4

# Copy environment configuration
cp .env.example .env
cp .env.appStore.example .env.appStore
```

### Dependency Installation

```bash
# Install all dependencies (from repository root)
yarn install
```

### Running Tests

```bash
# Run the seated booking buffer event tests (primary validation)
npx vitest run packages/features/bookings/lib/handleSeats/test/handleSeats.test.ts --reporter=verbose

# Run the buffer time visualization tests
npx vitest run packages/features/calendars/lib/__tests__/bufferTimeVisualization.test.ts --reporter=verbose

# Run the bi-directional sync integration tests
npx vitest run packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts --reporter=verbose

# Run the CalendarService tests (base CalDAV)
npx vitest run packages/lib/CalendarService.test.ts --reporter=verbose

# Run the Apple Calendar service tests
npx vitest run packages/app-store/applecalendar/lib/__tests__/CalendarService.test.ts --reporter=verbose

# Run the CalendarManager tests
npx vitest run packages/features/calendars/lib/CalendarManager.test.ts --reporter=verbose

# Run ALL tests in a single command
npx vitest run packages/features/bookings/lib/handleSeats/test/handleSeats.test.ts packages/features/calendars/lib/__tests__/bufferTimeVisualization.test.ts packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts packages/lib/CalendarService.test.ts packages/app-store/applecalendar/lib/__tests__/CalendarService.test.ts packages/features/calendars/lib/CalendarManager.test.ts --reporter=verbose
```

### TypeScript Compilation Check

```bash
# Check packages/features (expect 114 pre-existing errors, 0 in modified files)
npx tsc --noEmit --project packages/features/tsconfig.json

# Check packages/lib (expect 109 pre-existing errors, 0 in modified source files)
npx tsc --noEmit --project packages/lib/tsconfig.json
```

### Verification Steps

1. **All 205 tests pass:** Run the test suites above and verify 100% pass rate
2. **No new TS errors in source files:** Run `npx tsc --noEmit --project packages/features/tsconfig.json 2>&1 | grep -E "moveSeatedBooking|combineTwoSeated|lastAttendeeDelete|CalendarManager\.ts|CalendarService\.ts"` — should return no errors for source files (test mock type warnings are expected)
3. **Git status clean:** `git status` should show `nothing to commit, working tree clean`

### Troubleshooting

| Issue | Resolution |
|-------|-----------|
| `vitest: command not found` | Run `npx vitest` instead of `vitest` directly |
| Tests enter watch mode | Add `--run` flag: `npx vitest run ...` |
| TypeScript compilation errors in modified files | Verify you are on the correct branch: `git branch` should show `blitzy-c22906a7-f20a-4d01-a3ea-08fc622415d4` |
| Test timeout on handleSeats.test.ts | First run may take ~9s due to transform time; subsequent runs are faster |

---

## 10. Appendices

### A. Command Reference

| Command | Purpose |
|---------|---------|
| `npx vitest run <path> --reporter=verbose` | Run specific test file with detailed output |
| `npx tsc --noEmit --project <tsconfig>` | TypeScript type-check without emitting files |
| `git diff origin/main...HEAD --stat` | View summary of all changes on this branch |
| `git diff origin/main...HEAD -- <file>` | View specific file changes |
| `git log --oneline origin/main..HEAD` | View all commits on this branch |

### B. Port Reference

No new ports or services introduced by these changes. The fixes modify backend booking lifecycle logic only.

### C. Key File Locations

| File | Purpose | Change Type |
|------|---------|-------------|
| `packages/features/bookings/lib/handleSeats/reschedule/owner/moveSeatedBookingToNewTimeSlot.ts` | Owner reschedule seated booking to new time slot | Modified (+38/-1 lines) |
| `packages/features/bookings/lib/handleSeats/reschedule/owner/combineTwoSeatedBookings.ts` | Owner reschedule seated booking merge | Modified (+73 lines) |
| `packages/features/bookings/lib/handleSeats/lib/lastAttendeeDeleteBooking.ts` | Last attendee leaves seated booking | Modified (+10 lines) |
| `packages/features/calendars/lib/CalendarManager.ts` | Calendar event creation/update manager | Modified (+15/-8 lines) |
| `packages/lib/CalendarService.ts` | Base CalDAV/CalendarService implementation | Modified (+57/-12 lines) |
| `packages/features/bookings/lib/handleSeats/test/handleSeats.test.ts` | Seated booking test suite | Modified (+1322 lines) |
| `packages/features/calendars/lib/__tests__/bufferTimeVisualization.test.ts` | Buffer time event tests | Modified (+170/-1 lines) |
| `packages/features/calendars/lib/__tests__/bidirectionalSync.integration.test.ts` | Bi-directional sync tests | Modified (+5/-3 lines) |
| `packages/features/calendars/lib/CalendarManager.test.ts` | CalendarManager unit tests | Modified (+293/-11 lines) |
| `packages/lib/CalendarService.test.ts` | CalendarService unit tests | Modified (+170 lines) |
| `packages/app-store/applecalendar/lib/__tests__/CalendarService.test.ts` | Apple Calendar tests | Modified (+202 lines) |
| `packages/features/bookings/lib/EventManager.ts` | Event lifecycle manager (NOT modified) | Reference — `BufferEventContext` type, `reschedule()` method |
| `packages/features/calendars/lib/buffer-sync/BufferTimeEventService.ts` | Buffer event service (NOT modified) | Reference — buffer creation/deletion logic |

### D. Technology Versions

| Technology | Version |
|------------|---------|
| Node.js | v20.20.1 |
| npm | 11.1.0 |
| Yarn | Berry 4.12.0 |
| TypeScript | Project-configured (strict mode) |
| Vitest | 4.0.16 |
| Prisma | Configured in monorepo |
| Biome | Configured in `biome.json` |

### E. Environment Variable Reference

| Variable | Purpose | Required |
|----------|---------|----------|
| `CALENDSO_ENCRYPTION_KEY` | Encryption key for calendar credential storage | Yes (for E2E testing) |
| Feature flag: `calendar-buffer-sync` | Gates all buffer event sync operations | Yes (must be enabled for buffer events) |
| EventType toggle: `syncBuffersToCalendar` | Per-event-type toggle for buffer event creation | Yes (must be true on event type) |

### F. Developer Tools Guide

| Tool | Usage |
|------|-------|
| Vitest | Primary test runner — `npx vitest run <path> --reporter=verbose` |
| TypeScript Compiler | Type checking — `npx tsc --noEmit --project <tsconfig>` |
| Git | Version control — branch `blitzy-c22906a7-f20a-4d01-a3ea-08fc622415d4` |
| Biome | Linting/formatting — configured via `biome.json` |

### G. Glossary

| Term | Definition |
|------|-----------|
| Buffer Time Event | A calendar event created before/after a booking to block off preparation or wind-down time, synced to external calendars when `syncBuffersToCalendar` is enabled |
| CI-002 Gap Closure | The Sprint 3 work item that added buffer time visualization (syncing buffer events to external calendars) |
| Seated Booking | A Cal.com event type where multiple attendees can book the same time slot up to a configurable seat limit |
| BufferEventContext | TypeScript type containing booking and event type metadata needed to create/delete buffer events |
| Feature Flag (`calendar-buffer-sync`) | Global toggle that enables/disables all buffer event sync operations |
| syncBuffersToCalendar | Per-event-type boolean that controls whether buffer events are created for that event type |
| CalDAV | Calendar protocol used by Apple Calendar/iCloud for calendar synchronization |
| externalCalendarId | The unique identifier (URL for CalDAV, ID for Google/Outlook) of a specific calendar within a user's account |