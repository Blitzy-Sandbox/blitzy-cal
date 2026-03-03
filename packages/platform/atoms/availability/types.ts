/**
 * Platform Availability Atom — Type Contract Surface
 *
 * Defines the shared TypeScript type contracts consumed by the Cal.com platform
 * availability atom (`AvailabilitySettings`, `AvailabilitySettingsPlatformWrapper`)
 * and all external consumers importing from `@calcom/atoms/availability`.
 *
 * These types form part of the Platform SDK public API contract. Any breaking
 * change to field names, types, optionality, or export names is prohibited
 * under backward-compatibility rule 0.7.4.
 */
import type { Schedule as ScheduleType, TimeRange } from "@calcom/types/schedule";

/**
 * Represents a single persisted availability record corresponding to the
 * Prisma `Availability` model.
 *
 * Field mapping:
 * - `id` — Auto-increment primary key.
 * - `userId` — Optional foreign key to the `User` model (`null` when
 *   the availability is tied to an event type rather than a specific user).
 * - `eventTypeId` — Optional foreign key to the `EventType` model.
 * - `days` — Array of weekday indexes (0 = Sunday … 6 = Saturday) on which
 *   this availability window recurs.
 * - `startTime` — Start of the availability window. Typed as `string` (not
 *   `Date`) because the platform atoms use string representation for
 *   react-hook-form binding, whereas the Prisma model stores this as
 *   `DateTime @db.Time`. This intentional mismatch supports form
 *   serialization in the atoms layer.
 * - `endTime` — End of the availability window as a `Date`, matching the
 *   Prisma `DateTime @db.Time` column directly.
 * - `date` — When non-null, indicates a single-date override rather than a
 *   recurring availability entry. `null` for standard recurring schedules.
 * - `scheduleId` — Optional foreign key to the parent `Schedule` model.
 */
export type Availability = {
  id: number;
  userId: number | null;
  eventTypeId: number | null;
  days: number[];
  startTime: string;
  endTime: Date;
  date: Date | null;
  scheduleId: number | null;
};

/**
 * Constrains weekday label rendering to either `"short"` (e.g., "Mon") or
 * `"long"` (e.g., "Monday") formats for locale-aware display in the
 * schedule UI components.
 */
export type WeekdayFormat = "short" | "long";

/**
 * Compound form shape managed by the `AvailabilitySettings` component via
 * react-hook-form. Each field corresponds to an editable aspect of a user's
 * availability schedule.
 *
 * - `availability` — A `number[][]` matrix representing toggled hour blocks
 *   per weekday, used by the schedule grid to track enabled/disabled states.
 * - `name` — Human-readable schedule name displayed in the schedule list.
 * - `schedule` — Uses `Schedule` from `@calcom/types/schedule` (aliased as
 *   `ScheduleType`), which is `TimeRange[][]` — a 7-element array (one per
 *   weekday) of time range arrays defining working hours.
 * - `dateOverrides` — Entries containing `ranges` arrays typed as
 *   `TimeRange[]` from `@calcom/types/schedule`, ensuring each override
 *   range matches the shared schedule range definition
 *   `{ userId?: number | null; start: Date; end: Date }`.
 * - `timeZone` — IANA timezone string (e.g., "America/New_York") for the
 *   schedule. All slot calculations normalize to UTC using this value.
 * - `isDefault` — When `true`, marks this schedule as the user's default
 *   configuration; when `false`, indicates a per-event-type override.
 */
export type AvailabilityFormValues = {
  availability: number[][];
  name: string;
  schedule: ScheduleType;
  dateOverrides: { ranges: TimeRange[] }[];
  timeZone: string;
  isDefault: boolean;
};

/**
 * Optional className overrides for host applications embedding the schedule
 * UI components. Allows custom styling of the schedule root container,
 * individual day tiles, day ranges wrapper, time range fields, the
 * label/switch container, and the schedule container.
 *
 * The nested `timePicker` object provides granular styling hooks for the
 * time picker sub-component:
 * - `container` — Outer wrapper of the time picker.
 * - `valueContainer` — Wrapper around the displayed selected value.
 * - `value` — The individual rendered value element.
 * - `input` — The text input within the picker.
 * - `dropdown` — The options dropdown panel.
 */
export type scheduleClassNames = {
  schedule?: string;
  scheduleDay?: string;
  dayRanges?: string;
  timeRangeField?: string;
  labelAndSwitchContainer?: string;
  scheduleContainer?: string;
  timePicker?: {
    container?: string;
    valueContainer?: string;
    value?: string;
    input?: string;
    dropdown?: string;
  };
};

/**
 * Result returned by the `validateForm` imperative method on
 * {@link AvailabilitySettingsFormRef}.
 *
 * - `isValid` — `true` when all form fields pass validation; `false`
 *   otherwise.
 * - `errors` — A string-keyed record that may contain field-path,
 *   range-level, or section-level diagnostic information describing
 *   validation failures.
 */
export type AvailabilityFormValidationResult = {
  isValid: boolean;
  errors: Record<string, unknown>;
};

/**
 * Optional lifecycle hooks passed to `handleFormSubmit` on
 * {@link AvailabilitySettingsFormRef}. Allows parent components to react
 * to form submission outcomes.
 *
 * - `onSuccess` — Fires after the form submission completes successfully.
 * - `onError` — Surfaces any `Error` instance encountered during
 *   submission, enabling parent component error handling or display.
 */
export interface AvailabilitySettingsFormCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Imperative API surface exposed by the `AvailabilitySettings` component
 * via React `forwardRef`. Allows parent components to programmatically
 * trigger form validation and submission without embedding form controls
 * directly.
 *
 * - `validateForm` — Returns a `Promise` resolving to an
 *   {@link AvailabilityFormValidationResult} indicating whether all fields
 *   pass validation along with any diagnostic errors.
 * - `handleFormSubmit` — Accepts optional
 *   {@link AvailabilitySettingsFormCallbacks} for lifecycle notification
 *   (success/error) after the submission attempt.
 *
 * Used by platform wrappers such as `AvailabilitySettingsPlatformWrapper`
 * and consumer pages (e.g., the example app's
 * `/availability/[scheduleId]` page).
 */
export interface AvailabilitySettingsFormRef {
  validateForm: () => Promise<AvailabilityFormValidationResult>;
  handleFormSubmit: (callbacks?: AvailabilitySettingsFormCallbacks) => void;
}
