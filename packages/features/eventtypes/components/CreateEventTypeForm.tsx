import type { ReactNode } from "react";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { useIsPlatform } from "@calcom/atoms/hooks/useIsPlatform";
import { MAX_EVENT_DURATION_MINUTES, MIN_EVENT_DURATION_MINUTES } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { md } from "@calcom/lib/markdownIt";
import slugify from "@calcom/lib/slugify";
import turndown from "@calcom/lib/turndownService";
import { Editor } from "@calcom/ui/components/editor";
import { Form } from "@calcom/ui/components/form";
import { TextAreaField } from "@calcom/ui/components/form";
import { TextField } from "@calcom/ui/components/form";
import { Tooltip } from "@calcom/ui/components/tooltip";
import type { z } from "zod";
import { createEventTypeInput } from "@calcom/features/eventtypes/lib/types";

type CreateEventTypeFormValues = z.infer<typeof createEventTypeInput>;

/**
 * CreateEventTypeForm — Core event type creation form component.
 *
 * Handles common fields shared across ALL 6 scheduling paradigms:
 * - Title (with automatic slug generation via slugify)
 * - URL slug (with platform-aware formatting and managed-event placeholders)
 * - Description (markdown Editor for web, TextAreaField for platform)
 * - Duration (with MIN/MAX bounds enforcement)
 *
 * Paradigm-specific configuration:
 * - **1:1 (ET-001):** schedulingType = null (default). No special UI needed here.
 * - **Group (ET-002):** seatsPerTimeSlot is configured in settings after creation.
 * - **Round-Robin (ET-003):** SchedulingType.ROUND_ROBIN set by parent; host weights,
 *   priorities, and segment queries are configured in settings after creation.
 * - **Collective (ET-004):** SchedulingType.COLLECTIVE set by parent; host configuration
 *   is managed in settings after creation.
 * - **Managed:** isManagedEventType prop controls slug display,
 *   showing a username placeholder instead of the actual page slug.
 * - **Dynamic:** Not created through this form — uses getDefaultEvent with
 *   multi-user slug resolution instead.
 *
 * The schedulingType field is part of the form values (via createEventTypeInput Zod schema)
 * but is NOT rendered in this component — the parent/wrapper component sets it before submission.
 * The schema's .refine() rule enforces that team events (teamId present) must have a schedulingType.
 *
 * @see createEventTypeInput in schemas.ts for the Zod validation schema
 * @see EventLimitsTab for booking window configuration (ET-005)
 * @see bookingFieldsManager for custom fields / questions parity (ET-006)
 */
export default function CreateEventTypeForm({
  form,
  isManagedEventType,
  handleSubmit,
  pageSlug,
  isPending,
  urlPrefix,
  SubmitButton,
}: {
  form: UseFormReturn<CreateEventTypeFormValues>;
  isManagedEventType: boolean;
  handleSubmit: (values: CreateEventTypeFormValues) => void;
  pageSlug?: string;
  isPending: boolean;
  urlPrefix?: string;
  SubmitButton: (isPending: boolean) => ReactNode;
}) {
  const isPlatform = useIsPlatform();
  const { t } = useLocale();
  const [firstRender, setFirstRender] = useState(true);

  const { register } = form;

  // Form submission forwards all values — including schedulingType and teamId set by
  // the parent — to the handleSubmit callback. This ensures paradigm selection (1:1, RR,
  // collective, managed) is captured even though it is not rendered in this form.
  return (
    <Form
      form={form}
      handleSubmit={(values) => {
        handleSubmit(values);
      }}>
      <div className="mt-3 stack-y-6 pb-11">
        {/* Title field — shared across all 6 scheduling paradigms.
            Auto-populates the slug field via slugify until the user manually edits it. */}
        <TextField
          label={t("title")}
          placeholder={t("quick_chat")}
          data-testid="event-type-quick-chat"
          {...register("title")}
          onChange={(e) => {
            form.setValue("title", e?.target.value);
            if (form.formState.touchedFields["slug"] === undefined) {
              form.setValue("slug", slugify(e?.target.value));
            }
          }}
        />

        {/* URL/slug field — two layout variants based on urlPrefix length.
            For managed event types (isManagedEventType), displays a username placeholder
            instead of the actual page slug, with a clarification note explaining that
            team members will see their own username in the final URL.
            Platform consumers see a simple "Slug" label without the URL prefix. */}
        {urlPrefix && urlPrefix.length >= 21 ? (
          <div>
            <TextField
              label={isPlatform ? "Slug" : `${t("url")}: ${urlPrefix}`}
              required
              addOnLeading={
                !isPlatform ? (
                  <span className="max-w-24 md:max-w-56 inline-block overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                    {`/${!isManagedEventType ? pageSlug : t("username_placeholder")}/`}
                  </span>
                ) : undefined
              }
              containerClassName="[&>div]:gap-0"
              className="pl-0"
              {...register("slug")}
              onChange={(e) => {
                form.setValue("slug", slugify(e?.target.value), { shouldTouch: true });
              }}
            />

            {isManagedEventType && !isPlatform && (
              <p className="mt-2 text-sm text-gray-600">{t("managed_event_url_clarification")}</p>
            )}
          </div>
        ) : (
          <div>
            <TextField
              label={isPlatform ? "Slug" : t("url")}
              required
              addOnLeading={
                !isPlatform ? (
                  <Tooltip
                    content={`${urlPrefix}/${!isManagedEventType ? pageSlug : t("username_placeholder")}/`}>
                    <span className="max-w-24 md:max-w-56 inline-block overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                      {`${urlPrefix}/${!isManagedEventType ? pageSlug : t("username_placeholder")}/`}
                    </span>
                  </Tooltip>
                ) : undefined
              }
              containerClassName="[&>div]:gap-0"
              className="pl-0"
              {...register("slug")}
              onChange={(e) => {
                form.setValue("slug", slugify(e?.target.value), { shouldTouch: true });
              }}
            />
            {isManagedEventType && !isPlatform && (
              <p className="mt-2 text-sm text-gray-600">{t("managed_event_url_clarification")}</p>
            )}
          </div>
        )}
        {/* Description and duration — shared across all paradigms.
            Web uses a rich-text markdown Editor; platform uses a plain TextAreaField.
            Group event seats (ET-002) and RR/collective host config (ET-003, ET-004)
            are NOT configured here — they are set in post-creation settings tabs. */}
        <>
          {isPlatform ? (
            <TextAreaField {...register("description")} placeholder={t("quick_video_meeting")} />
          ) : (
            <Editor
              label={t("description")}
              getText={() => md.render(form.getValues("description") || "")}
              setText={(value: string) => form.setValue("description", turndown(value))}
              excludedToolbarItems={["blockType", "link"]}
              placeholder={t("quick_video_meeting")}
              firstRender={firstRender}
              setFirstRender={setFirstRender}
              maxHeight="200px"
            />
          )}

          {/* Duration field — enforces MIN_EVENT_DURATION_MINUTES to MAX_EVENT_DURATION_MINUTES
              bounds via both HTML min/max attributes and react-hook-form validation rules.
              Applies to all paradigms; booking window restrictions (ET-005) are configured
              separately in EventLimitsTab after creation. */}
          <div className="relative">
            <TextField
              type="number"
              required
              min={MIN_EVENT_DURATION_MINUTES}
              max={MAX_EVENT_DURATION_MINUTES}
              placeholder="15"
              label={t("duration")}
              className="pr-4"
              {...register("length", {
                valueAsNumber: true,
                min: {
                  value: MIN_EVENT_DURATION_MINUTES,
                  message: t("duration_min_error", { min: MIN_EVENT_DURATION_MINUTES }),
                },
                max: {
                  value: MAX_EVENT_DURATION_MINUTES,
                  message: t("duration_max_error", { max: MAX_EVENT_DURATION_MINUTES }),
                },
              })}
              addOnSuffix={t("minutes").toLowerCase()}
            />
          </div>
        </>
      </div>
      {SubmitButton(isPending)}
    </Form>
  );
}
