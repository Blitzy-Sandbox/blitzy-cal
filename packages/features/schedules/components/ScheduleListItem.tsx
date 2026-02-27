"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { availabilityAsString } from "@calcom/lib/availability";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { sortAvailabilityStrings } from "@calcom/lib/weekstart";
import { Dialog } from "@calcom/features/components/controlled-dialog";
import { Badge } from "@calcom/ui/components/badge";
import { Button } from "@calcom/ui/components/button";
import {
  Dropdown,
  DropdownItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@calcom/ui/components/dropdown";
import { ConfirmationDialogContent } from "@calcom/ui/components/dialog";
import { showToast } from "@calcom/ui/components/toast";
import { GlobeIcon } from "@coss/ui/icons";

/**
 * Local projection of the Prisma `Schedule` model with nested `Availability` records.
 *
 * Maps to `packages/prisma/schema.prisma` models:
 * - `Schedule` — top-level fields (`id`, `name`, `timeZone`)
 * - `Availability` — nested one-to-many relation providing weekly working-hour entries
 *
 * @property id          - Unique schedule identifier (Schedule.id)
 * @property name        - User-defined schedule label (Schedule.name)
 * @property isDefault   - Whether this is the user's default schedule
 * @property timeZone    - Optional IANA timezone override stored on the schedule; when absent
 *                         the component falls back to `displayOptions.timeZone`
 * @property availability - Array of weekly working-hour entries (Availability model).
 *                          Each entry specifies active `days` (0=Sun … 6=Sat), a
 *                          `startTime`/`endTime` window, and an optional `date` for
 *                          date-specific overrides.
 */
interface Schedule {
  id: number;
  name: string;
  isDefault: boolean;
  timeZone?: string | null;
  availability: {
    id: number;
    userId: number | null;
    eventTypeId: number | null;
    days: number[];
    startTime: Date;
    endTime: Date;
    date: Date | null;
    scheduleId: number | null;
  }[];
}

/**
 * Renders a single schedule row in the availability master list (`/availability`).
 *
 * **Rendering pipeline:**
 * 1. Displays the schedule name as a navigable link (`redirectUrl`) with optional "default" badge.
 * 2. Builds a localized availability summary by:
 *    - Filtering entries to those with at least one active day
 *    - Converting each entry via `availabilityAsString` (locale + 12/24-hour format)
 *    - Sorting the resulting strings according to the user's configured week-start day
 * 3. Conditionally renders a timezone badge (`GlobeIcon` + IANA zone) when the schedule or
 *    display options specify a timezone.
 * 4. Provides a dropdown overflow menu with three actions:
 *    - **Set as default** — visible only for non-default schedules; calls `updateDefault`
 *    - **Duplicate** — always visible; calls `duplicateFunction`
 *    - **Delete** — guarded by `isDeletable`; when the last schedule would be removed a toast
 *      warning is shown instead of opening the confirmation dialog
 * 5. A `<Dialog>` + `<ConfirmationDialogContent variety="danger">` handles the destructive
 *    delete confirmation with `e.preventDefault()` to avoid form submission side-effects.
 *
 * @param schedule          - The schedule data to render (local `Schedule` projection)
 * @param deleteFunction    - Callback invoked after the user confirms deletion
 * @param displayOptions    - Optional timezone, hour-format, and week-start display preferences
 * @param updateDefault     - Callback to promote a schedule to the user's default
 * @param isDeletable       - When `false`, the delete action shows a toast instead of opening
 *                            the confirmation dialog (prevents deleting the last schedule)
 * @param duplicateFunction - Callback to duplicate the schedule
 * @param redirectUrl       - URL the schedule name links to (typically `/availability/[id]`)
 */
export function ScheduleListItem({
  schedule,
  deleteFunction,
  displayOptions,
  updateDefault,
  isDeletable,
  duplicateFunction,
  redirectUrl,
}: {
  schedule: Schedule;
  deleteFunction: ({ scheduleId }: { scheduleId: number }) => void;
  displayOptions?: {
    timeZone?: string;
    hour12?: boolean;
    weekStart?: string;
  };
  isDeletable: boolean;
  updateDefault: ({ scheduleId, isDefault }: { scheduleId: number; isDefault: boolean }) => void;
  duplicateFunction: ({ scheduleId }: { scheduleId: number }) => void;
  redirectUrl: string;
}) {
  const { t, i18n } = useLocale();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Inferred element type from the Schedule interface's availability array.
  // Used to strongly type the filter/map callbacks in the availability summary pipeline.
  type AvailabilityItem = (typeof schedule.availability)[number];

  return (
    <li key={schedule.id}>
      <div className="hover:bg-cal-muted flex items-center justify-between px-3 py-5 transition sm:px-4">
        <Link href={redirectUrl} className="grow truncate text-sm" title={schedule.name}>
          <div className="space-x-2 rtl:space-x-reverse">
            <span className="text-emphasis truncate font-medium">{schedule.name}</span>
            {schedule.isDefault && (
              <Badge variant="gray" className="text-xs">
                {t("default")}
              </Badge>
            )}
          </div>
          <p className="text-subtle mt-1">
            {schedule.availability
              .filter((availability: AvailabilityItem) => !!availability.days.length)
              .map((availability: AvailabilityItem) =>
                availabilityAsString(availability, {
                  locale: i18n.language,
                  hour12: displayOptions?.hour12,
                })
              )
              // sort the availability strings as per user's weekstart (settings)
              .sort(sortAvailabilityStrings(i18n.language, displayOptions?.weekStart))
              .map((availabilityString: string) => (
                <Fragment key={availabilityString}>
                  {availabilityString}
                  <br />
                </Fragment>
              ))}
            {(schedule.timeZone || displayOptions?.timeZone) && (
              <span className="my-1 flex items-center first-letter:text-xs">
                <GlobeIcon className="h-3.5 w-3.5" />
                &nbsp;{schedule.timeZone ?? displayOptions?.timeZone}
              </span>
            )}
          </p>
        </Link>
        <Dropdown>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="schedule-more"
              type="button"
              variant="icon"
              color="secondary"
              StartIcon="ellipsis"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {!schedule.isDefault && (
              <DropdownMenuItem className="min-w-40 focus:ring-muted">
                <DropdownItem
                  type="button"
                  StartIcon="star"
                  onClick={() => {
                    updateDefault({
                      scheduleId: schedule.id,
                      isDefault: true,
                    });
                  }}>
                  {t("set_as_default")}
                </DropdownItem>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="outline-none">
              <DropdownItem
                type="button"
                data-testid={`schedule-duplicate${schedule.id}`}
                StartIcon="copy"
                onClick={() => {
                  duplicateFunction({
                    scheduleId: schedule.id,
                  });
                }}>
                {t("duplicate")}
              </DropdownItem>
            </DropdownMenuItem>
            <DropdownMenuItem className="min-w-40 focus:ring-muted">
              <DropdownItem
                type="button"
                color="destructive"
                StartIcon="trash"
                data-testid="delete-schedule"
                className="rounded-t-none"
                onClick={() => {
                  if (!isDeletable) {
                    showToast(t("requires_at_least_one_schedule"), "error");
                  } else {
                    setIsDeleteDialogOpen(true);
                  }
                }}>
                {t("delete")}
              </DropdownItem>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </Dropdown>
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <ConfirmationDialogContent
            variety="danger"
            title={t("delete_schedule")}
            confirmBtnText={t("delete")}
            loadingText={t("delete")}
            onConfirm={(e) => {
              e.preventDefault();
              deleteFunction({
                scheduleId: schedule.id,
              });
            }}>
            {t("delete_schedule_description")}
          </ConfirmationDialogContent>
        </Dialog>
      </div>
    </li>
  );
}
