import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { uuid } from "short-uuid";

import { prisma } from "@calcom/prisma";
import { AttributeType, SchedulingType } from "@calcom/prisma/enums";
import type { Fixtures } from "@calcom/web/playwright/lib/fixtures";
import { test } from "@calcom/web/playwright/lib/fixtures";

/** Recursive JSON-compatible value type used for RAQB queryValue structures passed to Prisma's Json fields. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function setupTest({
  users,
  attributeType,
  options,
  assigned,
  condition,
  fields: customFields,
  routeQueryValue,
}: {
  users: Fixtures["users"];
  attributeType: AttributeType;
  options?: string[];
  assigned: string[];
  condition: {
    operator: string;
    value: unknown[];
    valueSrc?: string[];
    valueType: string[];
    valueError?: (null | string)[];
  };
  /** Optional form field definitions to add to the routing form. Defaults to empty (no fields). */
  fields?: Array<{
    id: string;
    label: string;
    identifier: string;
    type: string;
    required?: boolean;
    options?: Array<{ id: string | null; label: string }>;
  }>;
  /** Optional RAQB queryValue for form-field-based routing conditions. Defaults to an empty group (matches all). */
  routeQueryValue?: { [key: string]: JsonValue };
}) {
  const user = await users.create(
    { username: "routing-forms" },
    { hasTeam: true, isOrg: true, hasSubteam: true, schedulingType: SchedulingType.ROUND_ROBIN }
  );
  const orgMembership = await user.getOrgMembership();
  const teamMembership = await user.getFirstTeamMembership();
  const team = teamMembership.team;
  const eventType = await user.getFirstTeamEvent(team.id, SchedulingType.ROUND_ROBIN);

  const attrSlug = `attr-${uuid()}`;
  const attribute = await prisma.attribute.create({
    data: {
      teamId: orgMembership.teamId,
      type: attributeType,
      name: `Attr-${attrSlug}`,
      slug: attrSlug,
      ...(options?.length
        ? {
            options: {
              create: options.map((opt) => ({
                slug: String(opt).toLowerCase().replace(/ /g, "-"),
                value: String(opt),
              })),
            },
          }
        : {}),
    },
    include: { options: true },
  });

  for (const val of assigned) {
    const opt = attribute.options.find((o) => o.value === val);
    if (opt) {
      await prisma.attributeToUser.create({
        data: {
          member: {
            connect: { userId_teamId: { userId: user.id, teamId: orgMembership.teamId } },
          },
          attributeOption: { connect: { id: opt.id } },
        },
      });
    }
  }

  const resolvedValue = [...condition.value];
  if (attributeType === AttributeType.SINGLE_SELECT && resolvedValue.length > 0) {
    for (let i = 0; i < resolvedValue.length; i++) {
      const opt = attribute.options.find((o) => o.value === String(resolvedValue[i]));
      if (opt) resolvedValue[i] = opt.id;
    }
  } else if (
    attributeType === AttributeType.MULTI_SELECT &&
    resolvedValue.length > 0 &&
    Array.isArray(resolvedValue[0])
  ) {
    resolvedValue[0] = (resolvedValue[0] as string[]).map((v) => {
      const opt = attribute.options.find((o) => o.value === String(v));
      return opt ? opt.id : v;
    });
  }

  const formId = uuid();
  await prisma.app_RoutingForms_Form.create({
    data: {
      id: formId,
      name: "Attribute Routing Test",
      routes: [
        {
          id: uuid(),
          action: {
            type: "eventTypeRedirectUrl",
            value: `team/${team.slug}/${eventType.slug}`,
            eventTypeId: eventType.id,
          },
          queryValue: routeQueryValue || { id: uuid(), type: "group" },
          attributesQueryValue: {
            id: uuid(),
            type: "group",
            children1: {
              [uuid()]: {
                type: "rule",
                properties: {
                  field: attribute.id,
                  value: resolvedValue,
                  operator: condition.operator,
                  valueSrc: condition.valueSrc || ["value"],
                  valueType: condition.valueType,
                  valueError: condition.valueError || [null],
                },
              },
            },
          },
        },
        {
          id: uuid(),
          action: { type: "customPageMessage", value: "Fallback Message" },
          isFallback: true,
          queryValue: { id: uuid(), type: "group" },
        },
      ],
      fields: customFields || [],
      team: { connect: { id: team.id } },
      user: { connect: { id: user.id } },
    },
  });

  await user.apiLogin();
  return { formId, user, attribute };
}

async function openPreview(page: Page, formId: string) {
  await page.goto(`apps/routing-forms/route-builder/${formId}`);
  await page.click('[data-testid="preview-button"]');
}

function getMutationResponsePromise(page: Page) {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes("findTeamMembersMatchingAttributeLogicOfRoute") && resp.status() === 200
  );
}

async function getRoutedTeamMemberIds(page: Page) {
  const responsePromise = getMutationResponsePromise(page);
  await page.click('[data-testid="submit-button"]');
  const response = await responsePromise;
  const json = await response.json();
  const data = json[0]?.result?.data;
  const eventTypeRedirectUrl: string = data?.json?.eventTypeRedirectUrl ?? data?.eventTypeRedirectUrl;
  expect(eventTypeRedirectUrl).toBeTruthy();
  const url = new URL(eventTypeRedirectUrl);
  return url.searchParams.get("cal.routedTeamMemberIds") ?? "";
}

async function expectRoutedToUser(page: Page, userId: number) {
  const routedIds = await getRoutedTeamMemberIds(page);
  expect(routedIds).toContain(String(userId));
  await expect(page.locator('[data-testid="attribute-logic-matched"]')).toHaveText("Yes");
  await page.waitForSelector("text=@example.com");
}

async function expectNotRoutedToUser(page: Page) {
  const routedIds = await getRoutedTeamMemberIds(page);
  expect(routedIds).toBe("");
  await expect(page.locator('[data-testid="attribute-logic-matched"]')).toHaveText("No");
}

async function closeResults(page: Page) {
  await page.click('[data-testid="close-results-button"]');
}

/**
 * Fills a text-based form field in the route builder preview.
 * The field is identified by its `identifier` (or `label` if no identifier is set),
 * which maps to the `data-testid="form-field-{identifier}"` attribute rendered by FormInputFields.
 */
async function fillFormTextField(page: Page, fieldIdentifier: string, value: string) {
  await page.fill(`[data-testid="form-field-${fieldIdentifier}"]`, value);
}

/**
 * Asserts that the fallback route (customPageMessage) was chosen after submitting the preview form.
 * When the route's queryValue does not match the form response, the routing engine falls through
 * to the fallback route which displays the "Fallback Message" custom page.
 * Unlike `expectRoutedToUser`, this does NOT wait for the `findTeamMembersMatchingAttributeLogicOfRoute`
 * API call because customPageMessage routes bypass team member matching entirely.
 */
async function expectFallbackRouteChosen(page: Page) {
  await page.click('[data-testid="submit-button"]');
  await expect(page.locator('[data-testid="test-routing-result"]')).toHaveText("Fallback Message");
}

test.describe("Attribute Routing E2E - All Condition Combinations", () => {
  test.afterEach(async ({ users }) => {
    await users.deleteAll();
  });

  test.describe("SINGLE_SELECT conditions", () => {
    test("select_equals - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_equals", value: ["large"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("select_equals - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_equals", value: ["small"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("select_not_equals - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_not_equals", value: ["small"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("select_not_equals - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_not_equals", value: ["large"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("select_not_equals - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: [],
        condition: { operator: "select_not_equals", value: ["large"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });
  });

  test.describe("MULTI_SELECT conditions", () => {
    test("multiselect_some_in - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: ["JavaScript", "React"],
        condition: {
          operator: "multiselect_some_in",
          value: [["JavaScript", "Python"]],
          valueType: ["multiselect"],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("multiselect_some_in - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: ["JavaScript", "React"],
        condition: { operator: "multiselect_some_in", value: [["Python"]], valueType: ["multiselect"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("multiselect_not_some_in - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: ["JavaScript", "React"],
        condition: { operator: "multiselect_not_some_in", value: [["Python"]], valueType: ["multiselect"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("multiselect_equals - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: ["JavaScript", "React"],
        condition: {
          operator: "multiselect_equals",
          value: [["JavaScript", "React"]],
          valueType: ["multiselect"],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("multiselect_not_equals - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: ["JavaScript"],
        condition: {
          operator: "multiselect_not_equals",
          value: [["Python"]],
          valueType: ["multiselect"],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("multiselect_not_some_in - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: [],
        condition: { operator: "multiselect_not_some_in", value: [["Python"]], valueType: ["multiselect"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("multiselect_not_equals - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.MULTI_SELECT,
        options: ["JavaScript", "React", "Python"],
        assigned: [],
        condition: {
          operator: "multiselect_not_equals",
          value: [["Python"]],
          valueType: ["multiselect"],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });
  });

  test.describe("NUMBER conditions", () => {
    test("equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: { operator: "equal", value: [10], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("equal - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: { operator: "equal", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("not_equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: { operator: "not_equal", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("less - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["3"],
        assigned: ["3"],
        condition: { operator: "less", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("less_or_equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["5"],
        assigned: ["5"],
        condition: { operator: "less_or_equal", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("greater - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: { operator: "greater", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("greater_or_equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["5"],
        assigned: ["5"],
        condition: { operator: "greater_or_equal", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("between - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["3"],
        assigned: ["3"],
        condition: {
          operator: "between",
          value: [1, 5],
          valueSrc: ["value", "value"],
          valueType: ["number", "number"],
          valueError: [null, null],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("between - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: {
          operator: "between",
          value: [1, 5],
          valueSrc: ["value", "value"],
          valueType: ["number", "number"],
          valueError: [null, null],
        },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("not_between - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["10"],
        assigned: ["10"],
        condition: {
          operator: "not_between",
          value: [1, 5],
          valueSrc: ["value", "value"],
          valueType: ["number", "number"],
          valueError: [null, null],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("not_equal - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["5"],
        assigned: [],
        condition: { operator: "not_equal", value: [5], valueType: ["number"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("not_between - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.NUMBER,
        options: ["3"],
        assigned: [],
        condition: {
          operator: "not_between",
          value: [1, 5],
          valueSrc: ["value", "value"],
          valueType: ["number", "number"],
          valueError: [null, null],
        },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });
  });

  test.describe("TEXT conditions", () => {
    test("equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "equal", value: ["hello world"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("equal - no match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "equal", value: ["goodbye"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });

    test("not_equal - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "not_equal", value: ["goodbye"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("like (contains) - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "like", value: ["hello"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("not_like (not contains) - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "not_like", value: ["goodbye"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("not_equal - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: [],
        condition: { operator: "not_equal", value: ["goodbye"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("not_like - no attribute assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: [],
        condition: { operator: "not_like", value: ["goodbye"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("starts_with - match", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "starts_with", value: ["hello"], valueType: ["text"] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("is_empty - match when user has no assignment", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["some value"],
        assigned: [],
        condition: { operator: "is_empty", value: [], valueSrc: [], valueType: [], valueError: [] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("is_not_empty - match when value assigned", async ({ page, users }) => {
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.TEXT,
        options: ["hello world"],
        assigned: ["hello world"],
        condition: { operator: "is_not_empty", value: [], valueSrc: [], valueType: [], valueError: [] },
      });
      await openPreview(page, formId);
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });
  });

  test.describe("Fallback routing", () => {
    test("routes to fallback when no members match", async ({ page, users }) => {
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "small"],
        assigned: ["large"],
        condition: { operator: "select_equals", value: ["small"], valueType: ["select"] },
      });
      await openPreview(page, formId);
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });
  });

  /**
   * Answer-based routing conditions — Calendly parity tests (RF-001, RF-002)
   *
   * These tests validate Calendly-equivalent conditional routing patterns where routing
   * decisions are based on form field answers (queryValue), team member attributes
   * (attributesQueryValue), or a combination of both. This covers:
   *
   * 1. Form-field-only queryValue conditions (answer-based matching)
   * 2. Combined queryValue + attributesQueryValue conditions (both must match)
   * 3. Fallback behavior when queryValue conditions are not satisfied
   * 4. Dynamic {field:uuid} template syntax for attribute rules that reference form field values
   */
  test.describe("Answer-based routing conditions", () => {
    test("route matches when form field response equals expected value", async ({ page, users }) => {
      const fieldId = uuid();
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_equals", value: ["large"], valueType: ["select"] },
        fields: [
          {
            id: fieldId,
            label: "Company Size",
            identifier: "company-size",
            type: "text",
            required: true,
          },
        ],
        routeQueryValue: {
          id: uuid(),
          type: "group",
          children1: {
            [uuid()]: {
              type: "rule",
              properties: {
                field: fieldId,
                value: ["enterprise"],
                operator: "equal",
                valueSrc: ["value"],
                valueType: ["text"],
              },
            },
          },
        },
      });
      await openPreview(page, formId);
      await fillFormTextField(page, "company-size", "enterprise");
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("route does not match when form field response differs from expected value", async ({
      page,
      users,
    }) => {
      const fieldId = uuid();
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        condition: { operator: "select_equals", value: ["large"], valueType: ["select"] },
        fields: [
          {
            id: fieldId,
            label: "Company Size",
            identifier: "company-size",
            type: "text",
            required: true,
          },
        ],
        routeQueryValue: {
          id: uuid(),
          type: "group",
          children1: {
            [uuid()]: {
              type: "rule",
              properties: {
                field: fieldId,
                value: ["enterprise"],
                operator: "equal",
                valueSrc: ["value"],
                valueType: ["text"],
              },
            },
          },
        },
      });
      await openPreview(page, formId);
      // Fill in a non-matching value — queryValue condition fails, so the fallback route is selected
      await fillFormTextField(page, "company-size", "startup");
      await expectFallbackRouteChosen(page);
      await closeResults(page);
    });

    test("combined attribute and field conditions - both must match for routing", async ({
      page,
      users,
    }) => {
      const fieldId = uuid();
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        // Attribute condition: user must have "large" attribute
        condition: { operator: "select_equals", value: ["large"], valueType: ["select"] },
        fields: [
          {
            id: fieldId,
            label: "Industry",
            identifier: "industry",
            type: "text",
            required: true,
          },
        ],
        // Field condition: form response for "industry" must equal "technology"
        routeQueryValue: {
          id: uuid(),
          type: "group",
          children1: {
            [uuid()]: {
              type: "rule",
              properties: {
                field: fieldId,
                value: ["technology"],
                operator: "equal",
                valueSrc: ["value"],
                valueType: ["text"],
              },
            },
          },
        },
      });
      await openPreview(page, formId);
      // Fill in the matching field value — queryValue matches, and attribute also matches
      await fillFormTextField(page, "industry", "technology");
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("attribute matches but field condition fails - routes to fallback", async ({ page, users }) => {
      const fieldId = uuid();
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        // Attribute condition: user has "large" attribute → would match
        condition: { operator: "select_equals", value: ["large"], valueType: ["select"] },
        fields: [
          {
            id: fieldId,
            label: "Industry",
            identifier: "industry",
            type: "text",
            required: true,
          },
        ],
        // Field condition: form response must equal "technology"
        routeQueryValue: {
          id: uuid(),
          type: "group",
          children1: {
            [uuid()]: {
              type: "rule",
              properties: {
                field: fieldId,
                value: ["technology"],
                operator: "equal",
                valueSrc: ["value"],
                valueType: ["text"],
              },
            },
          },
        },
      });
      await openPreview(page, formId);
      // Fill in a non-matching field value — queryValue fails even though attribute would match
      await fillFormTextField(page, "industry", "healthcare");
      await expectFallbackRouteChosen(page);
      await closeResults(page);
    });

    test("fallback when form response does not match any route condition", async ({ page, users }) => {
      const fieldId = uuid();
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        // Attribute condition: expects "small" — user has "large" → wouldn't match
        condition: { operator: "select_equals", value: ["small"], valueType: ["select"] },
        fields: [
          {
            id: fieldId,
            label: "Region",
            identifier: "region",
            type: "text",
            required: true,
          },
        ],
        // Field condition: expects "emea"
        routeQueryValue: {
          id: uuid(),
          type: "group",
          children1: {
            [uuid()]: {
              type: "rule",
              properties: {
                field: fieldId,
                value: ["emea"],
                operator: "equal",
                valueSrc: ["value"],
                valueType: ["text"],
              },
            },
          },
        },
      });
      await openPreview(page, formId);
      // Neither field condition nor attribute condition matches — fallback is selected
      await fillFormTextField(page, "region", "apac");
      await expectFallbackRouteChosen(page);
      await closeResults(page);
    });

    test("dynamic field reference in attribute rules - match via {field:uuid} template", async ({
      page,
      users,
    }) => {
      const fieldId = uuid();
      const { formId, user } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        // Attribute condition uses {field:fieldId} template syntax:
        // the attribute rule's value is dynamically resolved from the form field response.
        // valueSrc: ["field"] indicates the value comes from a form field, not a static value.
        condition: {
          operator: "select_equals",
          value: [`{field:${fieldId}}`],
          valueSrc: ["field"],
          valueType: ["select"],
        },
        fields: [
          {
            id: fieldId,
            label: "Size Preference",
            identifier: "size-preference",
            type: "text",
            required: true,
          },
        ],
      });
      await openPreview(page, formId);
      // Fill in "large" — the {field:fieldId} template resolves to "large", which matches
      // the user's assigned attribute value "large"
      await fillFormTextField(page, "size-preference", "large");
      await expectRoutedToUser(page, user.id);
      await closeResults(page);
    });

    test("dynamic field reference in attribute rules - no match when field value differs", async ({
      page,
      users,
    }) => {
      const fieldId = uuid();
      const { formId } = await setupTest({
        users,
        attributeType: AttributeType.SINGLE_SELECT,
        options: ["large", "medium", "small"],
        assigned: ["large"],
        // Attribute condition uses {field:fieldId} template syntax
        condition: {
          operator: "select_equals",
          value: [`{field:${fieldId}}`],
          valueSrc: ["field"],
          valueType: ["select"],
        },
        fields: [
          {
            id: fieldId,
            label: "Size Preference",
            identifier: "size-preference",
            type: "text",
            required: true,
          },
        ],
      });
      await openPreview(page, formId);
      // Fill in "medium" — the {field:fieldId} template resolves to "medium", which does NOT match
      // the user's assigned attribute value "large"
      await fillFormTextField(page, "size-preference", "medium");
      await expectNotRoutedToUser(page);
      await closeResults(page);
    });
  });
});
