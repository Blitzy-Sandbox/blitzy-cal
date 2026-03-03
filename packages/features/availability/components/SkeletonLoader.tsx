"use client";

/**
 * Skeleton placeholder components for the availability loading states.
 *
 * Provides two public skeletons consumed across the availability UI:
 * - `SkeletonLoader` (default export) — full availability-list placeholder with three rows.
 * - `SelectSkeletonLoader` (named export) — single-row dropdown/select placeholder.
 *
 * Both components rely exclusively on `@calcom/ui` design primitives
 * (`SkeletonText`, `Button`, `classNames`) to stay consistent with the
 * Cal.com design system.
 */

import classNames from "@calcom/ui/classNames";
import { Button } from "@calcom/ui/components/button";
import { SkeletonText } from "@calcom/ui/components/skeleton";

/**
 * Primary skeleton loader for the availability list page.
 *
 * Renders a pulsing `<ul>` containing three {@link SkeletonItem} rows that
 * approximate the visual weight of a fully loaded availability list, preventing
 * layout shift while data is fetched.
 *
 * @example
 * ```tsx
 * import SkeletonLoader from "@calcom/features/availability/components/SkeletonLoader";
 *
 * function AvailabilityPage() {
 *   if (isLoading) return <SkeletonLoader />;
 *   return <AvailabilityList />;
 * }
 * ```
 */
function SkeletonLoader() {
  return (
    <ul className="divide-subtle border-subtle bg-default animate-pulse divide-y rounded-md border sm:mx-0 sm:overflow-hidden">
      <SkeletonItem />
      <SkeletonItem />
      <SkeletonItem />
    </ul>
  );
}

export default SkeletonLoader;

/**
 * A single skeleton row representing one availability schedule entry.
 *
 * Renders a flex layout containing:
 * - Three `SkeletonText` bars of varying widths (headline, subtitle, metadata)
 *   to simulate the schedule name, timezone, and working-hours summary.
 * - A disabled ellipsis `Button` matching the real row's action affordance.
 *
 * @internal Not exported — used exclusively by {@link SkeletonLoader}.
 */
function SkeletonItem() {
  return (
    <li>
      <div className="flex items-center justify-between py-5  ltr:pl-4 rtl:pr-4 sm:ltr:pl-0 sm:rtl:pr-0">
        <div className="items-between flex w-full flex-col justify-center sm:px-6">
          <SkeletonText className="my-1 h-4 w-32" />
          <SkeletonText className="my-1 h-2 w-24" />
          <SkeletonText className="my-1 h-2 w-40" />
        </div>
        <Button
          className="mx-5"
          type="button"
          variant="icon"
          color="secondary"
          StartIcon="ellipsis"
          disabled
        />
      </div>
    </li>
  );
}

/**
 * Compact skeleton placeholder for a schedule dropdown or select control.
 *
 * Displays a bordered row with a wide `SkeletonText` bar (label) and a small
 * square bar (status indicator), matching the resting dimensions of the
 * schedule-select widget used in the event-type availability tab.
 *
 * @param props.className - Optional additional CSS class names merged via
 *   `classNames` onto the root `<li>` element.
 *
 * @example
 * ```tsx
 * import { SelectSkeletonLoader } from "@calcom/features/availability/components/SkeletonLoader";
 *
 * <SelectSkeletonLoader className="mt-2" />
 * ```
 */
export const SelectSkeletonLoader = ({ className }: { className?: string }) => {
  return (
    <li
      className={classNames(
        "border-subtle group flex w-full items-center justify-between rounded-sm border px-[10px] py-3",
        className
      )}>
      <div className="grow truncate text-sm">
        <div className="flex justify-between">
          <SkeletonText className="h-4 w-32" />
          <SkeletonText className="h-4 w-4" />
        </div>
      </div>
    </li>
  );
};
