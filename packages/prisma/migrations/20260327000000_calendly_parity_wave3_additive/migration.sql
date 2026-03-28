-- ============================================================================
-- Calendly Parity Wave 3 Additive Migration
-- Sprints 4 (Webhooks), 7 (Admin/Teams), 8 (Workflows)
-- All changes are additive-only: new columns, new enum values, new indexes,
-- new FK constraints. No removals, renames, or type changes.
-- ============================================================================

-- ============================================================================
-- Section 1: Sprint 4 — Webhooks (WH-005)
-- ============================================================================

-- AlterEnum: Add attendee-initiated reschedule webhook trigger
ALTER TYPE "public"."WebhookTriggerEvents" ADD VALUE 'BOOKING_RESCHEDULED_BY_ATTENDEE';

-- AlterTable: Add optional payload version for per-subscription version negotiation
ALTER TABLE "Webhook" ADD COLUMN "payloadVersion" TEXT;

-- ============================================================================
-- Section 2: Sprint 7 — Admin/Teams (AG-001, AG-004)
-- ============================================================================

-- AlterTable: Add invitation tracking columns for Calendly member invitation parity
ALTER TABLE "Membership" ADD COLUMN "invitedByUserId" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "invitedAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "declinedAt" TIMESTAMP(3);

-- CreateIndex: Index for invitation sender lookups
CREATE INDEX "Membership_invitedByUserId_idx" ON "Membership"("invitedByUserId");

-- AddForeignKey: Link invitation sender to User
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Add default scheduling type for team event routing
ALTER TABLE "Team" ADD COLUMN "schedulingDefault" TEXT;

-- ============================================================================
-- Section 3: Sprint 8 — Workflows (NF-003, NF-004)
-- ============================================================================

-- AlterEnum: Add workflow trigger for attendee-initiated reschedules
ALTER TYPE "public"."WorkflowTriggerEvents" ADD VALUE 'AFTER_BOOKING_RESCHEDULED_BY_ATTENDEE';

-- AlterEnum: Add in-app notification workflow action
ALTER TYPE "public"."WorkflowActions" ADD VALUE 'IN_APP_NOTIFICATION';

-- AlterTable: Add optional JSON metadata for workflow step configuration
ALTER TABLE "WorkflowStep" ADD COLUMN "metadata" JSONB;

-- AlterTable: Add enable/disable toggle for workflows
ALTER TABLE "Workflow" ADD COLUMN "isEnabled" BOOLEAN NOT NULL DEFAULT true;
