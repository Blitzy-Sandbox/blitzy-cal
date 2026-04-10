import { describe, it, expect } from "vitest";

import type { Field, FormResponse } from "../../types/types";
import { getHumanReadableFieldResponseValue } from "./getHumanReadableFieldResponseValue";

describe("getHumanReadableFieldResponseValue", () => {
  const createSelectField = (
    options: Array<{ id: string; label: string }>
  ): Pick<Field, "type" | "options"> => ({
    type: "select",
    options,
  });

  const createMultiselectField = (
    options: Array<{ id: string; label: string }>
  ): Pick<Field, "type" | "options"> => ({
    type: "multiselect",
    options,
  });

  const createRadioField = (
    options: Array<{ id: string; label: string }>
  ): Pick<Field, "type" | "options"> => ({
    type: "radio",
    options,
  });

  describe("select fields", () => {
    it("should return option label for select field with single value", () => {
      const field = createSelectField([
        { id: "opt-1", label: "Option One" },
        { id: "opt-2", label: "Option Two" },
      ]);
      const value: FormResponse[string]["value"] = "opt-1";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Option One"]);
    });

    it("should handle select field when value is already a label (legacy)", () => {
      const field = createSelectField([
        { id: "opt-1", label: "Option One" },
        { id: "opt-2", label: "Option Two" },
      ]);
      const value: FormResponse[string]["value"] = "Option Two";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Option Two"]);
    });

    it("should return value as-is when option not found", () => {
      const field = createSelectField([{ id: "opt-1", label: "Option One" }]);
      const value: FormResponse[string]["value"] = "unknown-id";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["unknown-id"]);
    });
  });

  describe("multiselect fields", () => {
    it("should return option labels for multiselect field with array value", () => {
      const field = createMultiselectField([
        { id: "opt-1", label: "Option One" },
        { id: "opt-2", label: "Option Two" },
        { id: "opt-3", label: "Option Three" },
      ]);
      const value: FormResponse[string]["value"] = ["opt-1", "opt-3"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Option One", "Option Three"]);
    });

    it("should support legacy options with used to have labels directly", () => {
      const field = createMultiselectField([
        { id: "opt-1", label: "Option One" },
        { id: "opt-2", label: "Option Two" },
      ]);
      const value: FormResponse[string]["value"] = ["Option One", "Option Two", "unknown"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Option One", "Option Two", "unknown"]);
    });

    it("should handle single value for multiselect (edge case)", () => {
      const field = createMultiselectField([{ id: "opt-1", label: "Option One" }]);
      const value: FormResponse[string]["value"] = "opt-1";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Option One"]);
    });
  });

  describe("radio fields", () => {
    it("should return option label for radio field", () => {
      const field = createRadioField([
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ]);
      const value: FormResponse[string]["value"] = "yes";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Yes"]);
    });
  });

  describe("text and other fields", () => {
    it("should return value as string for text field", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "text",
      };
      const value: FormResponse[string]["value"] = "John Doe";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("John Doe");
    });

    it("should handle number field", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "number",
      };
      const value: FormResponse[string]["value"] = 42;

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["42"]);
    });

    it("should handle textarea field", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "textarea",
      };
      const value: FormResponse[string]["value"] = "Multi\nline\ntext";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("Multi\nline\ntext");
    });

    it("should handle array values for non-option fields", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "text",
      };
      const value: FormResponse[string]["value"] = ["value1", "value2"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["value1", "value2"]);
    });
  });

  describe("checkbox fields", () => {
    const createCheckboxField = (
      options: Array<{ id: string; label: string }>
    ): Pick<Field, "type" | "options"> => ({
      type: "checkbox",
      options,
    });

    it("should return option labels for checkbox field with array of selected option IDs", () => {
      const field = createCheckboxField([
        { id: "opt-a", label: "Morning" },
        { id: "opt-b", label: "Afternoon" },
        { id: "opt-c", label: "Evening" },
      ]);
      const value: FormResponse[string]["value"] = ["opt-a", "opt-c"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Morning", "Evening"]);
    });

    it("should return single option label for checkbox field with one selection", () => {
      const field = createCheckboxField([
        { id: "opt-a", label: "Morning" },
        { id: "opt-b", label: "Afternoon" },
      ]);
      const value: FormResponse[string]["value"] = ["opt-a"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Morning"]);
    });

    it("should handle checkbox field with unknown option IDs (fallback to IDs)", () => {
      const field = createCheckboxField([{ id: "opt-a", label: "Morning" }]);
      const value: FormResponse[string]["value"] = ["opt-a", "unknown-id"];

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["Morning", "unknown-id"]);
    });
  });

  describe("url fields", () => {
    it("should return the URL string as-is", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "url",
      };
      const value: FormResponse[string]["value"] = "https://example.com/page";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("https://example.com/page");
    });

    it("should handle empty URL value", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "url",
      };
      const value: FormResponse[string]["value"] = "";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("");
    });
  });

  describe("date fields", () => {
    it("should return the date string as-is", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "date",
      };
      const value: FormResponse[string]["value"] = "2025-03-15";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("2025-03-15");
    });

    it("should handle ISO date string with time component", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "date",
      };
      const value: FormResponse[string]["value"] = "2025-03-15T10:30:00Z";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("2025-03-15T10:30:00Z");
    });
  });

  describe("edge cases", () => {
    it("should handle numeric values in options", () => {
      const field = createSelectField([
        { id: "1", label: "First" },
        { id: "2", label: "Second" },
      ]);
      const value: FormResponse[string]["value"] = 1;

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["First"]);
    });

    it("should handle empty string value", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "text",
      };
      const value: FormResponse[string]["value"] = "";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("");
    });

    it("should handle field with empty options array", () => {
      const field = createSelectField([]);
      const value: FormResponse[string]["value"] = "some-value";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual(["some-value"]);
    });

    it("should handle field with undefined options", () => {
      const field: Pick<Field, "type" | "options"> = {
        type: "select",
        options: undefined,
      };
      const value: FormResponse[string]["value"] = "some-value";

      const result = getHumanReadableFieldResponseValue({ field, value });

      expect(result).toEqual("some-value");
    });
  });
});
