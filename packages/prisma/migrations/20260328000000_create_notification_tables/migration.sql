-- ============================================================================
-- Create Notification Tables for NF-004 (In-App Notifications & Activity Feed)
-- These tables were defined in the Prisma schema but missing from migrations.
-- All changes are additive-only: new tables, indexes, and FK constraints.
-- ============================================================================

-- CreateTable: ActivityFeedItem — stores user activity feed entries for Calendly activity feed parity
CREATE TABLE "ActivityFeedItem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "activityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "resourceId" TEXT,
    "resourceType" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityFeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InAppNotification — stores persistent in-app notifications for Calendly notification lifecycle parity
CREATE TABLE "InAppNotification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNREAD',
    "url" TEXT,
    "icon" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ActivityFeedItem indexes for efficient user activity queries
CREATE INDEX "ActivityFeedItem_userId_idx" ON "ActivityFeedItem"("userId");
CREATE INDEX "ActivityFeedItem_userId_activityType_idx" ON "ActivityFeedItem"("userId", "activityType");
CREATE INDEX "ActivityFeedItem_userId_createdAt_idx" ON "ActivityFeedItem"("userId", "createdAt");

-- CreateIndex: InAppNotification indexes for efficient notification queries
CREATE INDEX "InAppNotification_userId_idx" ON "InAppNotification"("userId");
CREATE INDEX "InAppNotification_userId_status_idx" ON "InAppNotification"("userId", "status");
CREATE INDEX "InAppNotification_userId_createdAt_idx" ON "InAppNotification"("userId", "createdAt");

-- AddForeignKey: Link ActivityFeedItem to User with CASCADE delete
ALTER TABLE "ActivityFeedItem" ADD CONSTRAINT "ActivityFeedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Link InAppNotification to User with CASCADE delete
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
