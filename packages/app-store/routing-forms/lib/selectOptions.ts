/**
 * @fileoverview
 *
 * This file holds the utilities to build the options to render in option-based fields
 * (select, multiselect, and checkbox) and it could be loaded on client side as well.
 *
 * RF-003 Field Type Parity:
 * - **checkbox**: Calendly's "Checkboxes" question type — a multi-option selection that is
 *   functionally identical to multiselect. All utility functions in this file work for checkbox
 *   fields because they operate on the generic `options` property, not on field type.
 * - **url**: Free-text URL input — does NOT use options; no handling needed here.
 * - **date**: Date picker input — does NOT use options; no handling needed here.
 */
import type { z } from "zod";

import type { zodFieldView } from "../zod";

type Field = z.infer<typeof zodFieldView>;

const buildOptionsFromLegacySelectText = ({ legacySelectText }: { legacySelectText: string }) => {
  return legacySelectText
    .trim()
    .split("\n")
    .map((fieldValue) => ({
      label: fieldValue,
      id: null,
    }));
};

/**
 * Returns the field with its `options` array populated.
 *
 * Resolution order:
 * 1. If `field.options` exists, use it directly.
 * 2. If the legacy `field.selectText` exists, parse newline-separated values into options.
 * 3. Otherwise, return the field as-is (branded as FIELD_WITH_OPTIONS for downstream type safety).
 *
 * This function is field-type-agnostic — it works for select, multiselect, and checkbox
 * (RF-003 Calendly "Checkboxes" parity) fields equally, since all three store their choices
 * in the same `options` array structure.
 */
export const getFieldWithOptions = <T extends Field>(field: T) => {
  const legacySelectText = field.selectText;
  if (field.options) {
    return {
      ...field,
      options: field.options,
    };
  } else if (legacySelectText) {
    const options = buildOptionsFromLegacySelectText({ legacySelectText });
    return {
      ...field,
      options,
    };
  }
  return {
    ...field,
  } as typeof field & z.BRAND<"FIELD_WITH_OPTIONS">;
};

/**
 * Detects whether a field's options are stored in the legacy format (options with `null` ids).
 * Legacy-format options use `option.label` as the value in routing conditions instead of `option.id`.
 *
 * Applies to all option-based field types: select, multiselect, and checkbox (RF-003).
 */
export function areSelectOptionsInLegacyFormat(
  field: Pick<Field, "options"> & z.BRAND<"FIELD_WITH_OPTIONS">
) {
  const options = field.options || [];
  return !!options.find((option) => !option.id);
}

/**
 * Builds a `{ value, title }` array suitable for RAQB `listValues` and form field rendering.
 *
 * For legacy-format options (null ids), `option.label` is used as the value to maintain
 * backward compatibility with existing routing conditions. For modern options, `option.id`
 * is preferred as it remains stable across label edits.
 *
 * This function is consumed by:
 * - `getQueryBuilderConfig.ts` — RAQB `listValues` for select, multiselect, and checkbox fields
 * - `FormInputFields.tsx` — rendering options in the form submission UI
 *
 * Supports all option-based field types (select, multiselect, checkbox) transparently
 * because it operates on the generic `options` property via `getFieldWithOptions`.
 */
export function getUIOptionsForSelect(field: Field) {
  const fieldWithOptions = getFieldWithOptions(field);
  const options = fieldWithOptions.options || [];
  const areOptionsInLegacyFormat = areSelectOptionsInLegacyFormat(
    fieldWithOptions as typeof fieldWithOptions & z.BRAND<"FIELD_WITH_OPTIONS">
  );
  // Because for legacy saved options, routes must have labels in them instead of ids
  const shouldUseLabelAsValue = areOptionsInLegacyFormat;
  return options.map((option) => {
    // We prefer option.id as that doesn't change when we change the option text/label.
    // Fallback to option.label for fields saved in DB in old format which didn't have `options`
    const value = shouldUseLabelAsValue ? option.label : option.id ?? option.label;
    return {
      value,
      title: option.label,
    };
  });
}
