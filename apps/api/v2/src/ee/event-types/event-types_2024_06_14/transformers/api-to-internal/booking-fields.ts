/**
 * Booking Fields API-to-Internal Transformer (ET-006 Custom Fields/Questions Parity)
 *
 * Converts incoming `InputBookingField_2024_06_14` API payloads into the internal
 * booking field format used by Cal.com's persistence and form builder layers.
 *
 * Calendly Question Type Coverage (ET-006 parity verified):
 *  - text      → generic fallback handler (TextFieldInput_2024_06_14)
 *  - radio     → fieldIsSelect handler (RadioGroupFieldInput_2024_06_14)
 *  - checkbox  → fieldIsSelect handler (CheckboxGroupFieldInput_2024_06_14)
 *  - phone     → generic fallback handler (PhoneFieldInput_2024_06_14) for custom fields;
 *                fieldIsDefaultAttendeePhone for system attendeePhoneNumber
 *  - dropdown  → generic fallback handler (SelectFieldInput_2024_06_14) + options attachment
 *
 * Additional Cal.com field types beyond Calendly:
 *  - address, number, textarea, multiselect, multiemail, boolean, url
 *
 * System default fields (cloned from shared templates to avoid mutation):
 *  - location, attendeePhone, name, splitName, email, title, notes, guests, rescheduleReason
 */
import type {
  InputBookingField_2024_06_14,
  PhoneDefaultFieldOutput_2024_06_14,
  MultiSelectFieldInput_2024_06_14,
  CheckboxGroupFieldInput_2024_06_14,
  RadioGroupFieldInput_2024_06_14,
  NameDefaultFieldInput_2024_06_14,
  EmailDefaultFieldInput_2024_06_14,
  TitleDefaultFieldInput_2024_06_14,
  LocationDefaultFieldInput_2024_06_14,
  NotesDefaultFieldInput_2024_06_14,
  GuestsDefaultFieldInput_2024_06_14,
  RescheduleReasonDefaultFieldInput_2024_06_14,
  SplitNameDefaultFieldInput_2024_06_14,
} from "@calcom/platform-types";

import {
  systemBeforeFieldEmail,
  systemBeforeFieldName,
  systemBeforeFieldLocation,
  systemBeforeFieldPhone,
  systemAfterFieldTitle,
  systemAfterFieldNotes,
  systemAfterFieldGuests,
  systemAfterFieldRescheduleReason,
  type CustomField,
  type SystemField,
  systemBeforeFieldNameSplit,
} from "../internal-to-api";

type InputBookingField = InputBookingField_2024_06_14 | PhoneDefaultFieldOutput_2024_06_14;

/**
 * Transforms an array of API booking field inputs into the internal field format.
 * Handles system default fields (location, name, email, etc.), select-type fields
 * (checkbox, radio, multiselect), and all custom field types via a generic fallback.
 * Options arrays for select/checkbox/radio/multiselect are attached after base property
 * extraction to produce the complete internal representation.
 */
export function transformBookingFieldsApiToInternal(bookingFields: InputBookingField[]) {
  const customBookingFields = bookingFields.map((field) => {
    const baseProperties = getBaseProperties(field);

    const options =
      "options" in field && field.options ? transformSelectOptionsApiToInternal(field.options) : undefined;

    if (!options) {
      return baseProperties;
    }

    return {
      ...baseProperties,
      options,
    };
  });

  return customBookingFields;
}

function getBaseProperties(field: InputBookingField): CustomField | SystemField {
  // Calendly parity: checkbox and radio types (ET-006), plus Cal.com multiselect.
  // Note: select (dropdown) is intentionally NOT included here — it uses the generic
  // fallback handler because select fields support placeholder while checkbox/radio do not.
  if (fieldIsSelect(field)) {
    return {
      name: field.slug,
      type: field.type,
      label: field.label,
      sources: [
        {
          id: "user",
          type: "user",
          label: "User",
          fieldRequired: true,
        },
      ],
      editable: "user",
      required: field.required,
      disableOnPrefill: !!field.disableOnPrefill,
      // Use !! coercion for consistency: hidden is optional (boolean | undefined) on
      // select-type input fields, and all other handlers use !!field.hidden.
      hidden: "hidden" in field ? !!field.hidden : false,
    };
  }

  if (fieldIsDefaultSystemLocation(field)) {
    return {
      ...systemBeforeFieldLocation,
      label: field.label,
    };
  }

  if (fieldIsDefaultAttendeePhone(field)) {
    return {
      ...systemBeforeFieldPhone,
      required: field.required,
      hidden: field.hidden,
      label: field.label,
      placeholder: field.placeholder,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemName(field)) {
    const systemName = structuredClone(systemBeforeFieldName);
    if (systemName.variantsConfig?.variants?.fullName?.fields?.[0]) {
      systemName.variantsConfig.variants.fullName.fields[0].label = field.label;
    }

    if (systemName.variantsConfig?.variants?.fullName?.fields?.[0]) {
      systemName.variantsConfig.variants.fullName.fields[0].placeholder = field.placeholder;
    }
    // note(Lauris): we attach top level label and placeholder for easier access when converting database event type
    // to v2 response event type even though form builder uses label and placeholder from variantsConfig.
    systemName.label = field.label;
    systemName.placeholder = field.placeholder;

    return {
      ...systemName,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemNameSplit(field)) {
    const systemNameSplit = structuredClone(systemBeforeFieldNameSplit);

    const firstNameField = systemNameSplit.variantsConfig?.variants?.firstAndLastName?.fields?.find(
      (field) => field.name === "firstName"
    );
    const lastNameField = systemNameSplit.variantsConfig?.variants?.firstAndLastName?.fields?.find(
      (field) => field.name === "lastName"
    );

    if (firstNameField) {
      firstNameField.label = field.firstNameLabel || "";
      firstNameField.placeholder = field.firstNamePlaceholder || "";
    }

    if (lastNameField) {
      lastNameField.label = field.lastNameLabel || "";
      lastNameField.placeholder = field.lastNamePlaceholder || "";
      lastNameField.required = !!field.lastNameRequired;
    }

    return {
      ...systemNameSplit,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemEmail(field)) {
    return {
      ...systemBeforeFieldEmail,
      label: field.label,
      placeholder: field.placeholder,
      disableOnPrefill: !!field.disableOnPrefill,
      required: field.required,
      hidden: !!field.hidden,
    };
  }

  if (fieldIsCustomSystemRescheduleReason(field)) {
    return {
      ...systemAfterFieldRescheduleReason,
      required: !!field.required,
      hidden: !!field.hidden,
      label: field.label,
      placeholder: "placeholder" in field ? field.placeholder : undefined,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemTitle(field)) {
    return {
      ...systemAfterFieldTitle,
      required: !!field.required,
      hidden: !!field.hidden,
      label: field.label,
      placeholder: "placeholder" in field ? field.placeholder : undefined,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemNotes(field)) {
    return {
      ...systemAfterFieldNotes,
      required: !!field.required,
      hidden: !!field.hidden,
      label: field.label,
      placeholder: "placeholder" in field ? field.placeholder : undefined,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (fieldIsCustomSystemGuests(field)) {
    return {
      ...systemAfterFieldGuests,
      required: !!field.required,
      hidden: !!field.hidden,
      label: field.label,
      placeholder: "placeholder" in field ? field.placeholder : undefined,
      disableOnPrefill: !!field.disableOnPrefill,
    };
  }

  if (field.type === "boolean") {
    return {
      name: field.slug,
      type: field.type,
      label: field.label,
      labelAsSafeHtml: `<p>${field.label}</p>\n`,
      sources: [
        {
          id: "user",
          type: "user",
          label: "User",
          fieldRequired: true,
        },
      ],
      editable: "user",
      required: !!field.required,
      disableOnPrefill: !!field.disableOnPrefill,
      hidden: !!field.hidden,
    };
  }

  if (field.type === "url") {
    return {
      name: field.slug,
      type: field.type,
      label: field.label,
      placeholder: "placeholder" in field ? field.placeholder : "",
      labelAsSafeHtml: `<p>${field.label}</p>\n`,
      sources: [
        {
          id: "user",
          type: "user",
          label: "User",
          fieldRequired: true,
        },
      ],
      editable: "user",
      required: !!field.required,
      disableOnPrefill: !!field.disableOnPrefill,
      hidden: !!field.hidden,
    };
  }

  // Generic fallback: handles Calendly parity types text (ET-006) and phone (ET-006),
  // as well as Calendly dropdown equivalent (select with options attached by parent),
  // and additional Cal.com types: address, number, textarea, multiemail.
  return {
    name: field.slug,
    type: field.type,
    label: "label" in field ? field.label : "",
    sources: [
      {
        id: "user",
        type: "user",
        label: "User",
        fieldRequired: true,
      },
    ],
    editable: "user",
    required: !!field.required,
    placeholder: field.placeholder,
    disableOnPrefill: !!field.disableOnPrefill,
    hidden: !!field.hidden,
  };
}

function fieldIsCustomSystemName(field: InputBookingField): field is NameDefaultFieldInput_2024_06_14 {
  return "type" in field && field.type === "name";
}

function fieldIsCustomSystemNameSplit(
  field: InputBookingField
): field is SplitNameDefaultFieldInput_2024_06_14 {
  return "type" in field && field.type === "splitName";
}

function fieldIsCustomSystemEmail(field: InputBookingField): field is EmailDefaultFieldInput_2024_06_14 {
  return "type" in field && field.type === "email";
}

function fieldIsCustomSystemTitle(field: InputBookingField): field is TitleDefaultFieldInput_2024_06_14 {
  return "slug" in field && field.slug === "title";
}

function fieldIsCustomSystemNotes(field: InputBookingField): field is NotesDefaultFieldInput_2024_06_14 {
  return "slug" in field && field.slug === "notes";
}

function fieldIsCustomSystemGuests(field: InputBookingField): field is GuestsDefaultFieldInput_2024_06_14 {
  return "slug" in field && field.slug === "guests";
}

function fieldIsCustomSystemRescheduleReason(
  field: InputBookingField
): field is RescheduleReasonDefaultFieldInput_2024_06_14 {
  return "slug" in field && field.slug === "rescheduleReason";
}

function fieldIsDefaultAttendeePhone(field: InputBookingField): field is PhoneDefaultFieldOutput_2024_06_14 {
  const isPhone = "type" in field && field.type === "phone";
  const isAttendeePhoneNumber = "slug" in field && field.slug === "attendeePhoneNumber";
  return isPhone && isAttendeePhoneNumber;
}

function fieldIsDefaultSystemLocation(
  field: InputBookingField
): field is LocationDefaultFieldInput_2024_06_14 {
  return "slug" in field && field.slug === "location";
}

function fieldIsSelect(
  field: InputBookingField
): field is
  | CheckboxGroupFieldInput_2024_06_14
  | RadioGroupFieldInput_2024_06_14
  | MultiSelectFieldInput_2024_06_14 {
  return (
    "type" in field && (field.type === "checkbox" || field.type === "radio" || field.type === "multiselect")
  );
}

/**
 * Converts API option strings into the internal `{label, value}` pair format
 * used by select, multiselect, checkbox, and radio field types. Both `label`
 * and `value` are set to the option string — the internal form builder treats
 * the value as the canonical identifier and the label as the display text.
 */
export function transformSelectOptionsApiToInternal(options: string[]) {
  return options.map((option) => ({
    label: option,
    value: option,
  }));
}
