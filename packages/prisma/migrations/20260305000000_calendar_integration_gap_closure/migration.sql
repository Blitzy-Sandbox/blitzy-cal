-- AlterTable: Add buffer sync toggle to EventType
ALTER TABLE "EventType" ADD COLUMN "syncBuffersToCalendar" BOOLEAN;

-- AlterTable: Add cancellation sync toggle to Credential
ALTER TABLE "Credential" ADD COLUMN "externalCancellationSyncEnabled" BOOLEAN;

-- FeatureFlags: Calendar integration gap closure feature gates
INSERT INTO "Feature" (slug, enabled, description, "type")
VALUES ('calendar-cancellation-sync', false, 'Enable calendar-driven cancellation sync from external calendars', 'OPERATIONAL')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "Feature" (slug, enabled, description, "type")
VALUES ('calendar-buffer-sync', false, 'Enable buffer time visualization in external calendars', 'OPERATIONAL')
ON CONFLICT (slug) DO NOTHING;
