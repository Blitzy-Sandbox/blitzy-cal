import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { WEBAPP_URL } from "@calcom/lib/constants";
import { prisma } from "@calcom/prisma";
import { test } from "@calcom/web/playwright/lib/fixtures";
import { gotoRoutingLink } from "@calcom/web/playwright/lib/testUtils";

import {
  addForm,
  saveCurrentForm,
  verifySelectOptions,
  addOneFieldAndDescriptionAndSaveForm,
  addFieldByType,
  fillFormFieldByType,
} from "./testUtils";

// ---------------------------------------------------------------------------
// Constants — Field Type Categorization
// ---------------------------------------------------------------------------

/** All routing form field types, including Calendly-parity additions (RF-003). */
const ALL_FIELD_TYPES = [
  "Checkbox",
  "Date",
  "Email",
  "Long text",
  "Multiple choice selection",
  "Number",
  "Phone",
  "Single-choice selection",
  "Short text",
  "URL",
] as const;

/** New field types introduced for Calendly question-type parity. */
const NEW_PARITY_FIELD_TYPES = ["Checkbox", "Date", "URL"] as const;

/** Field types that require option configuration during creation. */
const OPTION_BASED_TYPES: readonly string[] = [
  "Single-choice selection",
  "Multiple choice selection",
  "Checkbox",
];

/** Default option values used when creating option-based fields. */
const TEST_OPTIONS = ["Option A", "Option B", "Option C", "Option D"];

// ---------------------------------------------------------------------------
// Type Definitions — Database Field Shapes
// ---------------------------------------------------------------------------

/** Shape of a routing form field as persisted in the JSON `fields` column. */
interface FormFieldData {
  id: string;
  label: string;
  identifier?: string;
  type: string;
  required?: boolean;
  options?: Array<{ id: string | null; label: string }>;
}

// ---------------------------------------------------------------------------
// Local Helper Functions
// ---------------------------------------------------------------------------

/**
 * Clicks the "Add route" button in the route builder view.
 * Mirrors the `addNewRoute` helper used in basic.e2e.ts.
 */
async function addNewRoute(page: Page): Promise<void> {
  await page.locator('[data-testid="add-route-button"]').click();
}

/**
 * Selects an option from a React Select dropdown by 1-based index.
 * Mirrors the `selectOption` helper used in basic.e2e.ts.
 */
async function selectOption({
  page,
  selector,
  option,
}: {
  page: Page;
  selector: { selector: string; nth: number };
  /** 1-based index of the option to select. */
  option: number;
}): Promise<void> {
  const locatorForSelect = page.locator(selector.selector).nth(selector.nth);
  await locatorForSelect.click();
  await locatorForSelect
    .locator('[id*="react-select-"][aria-disabled]')
    .nth(option - 1)
    .click();
}

/**
 * Creates a routing form with a single field and an external redirect route.
 *
 * The flow:
 * 1. Create form via `addForm`
 * 2. Add one field with the given type and explicit identifier
 * 3. Save the form
 * 4. Navigate to the route builder and add an external-redirect route
 * 5. Save the form again
 *
 * @returns The form ID for subsequent operations.
 */
async function createFormWithFieldAndExternalRedirect(
  page: Page,
  fieldConfig: {
    label: string;
    fieldType: string;
    identifier: string;
    options?: string[];
  }
): Promise<string> {
  const formId = await addForm(page);

  // After addForm the form-edit page already has one default field at index 0.
  // Configure it directly — no need to click "add-field" for the first field.
  await addFieldByType(page, {
    fieldIndex: 0,
    label: fieldConfig.label,
    fieldType: fieldConfig.fieldType,
    options: fieldConfig.options,
  });

  // Set an explicit identifier for reliable data-testid targeting
  await page.fill('[name="fields.0.identifier"]', fieldConfig.identifier);

  await saveCurrentForm(page);

  // Navigate to the route builder (desktop toggle)
  await page.locator('[data-testid="toggle-group-item-route-builder"]').nth(1).click();
  await page.waitForURL("/routing/route-builder/**");

  await addNewRoute(page);

  // Select "External Redirect URL" action (option index 2)
  await selectOption({
    selector: { selector: ".data-testid-select-routing-action", nth: 0 },
    option: 2,
    page,
  });

  await page.fill("[name=externalRedirectUrl]", `${WEBAPP_URL}/pro`);
  await saveCurrentForm(page);

  return formId;
}

/**
 * Reads the persisted field definitions for a routing form from the database.
 */
async function getFormFields(formId: string): Promise<FormFieldData[]> {
  const form = await prisma.app_RoutingForms_Form.findUniqueOrThrow({
    where: { id: formId },
  });
  return (form.fields as unknown as FormFieldData[]) || [];
}

/**
 * Marks the first field of a routing form as required via direct database update.
 * This is used for validation tests that verify required-field enforcement.
 */
async function setFirstFieldRequired(formId: string): Promise<void> {
  const form = await prisma.app_RoutingForms_Form.findUniqueOrThrow({
    where: { id: formId },
  });
  const fields = (form.fields as unknown as FormFieldData[]) || [];
  if (fields.length === 0) {
    throw new Error(`No fields found on form ${formId}`);
  }
  fields[0].required = true;
  // Prisma JSON columns accept plain serializable objects
  await prisma.app_RoutingForms_Form.update({
    where: { id: formId },
    data: { fields: JSON.parse(JSON.stringify(fields)) },
  });
}

// ===========================================================================
// Main Test Suite
// ===========================================================================

test.describe("Field Type Parity - Calendly Question Types", () => {
  test.beforeEach(async ({ users }) => {
    const user = await users.create(
      { username: "routing-forms" },
      { hasTeam: true }
    );
    await user.apiLogin();
  });

  test.afterEach(async ({ users }) => {
    // Cascade-deletes forms created by the user
    await users.deleteAll();
  });

  // =========================================================================
  // Block 1 — Field Type Creation
  // =========================================================================

  test.describe("Field type creation", () => {
    test("should create form with each existing field type", async ({ page }) => {
      await addForm(page);

      // After addForm, a default field at index 0 already exists.
      // Configure it, then add subsequent fields one at a time.
      for (let i = 0; i < ALL_FIELD_TYPES.length; i++) {
        const fieldType = ALL_FIELD_TYPES[i];

        if (i > 0) {
          await page.click('[data-testid="add-field"]');
        }

        await addFieldByType(page, {
          fieldIndex: i,
          label: `Test ${fieldType}`,
          fieldType,
          options: OPTION_BASED_TYPES.includes(fieldType) ? TEST_OPTIONS : undefined,
        });
      }

      await saveCurrentForm(page);

      // Verify all 10 fields were persisted
      await expect(page.locator('[data-testid="field"]')).toHaveCount(ALL_FIELD_TYPES.length);
    });

    test("should create form with Calendly-parity field types", async ({ page }) => {
      await addForm(page);

      // Default field at index 0 already exists after addForm
      for (let i = 0; i < NEW_PARITY_FIELD_TYPES.length; i++) {
        const fieldType = NEW_PARITY_FIELD_TYPES[i];

        if (i > 0) {
          await page.click('[data-testid="add-field"]');
        }

        await addFieldByType(page, {
          fieldIndex: i,
          label: `Parity ${fieldType}`,
          fieldType,
          options: fieldType === "Checkbox" ? TEST_OPTIONS : undefined,
        });
      }

      await saveCurrentForm(page);

      // Verify all 3 new parity fields were created
      await expect(page.locator('[data-testid="field"]')).toHaveCount(NEW_PARITY_FIELD_TYPES.length);
    });

    test("should verify all field types appear in dropdown", async ({ page }) => {
      await addForm(page);

      // Default field at index 0 already exists — verify its field-type dropdown
      await verifySelectOptions(
        { selector: ".data-testid-field-type", nth: 0 },
        [...ALL_FIELD_TYPES],
        page
      );
    });

    test("should create form with single field using description helper", async ({ page }) => {
      const formName = "Parity Description Test";
      const formId = await addForm(page, { name: formName });

      // Exercise the addOneFieldAndDescriptionAndSaveForm helper which
      // internally navigates to form-edit, verifies the full dropdown options,
      // selects a field type by typeIndex, fills the label, and saves.
      // typeIndex 2 = "Email" (alphabetical position in the 10-type list)
      await addOneFieldAndDescriptionAndSaveForm(formId, page, {
        name: formName,
        description: "RF-003 Parity Test Form",
        field: { label: "Parity Email Field", typeIndex: 2 },
      });

      // Verify the form was saved — the helper adds one field beyond any
      // default field, so at least 1 field should be visible.
      await expect(page.locator('[data-testid="field"]')).toHaveCount(2);
    });
  });

  // =========================================================================
  // Block 2 — Field Type Submission
  // =========================================================================

  test.describe("Field type submission", () => {
    test("should submit form with text-type fields", async ({ page }) => {
      const formId = await addForm(page);

      // Define the text-like fields to add with explicit identifiers and test values
      const textFields = [
        { type: "Short text" as const, identifier: "short-text", value: "Hello World" },
        { type: "Email" as const, identifier: "test-email", value: "test@example.com" },
        { type: "Number" as const, identifier: "test-number", value: "42" },
        { type: "Phone" as const, identifier: "test-phone", value: "+1234567890" },
        { type: "URL" as const, identifier: "test-url", value: "https://cal.com" },
      ];

      // Default field at index 0 already exists after addForm
      for (let i = 0; i < textFields.length; i++) {
        if (i > 0) {
          await page.click('[data-testid="add-field"]');
        }

        await addFieldByType(page, {
          fieldIndex: i,
          label: textFields[i].type,
          fieldType: textFields[i].type,
        });
        await page.fill(`[name="fields.${i}.identifier"]`, textFields[i].identifier);
      }

      await saveCurrentForm(page);

      // Navigate to route builder and add external redirect route
      await page.locator('[data-testid="toggle-group-item-route-builder"]').nth(1).click();
      await page.waitForURL("/routing/route-builder/**");
      await addNewRoute(page);
      await selectOption({
        selector: { selector: ".data-testid-select-routing-action", nth: 0 },
        option: 2,
        page,
      });
      await page.fill("[name=externalRedirectUrl]", `${WEBAPP_URL}/pro`);
      await saveCurrentForm(page);

      // Navigate to the public form and fill all fields
      await gotoRoutingLink({ page, formId });

      for (const field of textFields) {
        await fillFormFieldByType(page, {
          identifier: field.identifier,
          fieldType: field.type,
          value: field.value,
        });
      }

      await page.click('button[type="submit"]');

      // Verify redirect to the external URL
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));

      // Verify query parameters carry submitted values
      const resultUrl = new URL(page.url());
      expect(resultUrl.searchParams.get("short-text")).toBe("Hello World");
      expect(resultUrl.searchParams.get("test-email")).toBe("test@example.com");
      expect(resultUrl.searchParams.get("test-number")).toBe("42");
    });

    test("should submit form with selection-type fields", async ({ page }) => {
      const formId = await addForm(page);

      // Default field at index 0 already exists — configure as Single-choice selection
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Select Field",
        fieldType: "Single-choice selection",
        options: ["Alpha", "Beta", "Gamma", "Delta"],
      });
      await page.fill('[name="fields.0.identifier"]', "select-field");
      await saveCurrentForm(page);

      // Set up external redirect route
      await page.locator('[data-testid="toggle-group-item-route-builder"]').nth(1).click();
      await page.waitForURL("/routing/route-builder/**");
      await addNewRoute(page);
      await selectOption({
        selector: { selector: ".data-testid-select-routing-action", nth: 0 },
        option: 2,
        page,
      });
      await page.fill("[name=externalRedirectUrl]", `${WEBAPP_URL}/pro`);
      await saveCurrentForm(page);

      // Navigate to public form and select an option
      await gotoRoutingLink({ page, formId });

      await fillFormFieldByType(page, {
        identifier: "select-field",
        fieldType: "Single-choice selection",
        value: "Beta",
      });

      await page.click('button[type="submit"]');

      // Verify redirect
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));
    });

    test("should submit form with new Calendly-parity fields", async ({ page }) => {
      const formId = await addForm(page);

      // Default field at index 0 — configure as URL
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Website URL",
        fieldType: "URL",
      });
      await page.fill('[name="fields.0.identifier"]', "website-url");

      // Add a second field for Date
      await page.click('[data-testid="add-field"]');
      await addFieldByType(page, {
        fieldIndex: 1,
        label: "Preferred Date",
        fieldType: "Date",
      });
      await page.fill('[name="fields.1.identifier"]', "preferred-date");

      await saveCurrentForm(page);

      // Set up external redirect route
      await page.locator('[data-testid="toggle-group-item-route-builder"]').nth(1).click();
      await page.waitForURL("/routing/route-builder/**");
      await addNewRoute(page);
      await selectOption({
        selector: { selector: ".data-testid-select-routing-action", nth: 0 },
        option: 2,
        page,
      });
      await page.fill("[name=externalRedirectUrl]", `${WEBAPP_URL}/pro`);
      await saveCurrentForm(page);

      // Navigate to public form and fill both fields
      await gotoRoutingLink({ page, formId });

      await fillFormFieldByType(page, {
        identifier: "website-url",
        fieldType: "URL",
        value: "https://cal.com",
      });
      await fillFormFieldByType(page, {
        identifier: "preferred-date",
        fieldType: "Date",
        value: "2025-06-15",
      });

      await page.click('button[type="submit"]');

      // Verify redirect and query parameter propagation
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));

      const resultUrl = new URL(page.url());
      expect(resultUrl.searchParams.get("website-url")).toBe("https://cal.com");
    });
  });

  // =========================================================================
  // Block 3 — Field Type Validation
  // =========================================================================

  test.describe("Field type validation", () => {
    test("required field enforcement per type", async ({ page }) => {
      // Create form with a short text field and external redirect
      const formId = await createFormWithFieldAndExternalRedirect(page, {
        label: "Required Text",
        fieldType: "Short text",
        identifier: "required-text",
      });

      // Mark the field as required via direct database update
      await setFirstFieldRequired(formId);

      // Navigate to the public form
      await gotoRoutingLink({ page, formId });

      // Attempt to submit without filling the required field
      await page.click('button[type="submit"]');

      // HTML5 validation should flag the input as value-missing
      const firstInputMissingValue = await page.evaluate(() => {
        const input = document.querySelectorAll("input")[0];
        return input ? input.validity.valueMissing : false;
      });
      expect(firstInputMissingValue).toBe(true);

      // The submit button should still be enabled (HTML5 validation prevents submission,
      // but does not disable the button)
      await expect(page.locator('button[type="submit"][disabled]')).toHaveCount(0);
    });

    test("email format validation", async ({ page }) => {
      const formId = await createFormWithFieldAndExternalRedirect(page, {
        label: "Email Address",
        fieldType: "Email",
        identifier: "email-addr",
      });

      await gotoRoutingLink({ page, formId });

      // Fill with an invalid email format
      await fillFormFieldByType(page, {
        identifier: "email-addr",
        fieldType: "Email",
        value: "not-an-email",
      });

      await page.click('button[type="submit"]');

      // HTML5 email input reports type-mismatch for invalid formats
      const emailTypeMismatch = await page.evaluate(() => {
        const emailInputs = document.querySelectorAll('input[type="email"]');
        if (emailInputs.length > 0) {
          return (emailInputs[0] as HTMLInputElement).validity.typeMismatch;
        }
        // Fallback: check the first input
        const firstInput = document.querySelectorAll("input")[0];
        return firstInput ? firstInput.validity.typeMismatch : false;
      });
      expect(emailTypeMismatch).toBe(true);

      // Clear and fill with a valid email
      await page.fill('[data-testid="form-field-email-addr"]', "");
      await fillFormFieldByType(page, {
        identifier: "email-addr",
        fieldType: "Email",
        value: "valid@email.com",
      });

      await page.click('button[type="submit"]');

      // Verify successful submission via redirect
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));
    });

    test("phone format validation", async ({ page }) => {
      const formId = await createFormWithFieldAndExternalRedirect(page, {
        label: "Phone Number",
        fieldType: "Phone",
        identifier: "phone-num",
      });

      await gotoRoutingLink({ page, formId });

      // Fill with a valid international phone number
      await fillFormFieldByType(page, {
        identifier: "phone-num",
        fieldType: "Phone",
        value: "+12125551234",
      });

      await page.click('button[type="submit"]');

      // Verify successful submission
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));
    });

    test("number type accepts only numeric values", async ({ page }) => {
      const formId = await createFormWithFieldAndExternalRedirect(page, {
        label: "Age",
        fieldType: "Number",
        identifier: "age-field",
      });

      await gotoRoutingLink({ page, formId });

      // Fill with a valid numeric value
      await fillFormFieldByType(page, {
        identifier: "age-field",
        fieldType: "Number",
        value: "123",
      });

      await page.click('button[type="submit"]');

      // Verify successful submission
      await page.waitForURL((url) => url.pathname.endsWith("/pro"));
    });
  });

  // =========================================================================
  // Block 4 — Field Type Routing
  // =========================================================================

  test.describe("Field type routing", () => {
    test("text-based routing (equals)", async ({ page }) => {
      // Create form — default field at index 0 exists after addForm
      const formId = await addForm(page);
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Keyword",
        fieldType: "Short text",
      });
      await page.fill('[name="fields.0.identifier"]', "keyword");
      await saveCurrentForm(page);

      // Retrieve the auto-generated field UUID from the database
      const fields = await getFormFields(formId);
      const fieldId = fields[0].id;

      // Seed routes with a text-equals condition via direct database update
      await prisma.app_RoutingForms_Form.update({
        where: { id: formId },
        data: {
          routes: [
            {
              id: "route-text-match",
              action: { type: "customPageMessage", value: "Text Match Found" },
              queryValue: {
                id: "qv-text-match",
                type: "group",
                children1: {
                  "rule-text-eq": {
                    type: "rule",
                    properties: {
                      field: fieldId,
                      value: ["keyword-match"],
                      operator: "equal",
                      valueSrc: ["value"],
                      valueType: ["text"],
                      valueError: [null],
                    },
                  },
                },
              },
            },
            {
              id: "route-text-fallback",
              action: { type: "customPageMessage", value: "Text Fallback" },
              isFallback: true,
              queryValue: { id: "qv-text-fallback", type: "group" },
            },
          ],
        },
      });

      // Test matching: the keyword "keyword-match" should hit the first route
      await page.goto(`/router?form=${formId}&keyword=keyword-match`);
      await expect(page.locator("text=Text Match Found")).toBeVisible({ timeout: 10000 });

      // Test non-matching: an unrecognised value should fall through to the fallback
      await page.goto(`/router?form=${formId}&keyword=other-value`);
      await expect(page.locator("text=Text Fallback")).toBeVisible({ timeout: 10000 });
    });

    test("numeric routing (equals)", async ({ page }) => {
      const formId = await addForm(page);
      // Default field at index 0 — configure as Number
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Score",
        fieldType: "Number",
      });
      await page.fill('[name="fields.0.identifier"]', "score");
      await saveCurrentForm(page);

      const fields = await getFormFields(formId);
      const fieldId = fields[0].id;

      await prisma.app_RoutingForms_Form.update({
        where: { id: formId },
        data: {
          routes: [
            {
              id: "route-num-match",
              action: { type: "customPageMessage", value: "Number Match" },
              queryValue: {
                id: "qv-num-match",
                type: "group",
                children1: {
                  "rule-num-eq": {
                    type: "rule",
                    properties: {
                      field: fieldId,
                      value: [100],
                      operator: "equal",
                      valueSrc: ["value"],
                      valueType: ["number"],
                      valueError: [null],
                    },
                  },
                },
              },
            },
            {
              id: "route-num-fallback",
              action: { type: "customPageMessage", value: "Number Fallback" },
              isFallback: true,
              queryValue: { id: "qv-num-fallback", type: "group" },
            },
          ],
        },
      });

      // Matching: score = 100
      await page.goto(`/router?form=${formId}&score=100`);
      await expect(page.locator("text=Number Match")).toBeVisible({ timeout: 10000 });

      // Non-matching: score = 50
      await page.goto(`/router?form=${formId}&score=50`);
      await expect(page.locator("text=Number Fallback")).toBeVisible({ timeout: 10000 });
    });

    test("select-based routing (option matching)", async ({ page }) => {
      const formId = await addForm(page);
      // Default field at index 0 — configure as Single-choice selection
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Priority",
        fieldType: "Single-choice selection",
        options: ["High", "Medium", "Low", "None"],
      });
      await page.fill('[name="fields.0.identifier"]', "priority");
      await saveCurrentForm(page);

      // Read the persisted field to obtain option UUIDs
      const fields = await getFormFields(formId);
      const fieldId = fields[0].id;
      const fieldOptions = fields[0].options || [];
      const highOption = fieldOptions.find((opt) => opt.label === "High");
      const lowOption = fieldOptions.find((opt) => opt.label === "Low");

      if (!highOption || !highOption.id) {
        throw new Error("High option not found or missing id in persisted field options");
      }

      await prisma.app_RoutingForms_Form.update({
        where: { id: formId },
        data: {
          routes: [
            {
              id: "route-select-match",
              action: { type: "customPageMessage", value: "High Priority" },
              queryValue: {
                id: "qv-select-match",
                type: "group",
                children1: {
                  "rule-select-eq": {
                    type: "rule",
                    properties: {
                      field: fieldId,
                      value: [highOption.id],
                      operator: "select_equals",
                      valueSrc: ["value"],
                      valueType: ["select"],
                      valueError: [null],
                    },
                  },
                },
              },
            },
            {
              id: "route-select-fallback",
              action: { type: "customPageMessage", value: "Select Fallback" },
              isFallback: true,
              queryValue: { id: "qv-select-fallback", type: "group" },
            },
          ],
        },
      });

      // Matching: priority = High (using the option ID)
      await page.goto(`/router?form=${formId}&priority=${highOption.id}`);
      await expect(page.locator("text=High Priority")).toBeVisible({ timeout: 10000 });

      // Non-matching: priority = Low
      if (lowOption?.id) {
        await page.goto(`/router?form=${formId}&priority=${lowOption.id}`);
        await expect(page.locator("text=Select Fallback")).toBeVisible({ timeout: 10000 });
      }
    });

    test("multiselect-based routing (multiselect_equals)", async ({ page }) => {
      const formId = await addForm(page);
      // Default field at index 0 — configure as Multiple choice selection
      await addFieldByType(page, {
        fieldIndex: 0,
        label: "Tags",
        fieldType: "Multiple choice selection",
        options: ["Tag1", "Tag2", "Tag3", "Tag4"],
      });
      await page.fill('[name="fields.0.identifier"]', "tags");
      await saveCurrentForm(page);

      const fields = await getFormFields(formId);
      const fieldId = fields[0].id;
      const fieldOptions = fields[0].options || [];
      const tag1Option = fieldOptions.find((opt) => opt.label === "Tag1");
      const tag3Option = fieldOptions.find((opt) => opt.label === "Tag3");

      if (!tag1Option || !tag1Option.id) {
        throw new Error("Tag1 option not found or missing id in persisted field options");
      }

      await prisma.app_RoutingForms_Form.update({
        where: { id: formId },
        data: {
          routes: [
            {
              id: "route-multi-match",
              action: { type: "customPageMessage", value: "Multiselect Match" },
              queryValue: {
                id: "qv-multi-match",
                type: "group",
                children1: {
                  "rule-multi-eq": {
                    type: "rule",
                    properties: {
                      field: fieldId,
                      value: [[tag1Option.id]],
                      operator: "multiselect_equals",
                      valueSrc: ["value"],
                      valueType: ["multiselect"],
                      valueError: [null],
                    },
                  },
                },
              },
            },
            {
              id: "route-multi-fallback",
              action: { type: "customPageMessage", value: "Multiselect Fallback" },
              isFallback: true,
              queryValue: { id: "qv-multi-fallback", type: "group" },
            },
          ],
        },
      });

      // Matching: tags = Tag1
      await page.goto(`/router?form=${formId}&tags=${tag1Option.id}`);
      await expect(page.locator("text=Multiselect Match")).toBeVisible({ timeout: 10000 });

      // Non-matching: tags = Tag3
      if (tag3Option?.id) {
        await page.goto(`/router?form=${formId}&tags=${tag3Option.id}`);
        await expect(page.locator("text=Multiselect Fallback")).toBeVisible({ timeout: 10000 });
      }
    });
  });
});
