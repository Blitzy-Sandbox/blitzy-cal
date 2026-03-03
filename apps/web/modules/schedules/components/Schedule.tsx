import React from "react";
import type { Control, FieldValues } from "react-hook-form";

import {
  ScheduleComponent,
  type FieldPathByValue,
  type ScheduleLabelsType,
} from "@calcom/features/schedules/components/ScheduleComponent";
import useMeQuery from "@calcom/trpc/react/hooks/useMeQuery";
import type { TimeRange } from "@calcom/types/schedule";

/**
 * Lightweight adapter that bridges react-hook-form's {@link Control} with the shared
 * {@link ScheduleComponent} from `@calcom/features`. Resolves the authenticated viewer's
 * preferred time format (12-hour or 24-hour) via {@link useMeQuery} and forwards it
 * alongside all remaining props to the underlying schedule grid.
 *
 * @typeParam TFieldValues - The react-hook-form field values shape for the parent form.
 * @typeParam TPath - A type-safe field path constrained to entries whose value is
 *   `TimeRange[][]`, enforced by {@link FieldPathByValue}. This guarantees that the
 *   `name` prop only accepts paths pointing to weekly time-range matrices.
 *
 * @remarks
 * - **Time format resolution**: `useMeQuery()` fetches the current user's profile data.
 *   The `timeFormat` field is extracted and passed as `userTimeFormat` to
 *   `ScheduleComponent`. When `query.data` is `undefined` (loading or error state),
 *   the fallback `{ timeFormat: null }` is used, which lets `ScheduleComponent` apply
 *   its default 24-hour display.
 * - **Prop forwarding**: `userTimeFormat` from the query is set first, then `{...props}`
 *   is spread. Because JSX spread ordering resolves left-to-right, a caller-supplied
 *   `userTimeFormat` prop will override the query-derived value — allowing explicit
 *   overrides while defaulting to the authenticated user's preference.
 */
const Schedule = <
  TFieldValues extends FieldValues,
  TPath extends FieldPathByValue<TFieldValues, TimeRange[][]>,
>(props: {
  name: TPath;
  control: Control<TFieldValues>;
  weekStart?: number;
  disabled?: boolean;
  labels?: ScheduleLabelsType;
  userTimeFormat?: number | null;
}) => {
  const query = useMeQuery();
  const { timeFormat } = query.data || { timeFormat: null };

  return <ScheduleComponent userTimeFormat={timeFormat} {...props} />;
};

export default Schedule;
