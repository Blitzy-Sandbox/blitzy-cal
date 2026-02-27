import { useState } from "react";
import { useForm } from "react-hook-form";

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { BookerStoreProvider } from "@calcom/features/bookings/Booker/BookerStoreProvider";
import { Dialog } from "@calcom/features/components/controlled-dialog";
import { yyyymmdd } from "@calcom/lib/dayjs";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import type { WorkingHours } from "@calcom/types/schedule";
import cs from "@calcom/ui/classNames";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogHeader, DialogTrigger, DialogClose } from "@calcom/ui/components/dialog";
import { Switch } from "@calcom/ui/components/form";
import { Form } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";

import DatePicker from "@calcom/features/calendars/components/DatePicker";
import type { TimeRange } from "./ScheduleComponent";
import { DayRanges } from "./ScheduleComponent";

/**
 * Internal form component for date-specific schedule override editing.
 *
 * Manages three pieces of local state:
 * - `browsingDate` — calendar navigation position (controlled by onMonthChange)
 * - `selectedDates` — currently selected dates (multi-select in create mode, single in edit mode)
 * - `datesUnavailable` — whether selected dates should be marked as fully unavailable
 *
 * The form derives default time ranges from the user's working hours for the
 * selected day-of-week, falling back to 9:00–17:00 (540–1020 minutes from
 * midnight UTC) when no working hours match. Uses `react-hook-form` in controlled
 * mode via the `values` option so the form re-syncs when the selected date or
 * editing value changes.
 *
 * Submission follows three paths:
 * 1. **isDryRun** — clears selection without emitting changes (used for testing)
 * 2. **datesUnavailable** — emits zero-length ranges (`start === end` at midnight
 *    UTC) that downstream consumers (`DateOverrideList`, `buildDateRanges`)
 *    interpret as "fully unavailable"
 * 3. **Available** — maps `selectedDates × form.range`, building UTC dates with
 *    hour/minute values from the form inputs via `dayjs.utc(true)` (keepLocal)
 *
 * Layout: two-column responsive dialog content:
 * - Left column — `DialogHeader` + `BookerStoreProvider`-wrapped `DatePicker`
 * - Right column — `DayRanges` editor (or unavailable message), `Switch` toggle,
 *   submit `Button` with toast feedback, and `DialogClose`
 *
 * @internal Not exported — used exclusively by {@link DateOverrideInputDialog}.
 */
const DateOverrideForm = ({
  value,
  workingHours,
  excludedDates,
  onChange,
  userTimeFormat,
  weekStart,
  isDryRun = false,
}: {
  workingHours?: WorkingHours[];
  onChange: (newValue: TimeRange[]) => void;
  excludedDates: string[];
  value?: TimeRange[];
  onClose?: () => void;
  userTimeFormat: number | null;
  weekStart: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  isDryRun?: boolean;
}) => {
  const [browsingDate, setBrowsingDate] = useState<Dayjs>();
  const { t, i18n, isLocaleReady } = useLocale();
  const [datesUnavailable, setDatesUnavailable] = useState(
    value &&
      value[0].start.getUTCHours() === 0 &&
      value[0].start.getUTCMinutes() === 0 &&
      value[0].end.getUTCHours() === 0 &&
      value[0].end.getUTCMinutes() === 0
  );

  const [selectedDates, setSelectedDates] = useState<Dayjs[]>(value ? [dayjs.utc(value[0].start)] : []);

  /**
   * Handles date selection/deselection in the calendar picker.
   *
   * - **Toggle**: clicking an already-selected date deselects it (compared via `yyyymmdd`).
   * - **Create mode** (no existing `value`): allows multi-date selection by appending.
   * - **Edit mode** (`value` exists): restricts to single-date selection, replacing the
   *   current selection entirely.
   */
  const onDateChange = (newDate: Dayjs) => {
    // If clicking on a selected date unselect it
    if (selectedDates.some((date) => yyyymmdd(date) === yyyymmdd(newDate))) {
      setSelectedDates(selectedDates.filter((date) => yyyymmdd(date) !== yyyymmdd(newDate)));
      return;
    }

    // If it's not editing we can allow multiple select
    if (!value) {
      setSelectedDates((prev) => [...prev, newDate]);
      return;
    }

    setSelectedDates([newDate]);
  };

  /**
   * Derives default time ranges from the user's configured working hours.
   *
   * Scans the `workingHours` array for entries whose `days` include the day-of-week
   * of the first selected date. For each match, constructs a UTC `TimeRange` using
   * `dayjs.utc().startOf("day").add(minutes, "minute")`.
   *
   * Falls back to 9:00–17:00 (540–1020 minutes from midnight UTC) when no working
   * hours match the selected day, since `DayRanges` does not support an empty state.
   */
  const defaultRanges = (workingHours || []).reduce((dayRanges: TimeRange[], workingHour) => {
    if (selectedDates[0] && workingHour.days.includes(selectedDates[0].day())) {
      dayRanges.push({
        start: dayjs.utc().startOf("day").add(workingHour.startTime, "minute").toDate(),
        end: dayjs.utc().startOf("day").add(workingHour.endTime, "minute").toDate(),
      });
    }
    return dayRanges;
  }, []);
  // DayRanges does not support empty state, add 9-5 as a default
  if (!defaultRanges.length) {
    defaultRanges.push({
      start: dayjs.utc().startOf("day").add(540, "minute").toDate(),
      end: dayjs.utc().startOf("day").add(1020, "minute").toDate(),
    });
  }

  // React Hook Form in controlled mode: the `values` option re-syncs whenever
  // the editing `value` or `defaultRanges` change. When editing an existing override
  // whose start !== end (i.e. not "unavailable"), the ranges are reconstructed via
  // `dayjs.utc().hour().minute().second(0).format()` → `new Date()` to produce
  // clean UTC ISO timestamps. Otherwise, falls back to `defaultRanges`.
  const form = useForm({
    values: {
      range:
        value && value[0].start.valueOf() !== value[0].end.valueOf()
          ? value.map((range) => ({
              start: new Date(
                dayjs
                  .utc()
                  .hour(range.start.getUTCHours())
                  .minute(range.start.getUTCMinutes())
                  .second(0)
                  .format()
              ),
              end: new Date(
                dayjs.utc().hour(range.end.getUTCHours()).minute(range.end.getUTCMinutes()).second(0).format()
              ),
            }))
          : defaultRanges,
    },
  });

  return (
    <Form
      form={form}
      handleSubmit={(values) => {
        const datesInRanges: TimeRange[] = [];

        if (selectedDates.length === 0) return;

        if (isDryRun) {
          setSelectedDates([]);
          return;
        }

        if (datesUnavailable) {
          // Unavailable path: emit zero-length ranges (start === end at midnight UTC).
          // Downstream consumers (DateOverrideList, buildDateRanges) interpret these
          // as "fully unavailable for the entire day".
          selectedDates.map((date) => {
            datesInRanges.push({
              start: date.utc(true).startOf("day").toDate(),
              end: date.utc(true).startOf("day").toDate(),
            });
          });
          onChange(datesInRanges);
        } else {
          // Available path: for each selected date × each form time range, construct
          // UTC dates by setting hour/minute from the form values onto the selected
          // date, then calling `.utc(true)` (keepLocal) to preserve the local values
          // as UTC coordinates. This ensures timezone-correct persistence.
          selectedDates.map((date) => {
            values.range.map((item) => {
              datesInRanges.push({
                start: date
                  .hour(item.start.getUTCHours())
                  .minute(item.start.getUTCMinutes())
                  .utc(true)
                  .toDate(),
                end: date.hour(item.end.getUTCHours()).minute(item.end.getUTCMinutes()).utc(true).toDate(),
              });
            });
          });
          onChange(datesInRanges);
        }

        setSelectedDates([]);
      }}
      className="p-6 sm:flex sm:p-0 xl:flex-row">
      <div className="sm:border-subtle w-full sm:border-r sm:p-4 sm:pr-6 md:p-8">
        <DialogHeader title={t("date_overrides_dialog_title")} />
        <BookerStoreProvider>
          <DatePicker
            excludedDates={excludedDates}
            weekStart={weekStart}
            selected={selectedDates}
            onChange={(day) => {
              if (day) onDateChange(day);
            }}
            onMonthChange={(newMonth) => {
              setBrowsingDate(newMonth);
            }}
            browsingDate={browsingDate}
            locale={isLocaleReady ? i18n.language : "en"}
          />
        </BookerStoreProvider>
      </div>
      <div className="relative mt-8 flex w-full flex-col sm:mt-0 sm:p-4 md:p-8">
        {selectedDates[0] ? (
          <>
            <div className="mb-4 grow stack-y-4">
              <p className="text-medium text-emphasis text-sm">{t("date_overrides_dialog_which_hours")}</p>
              <div>
                {datesUnavailable ? (
                  <p className="text-subtle border-default rounded border p-2 text-sm">
                    {t("date_overrides_unavailable")}
                  </p>
                ) : (
                  <DayRanges name="range" userTimeFormat={userTimeFormat} />
                )}
              </div>
              <Switch
                label={t("date_overrides_mark_all_day_unavailable_one")}
                checked={datesUnavailable}
                onCheckedChange={setDatesUnavailable}
                data-testid="date-override-mark-unavailable"
              />
            </div>
            <div className="mt-4 flex flex-row-reverse sm:mt-0">
              <Button
                className="ml-2"
                color="primary"
                type="submit"
                onClick={() => {
                  showToast(t("date_successfully_added"), "success", 500);
                }}
                disabled={selectedDates.length === 0}
                data-testid="add-override-submit-btn">
                {value ? t("date_overrides_update_btn") : t("date_overrides_save_btn")}
              </Button>
              <DialogClose />
            </div>
          </>
        ) : (
          <div className="bottom-7 right-8 flex flex-row-reverse sm:absolute">
            <DialogClose />
          </div>
        )}
      </div>
    </Form>
  );
};

/**
 * Public dialog component for creating or editing date-specific schedule overrides.
 *
 * Manages the `Dialog` open/close state and renders:
 * - A `DialogTrigger` wrapping the caller-provided `Trigger` element
 * - A `DialogContent` containing the internal {@link DateOverrideForm}
 *
 * Props are split into dialog-specific props (`Trigger`, `excludedDates`,
 * `userTimeFormat`, `weekStart`, `className`) and pass-through props
 * (`workingHours`, `onChange`, `value`, `isDryRun`) forwarded directly
 * to `DateOverrideForm`. The `className` prop is merged with the base
 * `"p-0"` class via the `cs` (classNames) utility.
 *
 * Consumed by `DateOverrideList` for inline editing and by schedule editor
 * pages for creating new date overrides.
 */
const DateOverrideInputDialog = ({
  Trigger,
  excludedDates = [],
  userTimeFormat,
  weekStart = 0,
  className,
  ...passThroughProps
}: {
  workingHours: WorkingHours[];
  excludedDates?: string[];
  Trigger: React.ReactNode;
  onChange: (newValue: TimeRange[]) => void;
  value?: TimeRange[];
  userTimeFormat: number | null;
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  isDryRun?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{Trigger}</DialogTrigger>

      <DialogContent enableOverflow={true} size="md" className={cs("p-0", className)}>
        <DateOverrideForm
          excludedDates={excludedDates}
          weekStart={weekStart}
          {...passThroughProps}
          onClose={() => setOpen(false)}
          userTimeFormat={userTimeFormat}
        />
      </DialogContent>
    </Dialog>
  );
};

export default DateOverrideInputDialog;
