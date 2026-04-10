export const enum RoutingFormFieldType {
  TEXT = "text",
  NUMBER = "number",
  TEXTAREA = "textarea",
  SINGLE_SELECT = "select",
  MULTI_SELECT = "multiselect",
  PHONE = "phone",
  EMAIL = "email",
  /** Corresponds to Calendly's "Checkboxes" question type — multiple boolean/option selections */
  CHECKBOX = "checkbox",
  /** Corresponds to Calendly's "Website URL" question type — URL input */
  URL = "url",
  /** Corresponds to Calendly's "Date" question type — date input */
  DATE = "date",
}

export const isValidRoutingFormFieldType = (type: string): type is RoutingFormFieldType => {
  return [
    RoutingFormFieldType.TEXT,
    RoutingFormFieldType.NUMBER,
    RoutingFormFieldType.TEXTAREA,
    RoutingFormFieldType.SINGLE_SELECT,
    RoutingFormFieldType.MULTI_SELECT,
    RoutingFormFieldType.PHONE,
    RoutingFormFieldType.EMAIL,
    RoutingFormFieldType.CHECKBOX,
    RoutingFormFieldType.URL,
    RoutingFormFieldType.DATE,
  ].includes(type as RoutingFormFieldType);
};

export const FieldTypes = [
  {
    label: "Short text",
    value: RoutingFormFieldType.TEXT,
  },
  {
    label: "Number",
    value: RoutingFormFieldType.NUMBER,
  },
  {
    label: "Long text",
    value: RoutingFormFieldType.TEXTAREA,
  },
  {
    label: "Single-choice selection",
    value: RoutingFormFieldType.SINGLE_SELECT,
  },
  {
    label: "Multiple choice selection",
    value: RoutingFormFieldType.MULTI_SELECT,
  },
  {
    label: "Phone",
    value: RoutingFormFieldType.PHONE,
  },
  {
    label: "Email",
    value: RoutingFormFieldType.EMAIL,
  },
  {
    label: "Checkbox",
    value: RoutingFormFieldType.CHECKBOX,
  },
  {
    label: "URL",
    value: RoutingFormFieldType.URL,
  },
  {
    label: "Date",
    value: RoutingFormFieldType.DATE,
  },
] as const;
