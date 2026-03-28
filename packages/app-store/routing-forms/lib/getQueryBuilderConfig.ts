import { AttributeType } from "@calcom/prisma/enums";

import type { RoutingForm, Attribute } from "../types/types";
import { FieldTypes, RoutingFormFieldType } from "./FieldTypes";
import { AttributesInitialConfig, FormFieldsInitialConfig } from "./InitialConfig";
import { getUIOptionsForSelect } from "./selectOptions";

export const isDynamicOperandField = (value: string) => {
  return /{field:.*?}/.test(value);
};

const buildDynamicOperandFieldVariable = (fieldId: string) => {
  return `{field:${fieldId}}`;
};

type RaqbConfigFields = Record<
  string,
  {
    label: string;
    type: string;
    valueSources: ["value"];
    fieldSettings: {
      listValues?: {
        value: string;
        title: string;
      }[];
    };
  }
>;

// FIXME: Add TS Magic to ensure all types of attributes are mapped to RoutingFormFieldType
const attributeTypesMap = new Map<keyof typeof AttributeType, RoutingFormFieldType>([
  [AttributeType.SINGLE_SELECT, RoutingFormFieldType.SINGLE_SELECT],
  [AttributeType.MULTI_SELECT, RoutingFormFieldType.MULTI_SELECT],
  [AttributeType.TEXT, RoutingFormFieldType.TEXT],
  [AttributeType.NUMBER, RoutingFormFieldType.NUMBER],
]);

/**
 * Fallback RAQB widget type mapping for Calendly-parity field types (RF-003) that do not yet
 * have a dedicated widget registered in FormFieldsInitialConfig / AttributesInitialConfig.
 *
 * - "checkbox": Calendly "Checkboxes" question type — compared as text (equal/not_equal)
 *   until a dedicated boolean or multiselect widget is registered upstream.
 * - "url": Calendly "Website URL" question type — URL values are compared as strings.
 * - "date": Calendly "Date" question type — date values are compared as text strings
 *   until a dedicated RAQB date widget is configured.
 *
 * None of these types require `listValues` — see the IMPORTANT comment on the listValues
 * conditional for why non-select types must leave listValues undefined.
 */
const FIELD_TYPE_WIDGET_FALLBACK: Partial<Record<RoutingFormFieldType, string>> = {
  [RoutingFormFieldType.CHECKBOX]: "text",
  [RoutingFormFieldType.URL]: "text",
  [RoutingFormFieldType.DATE]: "text",
};

/**
 * Resolves the RAQB widget type string for a given routing form field type.
 *
 * First checks if the RAQB config has a widget registered for this field type (the normal path
 * for text, number, textarea, select, multiselect, phone, email). If no widget is registered,
 * falls back to {@link FIELD_TYPE_WIDGET_FALLBACK} for new Calendly-parity field types.
 * Throws if neither source can resolve the widget type — this indicates a configuration gap.
 */
function resolveWidgetType(
  fieldType: (typeof FieldTypes)[number]["value"],
  configWidgets: typeof FormFieldsInitialConfig.widgets
): string {
  const widget = configWidgets[fieldType];
  if (widget) {
    return widget.type;
  }
  const fallback = FIELD_TYPE_WIDGET_FALLBACK[fieldType as RoutingFormFieldType];
  if (fallback) {
    return fallback;
  }
  throw new Error(`No widget configuration found for field type: ${fieldType}`);
}

export type FormFieldsQueryBuilderConfigWithRaqbFields = ReturnType<
  typeof getQueryBuilderConfigForFormFields
>;

export type AttributesQueryBuilderConfigWithRaqbFields = ReturnType<
  typeof getQueryBuilderConfigForAttributes
>;

export function getQueryBuilderConfigForFormFields(form: Pick<RoutingForm, "fields">, forReporting = false) {
  const fields: RaqbConfigFields = {};
  form.fields?.forEach((field) => {
    if ("routerField" in field) {
      field = field.routerField;
    }
    // We can assert the type because otherwise we throw 'Unsupported field type' error
    const fieldType = field.type as (typeof FieldTypes)[number]["value"];
    if (FieldTypes.map((f) => f.value).includes(fieldType)) {
      const options = getUIOptionsForSelect(field);

      // Resolve widget type from the RAQB config or fallback mapping for new Calendly-parity types (RF-003)
      const widgetType = resolveWidgetType(fieldType, FormFieldsInitialConfig.widgets);

      fields[field.id] = {
        label: field.label,
        type: widgetType,
        valueSources: ["value"],
        fieldSettings: {
          // IMPORTANT: listValues must be undefined for non-select/multiselect fields otherwise RAQB doesn't like it. It ends up considering all the text values as per the listValues too which could be empty as well making all values invalid
          listValues: fieldType === "select" || fieldType === "multiselect" ? options : undefined,
        },
      };
    } else {
      throw new Error(`Unsupported field type:${field.type}`);
    }
  });

  const initialConfigCopy = {
    ...FormFieldsInitialConfig,
    operators: { ...FormFieldsInitialConfig.operators } as typeof FormFieldsInitialConfig.operators & {
      __calReporting?: boolean;
    },
  };

  if (forReporting) {
    // Empty and Not empty doesn't work well with JSON querying in prisma. Try to implement these when we desperately need these operators.
    delete initialConfigCopy.operators.is_empty;
    delete initialConfigCopy.operators.is_not_empty;

    // These operators can be implemented later if needed.
    delete initialConfigCopy.operators.between;
    delete initialConfigCopy.operators.not_between;

    initialConfigCopy.operators.__calReporting = true;
  }
  // You need to provide your own config. See below 'Config format'
  const config = {
    ...initialConfigCopy,
    fields: fields,
  };
  return config;
}

function transformAttributesToCompatibleFormat(attributes: Attribute[]) {
  return attributes.map((attribute) => {
    const mappedType = attributeTypesMap.get(attribute.type);
    if (!mappedType) {
      throw new Error(`Unsupported attribute type:${attribute.type}`);
    }
    return {
      label: attribute.name,
      id: attribute.id,
      type: mappedType,
      options: attribute.options.map((option) => ({
        title: option.value,
        // We have to use something that doesn't change often. ID of attribute never changes. Changing means a saved value will become invalid
        value: option.id,
      })),
    };
  });
}

export function getQueryBuilderConfigForAttributes({
  attributes,
  /**
   * It is the fields that makes up additional options to be matched with for the single select/multiselect attributes.
   * They are shown as 'Value of field <field-label>' in the dropdown.
   */
  dynamicOperandFields = [],
}: {
  attributes: Attribute[];

  dynamicOperandFields?: {
    label: string;
    id: string;
  }[];
}) {
  const transformedAttributes = transformAttributesToCompatibleFormat(attributes);
  const fields: RaqbConfigFields = {};
  transformedAttributes.forEach((attribute) => {
    const attributeType = attribute.type as (typeof FieldTypes)[number]["value"];
    if (FieldTypes.map((f) => f.value).includes(attributeType)) {
      // Resolve widget type from the RAQB config or fallback mapping for new Calendly-parity types (RF-003)
      const widgetType = resolveWidgetType(attributeType, FormFieldsInitialConfig.widgets);
      const valueOfFieldOptions = (() => {
        const formFieldsOptions = dynamicOperandFields.map((field) => ({
          title: `Value of field '${field.label}'`,
          value: buildDynamicOperandFieldVariable(field.id),
        }));
        return formFieldsOptions;
      })();

      const attributeOptions = [...valueOfFieldOptions, ...attribute.options];

      // These are RAQB fields
      fields[attribute.id] = {
        label: attribute.label,
        type: widgetType,
        valueSources: ["value"],
        fieldSettings: {
          // IMPORTANT: listValues must be undefined for non-select/multiselect fields otherwise RAQB doesn't like it. It ends up considering all the text values as per the listValues too which could be empty as well making all values invalid
          listValues:
            attributeType === "select" || attributeType === "multiselect" ? attributeOptions : undefined,
        },
      };
    } else {
      throw new Error(`Unsupported field type:${attribute.type}`);
    }
  });

  const initialConfigCopy = {
    ...AttributesInitialConfig,
    operators: { ...AttributesInitialConfig.operators },
  };
  return {
    ...initialConfigCopy,
    fields: fields,
  };
}
