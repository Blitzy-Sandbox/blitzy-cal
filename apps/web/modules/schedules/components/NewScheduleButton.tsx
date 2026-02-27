import { revalidateAvailabilityList } from "app/(use-page-wrapper)/(main-nav)/availability/actions";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Dialog } from "@calcom/features/components/controlled-dialog";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { HttpError } from "@calcom/lib/http-error";
import { trpc } from "@calcom/trpc/react";
import { Button } from "@calcom/ui/components/button";
import { DialogContent, DialogFooter, DialogTrigger, DialogClose } from "@calcom/ui/components/dialog";
import { Form } from "@calcom/ui/components/form";
import { InputField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";

/**
 * FAB (Floating Action Button) and Dialog entry point for creating new availability schedules.
 *
 * Renders a `variant="fab"` button that opens a controlled `Dialog` containing a
 * schedule-name input field. On submit the component fires the
 * `trpc.viewer.availability.schedule.create` mutation and orchestrates the full
 * post-creation lifecycle:
 *
 * **onSuccess**
 * 1. Navigates to `/availability/{id}` (appends `?fromEventType=true` when the
 *    caller originates from the event-type builder flow).
 * 2. Displays a localized success toast (`schedule_created_successfully`).
 * 3. Calls `revalidateAvailabilityList()` to refresh the server-side cache.
 * 4. Optimistically updates the TRPC `viewer.availability.list` query cache by
 *    appending the new schedule with `isDefault: false` and an empty availability array.
 *
 * **onError**
 * - `HttpError` instances surface as `"{statusCode}: {message}"` error toasts.
 * - `UNAUTHORIZED` TRPC error codes surface a dedicated
 *   `error_schedule_unauthorized_create` localized message.
 *
 * @param props.name - Dialog identifier and `data-testid` attribute.
 *   Defaults to `"new-schedule"`. The Dialog's `clearQueryParamsOnClose` strips
 *   the `copy-schedule-id` query parameter on close.
 * @param props.fromEventType - When truthy, appends `?fromEventType=true` to the
 *   post-creation redirect URL so the schedule editor can render event-type-specific
 *   contextual UI.
 *
 * **Input validation**
 * - The schedule name field uses a Unicode-aware regex
 *   (`^[\p{L}\p{M}\p{N}\s&\-_'\u2018\u2019@.:,/]+$` with the `"u"` flag) to
 *   accept international characters while blocking control and special characters.
 * - The `setValueAs` normalizer maps empty or whitespace-only input to `null`,
 *   allowing server-side Zod validation to apply its own defaults.
 */
export function NewScheduleButton({
  name = "new-schedule",
  fromEventType,
}: {
  name?: string;
  fromEventType?: boolean;
}) {
  const router = useRouter();
  const { t } = useLocale();

  const form = useForm<{
    name: string;
  }>();
  const { register } = form;
  const utils = trpc.useUtils();

  const createMutation = trpc.viewer.availability.schedule.create.useMutation({
    onSuccess: async ({ schedule }) => {
      await router.push(`/availability/${schedule.id}${fromEventType ? "?fromEventType=true" : ""}`);
      showToast(t("schedule_created_successfully", { scheduleName: schedule.name }), "success");
      revalidateAvailabilityList();
      utils.viewer.availability.list.setData(undefined, (data) => {
        const newSchedule = { ...schedule, isDefault: false, availability: [] };
        if (!data)
          return {
            schedules: [newSchedule],
          };
        return {
          ...data,
          schedules: [...data.schedules, newSchedule],
        };
      });
    },
    onError: (err) => {
      if (err instanceof HttpError) {
        const message = `${err.statusCode}: ${err.message}`;
        showToast(message, "error");
      }

      if (err.data?.code === "UNAUTHORIZED") {
        const message = `${err.data.code}: ${t("error_schedule_unauthorized_create")}`;
        showToast(message, "error");
      }
    },
  });

  return (
    <Dialog name={name} clearQueryParamsOnClose={["copy-schedule-id"]}>
      <DialogTrigger asChild>
        <Button variant="fab" data-testid={name} StartIcon="plus" size="sm">
          {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("add_new_schedule")}>
        <Form
          form={form}
          handleSubmit={(values) => {
            createMutation.mutate(values);
          }}>
          <InputField
            label={t("name")}
            type="text"
            id="name"
            required
            placeholder={t("default_schedule_name")}
            {...register("name", {
              setValueAs: (v) => (!v || v.trim() === "" ? null : v),
              required:t('required'),
              pattern:{
                value: new RegExp(
                  "^[\\p{L}\\p{M}\\p{N}\\s&\\-_'\\u2018\\u2019@.:,/]+$",
                  "u"
                ),
                message:t("invalid_characters_in_name"),
              }
            })}
          />
          <DialogFooter>
            <DialogClose />
            <Button type="submit" loading={createMutation.isPending}>
              {t("continue")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
