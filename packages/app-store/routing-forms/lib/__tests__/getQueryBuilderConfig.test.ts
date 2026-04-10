import { describe, it, expect } from "vitest";
import { vi } from "vitest";

import type { RoutingForm } from "../../types/types";
import { FormFieldsInitialConfig } from "../InitialConfig";
import { getQueryBuilderConfigForFormFields } from "../getQueryBuilderConfig";

type MockedForm = Pick<RoutingForm, "fields">;
vi.mock("../InitialConfig", () => ({
  FormFieldsInitialConfig: {
    widgets: {
      text: { type: "text" },
      select: { type: "select" },
      multiselect: { type: "multiselect" },
      checkbox: { type: "checkbox" },
      url: { type: "text" },
      date: { type: "date" },
    },
    operators: {
      is_empty: {},
      is_not_empty: {},
      between: {},
      not_between: {},
    },
  },
}));

describe("getQueryBuilderConfig", () => {
  const mockForm: MockedForm = {
    fields: [
      {
        id: "field1",
        label: "Text Field",
        type: "text",
      },
      {
        id: "field2",
        label: "Select Field",
        type: "select",
        selectText: "Option 1\nOption 2",
      },
      {
        id: "field3",
        label: "MultiSelect Field",
        type: "multiselect",
        selectText: "Option A\nOption B\nOption C",
      },
    ],
  };

  /** Mock form fixture containing only the three new Calendly-parity field types (RF-003) */
  const mockFormWithNewFieldTypes: MockedForm = {
    fields: [
      {
        id: "checkboxField",
        label: "Checkbox Field",
        type: "checkbox",
      },
      {
        id: "urlField",
        label: "URL Field",
        type: "url",
      },
      {
        id: "dateField",
        label: "Date Field",
        type: "date",
      },
    ],
  };

  it("should generate correct config for all field types", () => {
    const config = getQueryBuilderConfigForFormFields(mockForm);

    expect(config.fields).toHaveProperty("field1");
    expect(config.fields).toHaveProperty("field2");
    expect(config.fields).toHaveProperty("field3");

    expect(config.fields.field1).toEqual({
      label: "Text Field",
      type: "text",
      valueSources: ["value"],
      fieldSettings: {},
    });

    expect(config.fields.field2).toEqual({
      label: "Select Field",
      type: "select",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [
          { value: "Option 1", title: "Option 1" },
          { value: "Option 2", title: "Option 2" },
        ],
      },
    });

    expect(config.fields.field3).toEqual({
      label: "MultiSelect Field",
      type: "multiselect",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [
          { value: "Option A", title: "Option A" },
          { value: "Option B", title: "Option B" },
          { value: "Option C", title: "Option C" },
        ],
      },
    });
  });

  it("should handle router fields correctly", () => {
    const formWithRouterField: MockedForm = {
      ...mockForm,
      fields: [
        {
          id: "routerField",
          type: "router",
          label: "Router Field",
          routerId: "innerField",
          routerField: {
            id: "innerField",
            label: "Router Field",
            type: "text",
          },
        },
      ],
    };

    const config = getQueryBuilderConfigForFormFields(formWithRouterField);

    expect(config.fields).toHaveProperty("innerField");
    expect(config.fields.innerField).toEqual({
      label: "Router Field",
      type: "text",
      valueSources: ["value"],
      fieldSettings: {},
    });
  });

  it("should throw an error for unsupported field types", () => {
    const formWithUnsupportedField: MockedForm = {
      ...mockForm,
      fields: [
        {
          id: "unsupportedField",
          label: "Unsupported Field",
          type: "unsupported" as any,
        },
      ],
    };

    expect(() => getQueryBuilderConfigForFormFields(formWithUnsupportedField)).toThrow(
      "Unsupported field type:unsupported"
    );
  });

  it("should remove specific operators when forReporting is true", () => {
    const config = getQueryBuilderConfigForFormFields(mockForm, true);

    expect(config.operators).not.toHaveProperty("is_empty");
    expect(config.operators).not.toHaveProperty("is_not_empty");
    expect(config.operators).not.toHaveProperty("between");
    expect(config.operators).not.toHaveProperty("not_between");
    expect(config.operators.__calReporting).toBe(true);
  });

  it("should include all operators when forReporting is false", () => {
    const config = getQueryBuilderConfigForFormFields(mockForm, false);

    expect(config.operators).toHaveProperty("is_empty");
    expect(config.operators).toHaveProperty("is_not_empty");
    expect(config.operators).toHaveProperty("between");
    expect(config.operators).toHaveProperty("not_between");
    expect(config.operators.__calReporting).toBeUndefined();
  });

  it("should use InitialConfig as base for the returned config", () => {
    const config = getQueryBuilderConfigForFormFields(mockForm);

    expect(config).toEqual(
      expect.objectContaining({
        ...FormFieldsInitialConfig,
        fields: expect.any(Object),
      })
    );
  });

  // ---------------------------------------------------------------------------
  // RF-003: Calendly-parity field type tests (checkbox, url, date)
  // ---------------------------------------------------------------------------

  it("should generate correct config for checkbox field type (no options)", () => {
    const config = getQueryBuilderConfigForFormFields(mockFormWithNewFieldTypes);

    expect(config.fields).toHaveProperty("checkboxField");
    expect(config.fields.checkboxField).toEqual({
      label: "Checkbox Field",
      type: "checkbox",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [],
      },
    });
  });

  it("should generate correct config for checkbox field with options (RF-003 parity)", () => {
    const formWithCheckboxOptions: MockedForm = {
      fields: [
        {
          id: "checkboxWithOpts",
          label: "Interest Areas",
          type: "checkbox",
          selectText: "Marketing\nEngineering\nDesign",
        },
      ],
    };
    const config = getQueryBuilderConfigForFormFields(formWithCheckboxOptions);

    expect(config.fields).toHaveProperty("checkboxWithOpts");
    expect(config.fields.checkboxWithOpts).toEqual({
      label: "Interest Areas",
      type: "checkbox",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [
          { value: "Marketing", title: "Marketing" },
          { value: "Engineering", title: "Engineering" },
          { value: "Design", title: "Design" },
        ],
      },
    });
  });

  it("should generate correct config for url field type", () => {
    const config = getQueryBuilderConfigForFormFields(mockFormWithNewFieldTypes);

    expect(config.fields).toHaveProperty("urlField");
    expect(config.fields.urlField).toEqual({
      label: "URL Field",
      type: "text",
      valueSources: ["value"],
      fieldSettings: {},
    });
  });

  it("should generate correct config for date field type", () => {
    const config = getQueryBuilderConfigForFormFields(mockFormWithNewFieldTypes);

    expect(config.fields).toHaveProperty("dateField");
    expect(config.fields.dateField).toEqual({
      label: "Date Field",
      type: "date",
      valueSources: ["value"],
      fieldSettings: {},
    });
  });

  it("should remove specific operators when forReporting is true with new field types", () => {
    const config = getQueryBuilderConfigForFormFields(mockFormWithNewFieldTypes, true);

    expect(config.operators).not.toHaveProperty("is_empty");
    expect(config.operators).not.toHaveProperty("is_not_empty");
    expect(config.operators).not.toHaveProperty("between");
    expect(config.operators).not.toHaveProperty("not_between");
    expect(config.operators.__calReporting).toBe(true);
  });

  it("should include all operators when forReporting is false with new field types", () => {
    const config = getQueryBuilderConfigForFormFields(mockFormWithNewFieldTypes, false);

    expect(config.operators).toHaveProperty("is_empty");
    expect(config.operators).toHaveProperty("is_not_empty");
    expect(config.operators).toHaveProperty("between");
    expect(config.operators).toHaveProperty("not_between");
    expect(config.operators.__calReporting).toBeUndefined();
  });

  it("should generate correct config for form with both old and new field types", () => {
    const mixedForm: MockedForm = {
      fields: [
        {
          id: "textField",
          label: "Text Field",
          type: "text",
        },
        {
          id: "selectField",
          label: "Select Field",
          type: "select",
          selectText: "Alpha\nBeta",
        },
        {
          id: "checkboxField",
          label: "Checkbox Field",
          type: "checkbox",
        },
        {
          id: "urlField",
          label: "URL Field",
          type: "url",
        },
        {
          id: "dateField",
          label: "Date Field",
          type: "date",
        },
      ],
    };

    const config = getQueryBuilderConfigForFormFields(mixedForm);

    // Verify all five fields are present
    expect(config.fields).toHaveProperty("textField");
    expect(config.fields).toHaveProperty("selectField");
    expect(config.fields).toHaveProperty("checkboxField");
    expect(config.fields).toHaveProperty("urlField");
    expect(config.fields).toHaveProperty("dateField");

    // Existing text field — listValues undefined, fieldSettings empty
    expect(config.fields.textField).toEqual({
      label: "Text Field",
      type: "text",
      valueSources: ["value"],
      fieldSettings: {},
    });

    // Existing select field — listValues populated
    expect(config.fields.selectField).toEqual({
      label: "Select Field",
      type: "select",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [
          { value: "Alpha", title: "Alpha" },
          { value: "Beta", title: "Beta" },
        ],
      },
    });

    // Checkbox field — listValues populated (empty when no options, RF-003)
    expect(config.fields.checkboxField).toEqual({
      label: "Checkbox Field",
      type: "checkbox",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [],
      },
    });

    // New url field — listValues undefined
    expect(config.fields.urlField).toEqual({
      label: "URL Field",
      type: "text",
      valueSources: ["value"],
      fieldSettings: {},
    });

    // New date field — listValues undefined
    expect(config.fields.dateField).toEqual({
      label: "Date Field",
      type: "date",
      valueSources: ["value"],
      fieldSettings: {},
    });
  });

  it("should handle router fields with new field types correctly", () => {
    const formWithNewTypeRouterField: MockedForm = {
      fields: [
        {
          id: "routerCheckbox",
          type: "router",
          label: "Router Checkbox",
          routerId: "innerCheckbox",
          routerField: {
            id: "innerCheckbox",
            label: "Inner Checkbox",
            type: "checkbox",
          },
        },
      ],
    };

    const config = getQueryBuilderConfigForFormFields(formWithNewTypeRouterField);

    expect(config.fields).toHaveProperty("innerCheckbox");
    expect(config.fields.innerCheckbox).toEqual({
      label: "Inner Checkbox",
      type: "checkbox",
      valueSources: ["value"],
      fieldSettings: {
        listValues: [],
      },
    });
  });
});
