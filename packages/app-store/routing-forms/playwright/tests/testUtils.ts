import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function addForm(
  page: Page,
  {
    name = "Test Form Name",
    forTeam,
  }: {
    name?: string;
    forTeam?: boolean;
  } = {}
) {
  await page.goto(`/routing-forms/forms`);
  await page.click('[data-testid="new-routing-form"]');

  if (forTeam) {
    await page.click('[data-testid="option-team-1"]');
  } else {
    await page.click('[data-testid="option-0"]');
  }

  await page.fill("input[name]", name);
  await page.click('[data-testid="add-form"]');
  await page.waitForSelector('[data-testid="add-field"]');
  const url = page.url();
  const formId = new URL(url).pathname.split("/").at(-1);
  if (!formId) {
    throw new Error("Form ID couldn't be determined from url");
  }
  return formId;
}

export async function addOneFieldAndDescriptionAndSaveForm(
  formId: string,
  page: Page,
  form: { name: string; description?: string; field?: { typeIndex: number; label: string } }
) {
  await page.goto(`apps/routing-forms/form-edit/${formId}`);
  await expect(page.locator('[name="name"]')).toHaveValue(form.name);
  await page.click('[data-testid="add-field"]');
  if (form.description) {
    await page.fill('[data-testid="description"]', form.description);
  }

  // Verify all Options of SelectBox
  const { optionsInUi: types } = await verifySelectOptions(
    { selector: ".data-testid-field-type", nth: 0 },
    ["Checkbox", "Date", "Email", "Long text", "Multiple choice selection", "Number", "Phone", "Single-choice selection", "Short text", "URL"],
    page
  );

  const nextFieldIndex = (await page.locator('[data-testid="field"]').count()) - 1;

  if (form.field) {
    await page.fill(`[data-testid="fields.${nextFieldIndex}.label"]`, form.field.label);
    await page
      .locator('[data-testid="field"]')
      .nth(nextFieldIndex)
      .locator(".data-testid-field-type")
      .click();
    await page
      .locator('[data-testid="field"]')
      .nth(nextFieldIndex)
      .locator('[id*="react-select-"][aria-disabled]')
      .nth(form.field.typeIndex)
      .click();
  }
  await saveCurrentForm(page);
  return {
    types,
  };
}

export async function saveCurrentForm(page: Page) {
  await page.click('[data-testid="update-form"]');
  await page.waitForSelector(".data-testid-toast-success");
}

export async function verifySelectOptions(
  selector: { selector: string; nth: number },
  expectedOptions: string[],
  page: Page
) {
  await page.locator(selector.selector).nth(selector.nth).click();
  const selectOptions = await page
    .locator(selector.selector)
    .nth(selector.nth)
    .locator('[id*="react-select-"][aria-disabled]')
    .allInnerTexts();

  const sortedSelectOptions = [...selectOptions].sort();
  const sortedExpectedOptions = [...expectedOptions].sort();
  expect(sortedSelectOptions).toEqual(sortedExpectedOptions);
  return {
    optionsInUi: selectOptions,
  };
}

/**
 * Adds a field to the routing form builder at the specified index with the given type,
 * label, and optional pre-defined options.
 *
 * Follows the same interaction pattern as `addAllTypesOfFieldsAndSaveForm` in `basic.e2e.ts`.
 * Supports all Calendly-parity field types (RF-001, RF-003): Short text, Long text, Number,
 * Email, Phone, Single-choice selection, Multiple choice selection, Checkbox, URL, and Date.
 *
 * For option-based field types (Single-choice selection, Multiple choice selection, Checkbox),
 * provide the `options` array to populate the option inputs.
 */
export async function addFieldByType(
  page: Page,
  {
    fieldIndex,
    label,
    fieldType,
    options,
  }: {
    /** Zero-based index of the field within the form builder field list */
    fieldIndex: number;
    /** Display label for the field (also used to compute the identifier if not set explicitly) */
    label: string;
    /** Human-readable field type label as shown in the dropdown, e.g. "Short text", "Checkbox" */
    fieldType: string;
    /** Option values to populate for option-based field types (select, multiselect, checkbox) */
    options?: string[];
  }
): Promise<void> {
  // Click on the field type dropdown at the given field index to open it
  await page.locator(".data-testid-field-type").nth(fieldIndex).click();

  // Select the dropdown option matching the requested field type label
  await page
    .locator('[data-testid^="select-option-"]')
    .filter({ hasText: fieldType })
    .click();

  // Fill in the field label
  await page.fill(`[name="fields.${fieldIndex}.label"]`, label);

  // If options are provided, fill option inputs for types that support them.
  // The form builder renders pre-allocated option input slots for option-based field types
  // (Single-choice selection, Multiple choice selection, Checkbox).
  if (options && options.length > 0) {
    for (let i = 0; i < options.length; i++) {
      await page.fill(`[data-testid="fields.${fieldIndex}.options.${i}-input"]`, options[i]);
    }
  }
}

/**
 * Fills a form field during form submission based on the field type.
 *
 * Handles all Calendly-parity field types (RF-003):
 * - Text-like fields (Short text, Long text, Email, Phone, Number, URL, Date): direct input fill
 * - Single-choice selection / Multiple choice selection: React Select dropdown interaction
 * - Checkbox: native checkbox toggle via accessible role locator
 *
 * @param page — Playwright Page instance
 * @param identifier — the field identifier used in `data-testid="form-field-{identifier}"`
 * @param fieldType — the human-readable field type label (e.g. "Short text", "Checkbox")
 * @param value — the value to fill or select; for Checkbox, this is the option label to toggle
 */
export async function fillFormFieldByType(
  page: Page,
  {
    identifier,
    fieldType,
    value,
  }: {
    /** Field identifier, used in the form-field data-testid attribute */
    identifier: string;
    /** Human-readable field type label matching the dropdown options */
    fieldType: string;
    /** Value to fill or option label to select/toggle */
    value: string;
  }
): Promise<void> {
  const fieldSelector = `[data-testid="form-field-${identifier}"]`;

  switch (fieldType) {
    // Text-like input fields — direct fill via the data-testid selector
    case "Short text":
    case "Long text":
    case "Email":
    case "Phone":
    case "Number":
    case "URL":
    case "Date": {
      await page.fill(fieldSelector, value);
      break;
    }

    // React Select single-value dropdown — open then pick option by text
    case "Single-choice selection": {
      await page.locator(fieldSelector).click();
      const selectParent = page.locator(`:has(> ${fieldSelector})`);
      await selectParent.getByText(value, { exact: true }).click();
      break;
    }

    // React Select multi-value dropdown — open then pick option by text
    case "Multiple choice selection": {
      await page.locator(fieldSelector).click();
      const multiSelectParent = page.locator(`:has(> ${fieldSelector})`);
      await multiSelectParent.getByText(value, { exact: true }).click();
      break;
    }

    // Native checkbox group — locate the checkbox by its accessible label and toggle
    case "Checkbox": {
      // CheckboxGroupWidget renders <label> elements wrapping <input type="checkbox">.
      // The accessible name of each checkbox is derived from the label text.
      // Use getByRole with the option label to robustly locate the correct checkbox.
      await page.getByRole("checkbox", { name: value }).click();
      break;
    }

    default:
      throw new Error(`fillFormFieldByType: unsupported field type "${fieldType}"`);
  }
}
