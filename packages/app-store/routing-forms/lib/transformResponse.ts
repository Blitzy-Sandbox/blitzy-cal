import type { z } from "zod";

import type { Field, FormResponse } from "../types/types";
import { areSelectOptionsInLegacyFormat } from "./selectOptions";

/**
 * It takes care of correctly transforming the input to label or id depending on various cases
 * - It allows us to prefill with ID or Label
 * - It allows backward compatibility with legacy routes(with labels for options)
 */
function transformSelectValue({
  field,
  idOrLabel,
}: {
  field: Pick<Field, "options" | "type">;
  idOrLabel: string;
}) {
  idOrLabel = idOrLabel.trim();
  const options = field.options;
  if (!options) {
    return idOrLabel;
  }
  // Because for legacy saved options, routes must have labels in them instead of ids
  const shouldUseLabelAsValue = areSelectOptionsInLegacyFormat(
    field as typeof field & z.BRAND<"FIELD_WITH_OPTIONS">
  );
  const foundOptionById = options.find((option) => option.id === idOrLabel);
  if (foundOptionById) {
    if (shouldUseLabelAsValue) {
      return foundOptionById.label;
    } else {
      // If shouldUseLabelAsValue is false, then we must use id as value
      // Because shouldUseLabelAsValue is false, id must be set already
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return foundOptionById.id!;
    }
  } else {
    // No option was found that matches ID
    // So check if the label is provided
    const foundOptionByLabel = options.find((option) => {
      return option.label === idOrLabel;
    });
    if (foundOptionByLabel) {
      if (!shouldUseLabelAsValue) {
        // If shouldUseLabelAsValue is false, then we must use id as value
        // Because shouldUseLabelAsValue is false, id must be set already
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return foundOptionByLabel.id!;
      }
    }
  }
  return idOrLabel;
}

export function getFieldResponseForJsonLogic({
  field,
  value,
}: {
  field: Pick<Field, "options" | "type">;
  value: FormResponse[string]["value"] | undefined;
}) {
  if (!value) {
    return "";
  }
  // type="number" still gives value as a string but we need to store that as number so that number operators can work.
  if (field.type === "number") {
    if (typeof value === "string") {
      return Number(value);
    }
    return value;
  }
  if (field.type === "multiselect") {
    // Could be option id(i.e. a UUIDv4) or option label for ease of prefilling
    let valueOrLabelArray = value instanceof Array ? value : value.toString().split(",");

    valueOrLabelArray = valueOrLabelArray.map((idOrLabel) => {
      return transformSelectValue({ field, idOrLabel });
    });

    return valueOrLabelArray;
  }

  // RF-003: Checkbox field type — Calendly "Checkboxes" question parity.
  // Checkbox fields with options produce arrays of selected values (similar to multiselect).
  // Single-toggle checkboxes produce boolean values for RAQB jsonLogic boolean operators.
  if (field.type === "checkbox") {
    // Multiple checkboxes with options — handle array values like multiselect
    if (Array.isArray(value)) {
      return value.map((idOrLabel) => {
        return transformSelectValue({ field, idOrLabel });
      });
    }
    // Single checkbox (boolean toggle) — coerce to boolean for RAQB jsonLogic evaluation.
    // Form response values arrive as strings since FormResponse["value"] is string | number | string[].
    const stringValue = String(value).toLowerCase().trim();
    if (stringValue === "true" || stringValue === "1") {
      return true;
    }
    // "false", "0", and any other non-truthy string representations coerce to false
    return false;
  }

  // RF-003: Date field type — Calendly "Date" question parity.
  // Date fields contain ISO 8601 date strings (e.g., "2025-03-27") for RAQB date comparison operators.
  // The value must be returned as a normalized string for consistent evaluation.
  if (field.type === "date") {
    if (typeof value === "string") {
      return value.trim();
    }
    // Handle edge cases: array values use the first element; numbers are coerced to string
    if (Array.isArray(value)) {
      return value[0] || "";
    }
    return String(value);
  }

  // RF-003: URL/website field type — Calendly "Website URL" question parity.
  // URL values are string-based and treated like text for JSON Logic evaluation.
  // Whitespace is trimmed for consistent matching in routing rules.
  if (field.type === "url") {
    if (typeof value === "string") {
      return value.trim();
    }
    return String(value);
  }

  if (field.type === "select") {
    const valueAsStringOrStringArray = typeof value === "number" ? String(value) : value;
    const valueAsString =
      valueAsStringOrStringArray instanceof Array
        ? valueAsStringOrStringArray[0]
        : valueAsStringOrStringArray;

    return transformSelectValue({ field, idOrLabel: valueAsString });
  }
  return value;
}
