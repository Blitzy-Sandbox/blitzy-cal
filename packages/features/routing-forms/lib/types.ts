import type z from "zod";

import type { zodNonRouterField, routingFormResponseInDbSchema } from "./zod";

/**
 * Supported routing form field types, aligned with Calendly question type equivalents.
 * - 'text' → Calendly "Single Line"
 * - 'email' → Calendly "Email"
 * - 'phone' → Calendly "Phone Number"
 * - 'number' → Calendly "Number"
 * - 'textarea' → Calendly "Multi Line"
 * - 'select' → Calendly "Dropdown"
 * - 'multiselect' → Calendly "Checkboxes" (multiple selection)
 * - 'radio' → Calendly "Radio Buttons"
 * - 'checkbox' → Calendly "Checkbox" (single boolean)
 */
export type FieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "textarea"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox";

/** Represents all possible response value shapes for routing form fields */
export type FieldResponseValue = number | string | string[] | boolean;

/**
 * Maps Calendly question type identifiers to Cal.com field types.
 * Used for parity tracking and documentation — not for runtime logic.
 */
export type CalendlyQuestionType = {
  single_line: "text";
  multi_line: "textarea";
  radio_buttons: "radio";
  checkboxes: "multiselect";
  dropdown: "select";
  phone_number: "phone";
  email: "email";
  number: "number";
};

/**
 * Field-level validation constraints supporting Calendly's validation semantics.
 */
export type FieldValidationRule = {
  /** Minimum character length for text-based fields */
  minLength?: number;
  /** Maximum character length for text-based fields */
  maxLength?: number;
  /** Regex pattern string for custom input validation */
  pattern?: string;
  /** Minimum value for number fields */
  min?: number;
  /** Maximum value for number fields */
  max?: number;
  /** Custom validation error message displayed on constraint violation */
  message?: string;
};

export type FormResponse = Record<
  // Field ID
  string,
  {
    value: number | string | string[] | boolean;
    label: string;
    identifier?: string;
  }
>;

export type Field = z.infer<typeof zodNonRouterField>;
export type Fields = Field[];

export type RoutingFormResponseData = {
  fields: z.infer<typeof zodNonRouterField>[];
  response: z.infer<typeof routingFormResponseInDbSchema>;
};
