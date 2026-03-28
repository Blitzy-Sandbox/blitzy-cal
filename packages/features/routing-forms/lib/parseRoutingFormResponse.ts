import { zodNonRouterField, routingFormResponseInDbSchema } from "./zod";
import type { RoutingFormResponseData } from "./types";

// ---------------------------------------------------------------------------
// Internal type aliases
// ---------------------------------------------------------------------------

/** Represents a single parsed response entry value shape */
type ResponseEntry = {
  label?: string;
  value: string | number | string[] | boolean;
};

/** Full parsed response record keyed by form field ID */
type ResponseRecord = Record<string, ResponseEntry>;

/** Minimal field type info needed for response validation and normalization */
type FieldTypeInfo = {
  type: string;
  fieldType?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Simple email format validation pattern (user@domain.tld) */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Simple phone format validation pattern (optional +, digits/spaces/dashes/parens, min 7 chars) */
const PHONE_PATTERN = /^[+]?[\d\s\-().]{7,}$/;

// ---------------------------------------------------------------------------
// Internal helper functions
// ---------------------------------------------------------------------------

/**
 * Filters out response entries whose field IDs are not present in the form field definitions.
 * Logs a warning for each filtered entry to aid debugging without breaking form submission.
 *
 * @param response - The parsed response record to filter
 * @param fieldTypeMap - Lookup of valid field IDs to their type information
 * @returns A new response record containing only entries with known field IDs
 */
function filterUnknownFieldIds(
  response: ResponseRecord,
  fieldTypeMap: Record<string, FieldTypeInfo>
): ResponseRecord {
  const filtered: ResponseRecord = {};

  for (const [fieldId, entry] of Object.entries(response)) {
    if (fieldId in fieldTypeMap) {
      filtered[fieldId] = entry;
    } else {
      console.warn(
        `[parseRoutingFormResponse] Strict mode: filtering response entry with unknown field ID "${fieldId}"`
      );
    }
  }

  return filtered;
}

/**
 * Normalizes numeric string values to actual number types for fields declared as 'number'.
 * This handles URL query parameter values which always arrive as strings.
 * Only coerces values that represent valid finite numeric strings; all others are left unchanged.
 *
 * @param response - The parsed response record to normalize
 * @param fieldTypeMap - Lookup of field IDs to their type information
 * @returns A new response record with numeric strings coerced to numbers where applicable
 */
function normalizeNumberValues(
  response: ResponseRecord,
  fieldTypeMap: Record<string, FieldTypeInfo>
): ResponseRecord {
  const normalized: ResponseRecord = {};

  for (const [fieldId, entry] of Object.entries(response)) {
    const fieldInfo = fieldTypeMap[fieldId];
    // Check both legacy 'type' and strict 'fieldType' for number field identification
    const isNumberField = fieldInfo?.type === "number" || fieldInfo?.fieldType === "number";

    if (isNumberField && typeof entry.value === "string") {
      const trimmed = entry.value.trim();
      if (trimmed !== "") {
        const numericValue = Number(trimmed);
        if (!Number.isNaN(numericValue) && Number.isFinite(numericValue)) {
          normalized[fieldId] = { ...entry, value: numericValue };
          continue;
        }
      }
    }

    normalized[fieldId] = entry;
  }

  return normalized;
}

/**
 * Performs soft (warning-only) validation of field-type-specific response value shapes.
 * Checks email format, phone format, and numeric validity against their declared field types.
 * Logs console warnings for mismatches but never throws — maintains backward compatibility
 * and ensures existing callers are never disrupted by invalid input data.
 *
 * @param response - The parsed response record to validate
 * @param fieldTypeMap - Lookup of field IDs to their type information
 */
function warnOnFieldTypeMismatches(
  response: ResponseRecord,
  fieldTypeMap: Record<string, FieldTypeInfo>
): void {
  for (const [fieldId, entry] of Object.entries(response)) {
    const fieldInfo = fieldTypeMap[fieldId];
    if (!fieldInfo) {
      continue;
    }

    // Prefer the strict fieldType enum if available; fall back to the legacy type string
    const effectiveType = fieldInfo.fieldType || fieldInfo.type;
    const { value } = entry;

    switch (effectiveType) {
      case "email":
        if (typeof value === "string" && value.length > 0 && !EMAIL_PATTERN.test(value)) {
          console.warn(
            `[parseRoutingFormResponse] Field "${fieldId}" (email): value does not match email format`
          );
        }
        break;

      case "phone":
        if (typeof value === "string" && value.length > 0 && !PHONE_PATTERN.test(value)) {
          console.warn(
            `[parseRoutingFormResponse] Field "${fieldId}" (phone): value does not match phone format`
          );
        }
        break;

      case "number":
        if (typeof value === "string" && value.length > 0 && Number.isNaN(Number(value))) {
          console.warn(
            `[parseRoutingFormResponse] Field "${fieldId}" (number): value is not a valid number`
          );
        }
        break;

      default:
        // No format validation needed for text, textarea, select, multiselect, radio, checkbox
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Configuration options for routing form response parsing behavior.
 * Supports Calendly-equivalent field type validation and normalization.
 */
export type ParseOptions = {
  /** When true, filters out response entries with field IDs not present in the form field definitions */
  strict?: boolean;
  /** When true, coerces numeric string values to numbers for fields with type 'number' */
  normalizeNumbers?: boolean;
};

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Parses and validates a routing form response against the form field definitions.
 *
 * Supports Calendly-equivalent question types including:
 * - Checkbox/boolean responses (parsed via the extended routingFormResponseInDbSchema)
 * - Multi-select string[] array responses (preserved as-is through existing schema support)
 * - Number fields with optional string-to-number normalization for URL query params
 * - Email, phone, and number format soft validation (warnings only, never rejects)
 *
 * @param rawResponse - Raw response data to parse (Record<fieldId, { label?, value }>)
 * @param formFields - Raw form field definitions to parse against zodNonRouterField schema
 * @param options - Optional configuration for strict mode and number normalization
 * @returns Parsed and optionally normalized RoutingFormResponseData
 *
 * @example
 * // Backward-compatible 2-argument usage (identical to original behavior)
 * const data = parseRoutingFormResponse(rawResponse, formFields);
 *
 * @example
 * // With number normalization for URL query param string values
 * const data = parseRoutingFormResponse(rawResponse, formFields, { normalizeNumbers: true });
 *
 * @example
 * // With strict mode to filter unknown field IDs with warning logs
 * const data = parseRoutingFormResponse(rawResponse, formFields, { strict: true });
 */
export function parseRoutingFormResponse(
  rawResponse: unknown,
  formFields: unknown,
  options?: ParseOptions
): RoutingFormResponseData {
  // Core Zod parsing — boolean and multi-select values are supported by the extended schema
  const response = routingFormResponseInDbSchema.parse(rawResponse);
  const fields = zodNonRouterField.array().parse(formFields);

  // Build a lookup of field ID → type info for normalization and validation
  const fieldTypeMap: Record<string, FieldTypeInfo> = {};
  for (const field of fields) {
    fieldTypeMap[field.id] = { type: field.type, fieldType: field.fieldType };
  }

  let processedResponse: ResponseRecord = response;

  // Strict mode: remove response entries whose field IDs are not in the form definition
  if (options?.strict) {
    processedResponse = filterUnknownFieldIds(processedResponse, fieldTypeMap);
  }

  // Number normalization: coerce numeric string values to actual numbers for number-typed fields
  if (options?.normalizeNumbers) {
    processedResponse = normalizeNumberValues(processedResponse, fieldTypeMap);
  }

  // Soft validation: warn about field-type format mismatches without rejecting the response
  warnOnFieldTypeMismatches(processedResponse, fieldTypeMap);

  return { response: processedResponse, fields };
}
