import { z } from "zod";

export type FieldOption = {
  label: string;
  id: string | null;
  /** When true, the option is displayed but not selectable by the respondent */
  disabled?: boolean;
};

export type TNonRouterField = {
  id: string;
  label: string;
  identifier?: string;
  placeholder?: string;
  type: string;
  /** @deprecated in favour of `options` */
  selectText?: string;
  required?: boolean;
  deleted?: boolean;
  options?: FieldOption[];
  /**
   * Field-level validation constraints for Calendly-equivalent question validation.
   * All properties are optional — only apply the rules relevant to the field type.
   */
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
    message?: string;
  };
  /** Pre-populated default value for the field, supporting all Calendly-parity value shapes */
  defaultValue?: string | number | boolean | string[];
  /** Help text or description displayed below the question (Calendly shows descriptions below questions) */
  description?: string;
  /**
   * Strict Calendly-aligned field type discriminator.
   * Separate from `type` (which accepts any string for legacy data) to maintain backward compatibility.
   */
  fieldType?:
    | "text"
    | "email"
    | "phone"
    | "number"
    | "textarea"
    | "select"
    | "multiselect"
    | "radio"
    | "checkbox";
};

// Note: zodNonRouterField is NOT annotated with z.ZodType because it uses .extend() below
// which requires the full ZodObject type to be preserved
export const zodNonRouterField = z.object({
  id: z.string(),
  label: z.string(),
  identifier: z.string().optional(),
  placeholder: z.string().optional(),
  type: z.string(),
  /**
   * @deprecated in favour of `options`
   */
  selectText: z.string().optional(),
  required: z.boolean().optional(),
  deleted: z.boolean().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        // To keep backwards compatibility with the options generated from legacy selectText, we allow saving null as id
        // It helps in differentiating whether the routing logic should consider the option.label as value or option.id as value.
        // This is important for legacy routes which has option.label saved in conditions and it must keep matching with the value of the option
        id: z.string().or(z.null()),
        /** When true, the option is displayed but not selectable by the respondent */
        disabled: z.boolean().optional(),
      })
    )
    .optional(),
  /**
   * Field-level validation constraints for Calendly-equivalent question validation.
   * All properties are optional — only apply the rules relevant to the field type.
   */
  validation: z
    .object({
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      message: z.string().optional(),
    })
    .optional(),
  /** Pre-populated default value for the field, supporting all Calendly-parity value shapes */
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  /** Help text or description displayed below the question (Calendly shows descriptions below questions) */
  description: z.string().optional(),
  /**
   * Strict Calendly-aligned field type discriminator.
   * Separate from the existing `type` field (which accepts any string for legacy data)
   * to maintain backward compatibility. Provides a stricter, validated type enum.
   */
  fieldType: z
    .enum(["text", "email", "phone", "number", "textarea", "select", "multiselect", "radio", "checkbox"])
    .optional(),
});

// This is different from FormResponse in types.d.ts in that it has label optional. We don't seem to be using label at this point, so we might want to use this only while saving the response when Routing Form is submitted
// Record key is formFieldId
export const routingFormResponseInDbSchema = z.record(
  z.object({
    label: z.string().optional(),
    value: z.union([z.string(), z.number(), z.array(z.string()), z.boolean()]),
  })
);
