/**
 * EmbedDialogForm — EM-004 Share Flow Customization Component
 *
 * Provides embed-specific customization controls for Calendly share flow parity.
 * This component renders input fields for embed appearance customization:
 * - Background color and text color pickers (EM-001 inline parity)
 * - Modal overlay color and close button color pickers (EM-002 modal parity)
 * - Button border radius input (EM-003 floating button parity)
 * - Hide event type details toggle
 *
 * Used within the embed configuration dialog alongside the existing Embed.tsx preview/code-generation.
 *
 * @module EmbedDialogForm
 */

import type { Dispatch, SetStateAction, RefObject } from "react";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { ColorPicker } from "@calcom/ui/components/form";
import { Label } from "@calcom/ui/components/form";
import { TextField } from "@calcom/ui/components/form";
import { Switch } from "@calcom/ui/components/form";

import type { EmbedType, PreviewState } from "@calcom/features/embed/types";

/** Props for the EmbedDialogForm customization component */
export interface EmbedDialogFormProps {
  /** The currently selected embed type to determine which fields to show */
  embedType: EmbedType | null;
  /** The current preview state for reading and updating customization values */
  previewState: PreviewState;
  /** State setter for updating the preview state with user customization choices */
  setPreviewState: Dispatch<SetStateAction<PreviewState>>;
  /** Whether the hide event type details option is disabled (e.g., for routing form embeds) */
  eventTypeHideOptionDisabled?: boolean;
  /** Optional ref to the dialog content container for color picker popover positioning */
  dialogContentRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Renders embed customization form fields based on the selected embed type.
 * Each embed type surfaces different customization options:
 *
 * - **inline**: Background color, text color
 * - **floating-popup**: Button border radius
 * - **element-click / modal**: Modal overlay color, modal close button color
 * - **All types**: Hide event type details toggle
 *
 * Integrates with the embed dialog's preview state to provide real-time preview updates
 * and accurate code snippet generation (EM-004 share flow parity).
 */
export function EmbedDialogForm({
  embedType,
  previewState,
  setPreviewState,
  eventTypeHideOptionDisabled = false,
  dialogContentRef,
}: EmbedDialogFormProps) {
  const { t } = useLocale();

  return (
    <div className="space-y-4">
      {/* EM-003: Floating button border radius customization */}
      {embedType === "floating-popup" && (
        <Label>
          <div className="mb-2">{t("border_radius") ?? "Button border radius"}</div>
          <TextField
            name="buttonBorderRadius"
            placeholder="e.g., 50%, 8px"
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              setPreviewState((prev) => ({
                ...prev,
                floatingPopup: {
                  ...prev.floatingPopup,
                  buttonBorderRadius: value || undefined,
                },
              }));
            }}
          />
        </Label>
      )}

      {/* EM-002: Modal overlay color customization for popup/element-click embeds */}
      {(embedType === "element-click" || embedType === "floating-popup") && (
        <>
          <Label>
            <div className="mb-2">{t("modal_overlay_color") ?? "Modal overlay color"}</div>
            <div className="w-full">
              <ColorPicker
                popoverAlign="start"
                container={dialogContentRef?.current ?? undefined}
                defaultValue="rgb(5, 5, 5)"
                onChange={(color) => {
                  setPreviewState((prev) => ({
                    ...prev,
                    floatingPopup: {
                      ...prev.floatingPopup,
                      config: {
                        ...prev.floatingPopup.config,
                        modalOverlayColor: color,
                      },
                    },
                  }));
                }}
              />
            </div>
          </Label>
          <Label>
            <div className="mb-2">{t("modal_close_button_color") ?? "Modal close button color"}</div>
            <div className="w-full">
              <ColorPicker
                popoverAlign="start"
                container={dialogContentRef?.current ?? undefined}
                defaultValue="#FFFFFF"
                onChange={(color) => {
                  setPreviewState((prev) => ({
                    ...prev,
                    floatingPopup: {
                      ...prev.floatingPopup,
                      config: {
                        ...prev.floatingPopup.config,
                        modalCloseButtonColor: color,
                      },
                    },
                  }));
                }}
              />
            </div>
          </Label>
        </>
      )}

      {/* EM-001: Hide event type details toggle (shared across embed types) */}
      {!eventTypeHideOptionDisabled && (
        <div className="flex items-center justify-start space-x-2 rtl:space-x-reverse">
          <Switch
            checked={previewState.hideEventTypeDetails}
            onCheckedChange={(checked) => {
              setPreviewState((prev) => ({
                ...prev,
                hideEventTypeDetails: checked,
              }));
            }}
          />
          <div className="text-default text-sm">{t("hide_eventtype_details")}</div>
        </div>
      )}
    </div>
  );
}

export default EmbedDialogForm;
