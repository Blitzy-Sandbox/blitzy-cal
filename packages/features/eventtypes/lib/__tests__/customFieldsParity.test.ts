/**
 * Custom Fields Parity Test Suite — Sprint 2: Event Types (F-002)
 *
 * Verifies that Cal.com's booking field / custom field system achieves behavioral
 * parity with Calendly's custom question types.
 *
 * Covers:
 *   ET-VAL-005: Custom field type coverage and response capture
 *   ET-006: Custom Fields/Questions Parity epic
 *
 * All five Calendly question types (text, radio, checkbox, phone, dropdown) must
 * have Cal.com equivalents, and the booking field management system must correctly
 * handle source tracking, required status aggregation, and persistence.
 *
 * @see docs/gap-report/event-types.mdx — Gap analysis for event types
 * @see docs/sprint-roadmap/validation-criteria.mdx — ET-VAL-005
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { getBookingFieldsWithSystemFields } from "@calcom/features/bookings/lib/getBookingFields";
import { prisma } from "@calcom/prisma";
import { fieldTypeEnum, fieldSchema, eventTypeBookingFields } from "@calcom/prisma/zod-utils";

import { upsertBookingField, removeBookingField } from "../bookingFieldsManager";

// ---------------------------------------------------------------------------
// Mock Setup — follows Cal.com Vitest patterns from EventTypeRepository.test.ts
// ---------------------------------------------------------------------------

vi.mock("@calcom/prisma", () => ({
  prisma: {
    eventType: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@calcom/features/bookings/lib/getBookingFields", () => ({
  getBookingFieldsWithSystemFields: vi.fn(),
}));

vi.mock("@calcom/features/ee/workflows/lib/getAllWorkflows", () => ({
  workflowSelect: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Creates a mock event type record matching the shape returned by
 * `prisma.eventType.findUnique` with the includes used in `getEventType`.
 */
const createMockEventType = (bookingFields: Record<string, unknown>[] = []) => ({
  id: 1,
  bookingFields,
  customInputs: [],
  profile: { organizationId: null },
  teamId: null,
  workflows: [],
});

// Default fixture with a single text field and one source
const defaultBookingFields = [
  {
    name: "test-text-field",
    type: "text",
    label: "Test Text",
    required: false,
    sources: [{ id: "source-1", type: "user", label: "User", fieldRequired: false }],
  },
];

// ---------------------------------------------------------------------------
// Main Test Suite
// ---------------------------------------------------------------------------

describe("Custom Fields Parity (ET-006)", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Re-set the getBookingFieldsWithSystemFields implementation after reset
    // because vi.resetAllMocks() removes mock implementations
    vi.mocked(getBookingFieldsWithSystemFields).mockImplementation(
      (input: Record<string, unknown>) => (input.bookingFields as unknown[]) || []
    );

    // Default mock: event type with one text field
    vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
      createMockEventType(defaultBookingFields) as never
    );
    vi.mocked(prisma.eventType.update).mockResolvedValue({} as never);
  });

  // =========================================================================
  // Phase 2a: Calendly Question Type Coverage
  // =========================================================================

  describe("Calendly Question Type Coverage", () => {
    it("should support 'text' field type", () => {
      // Calendly "text" → Cal.com "text"
      const enumResult = fieldTypeEnum.safeParse("text");
      expect(enumResult.success).toBe(true);

      const fieldResult = fieldSchema.safeParse({
        name: "custom-text",
        type: "text",
        label: "Your Answer",
        required: false,
      });
      expect(fieldResult.success).toBe(true);
      if (fieldResult.success) {
        expect(fieldResult.data.type).toBe("text");
      }
    });

    it("should support 'radio' field type", () => {
      // Calendly "radio" → Cal.com "radio"
      const enumResult = fieldTypeEnum.safeParse("radio");
      expect(enumResult.success).toBe(true);

      const fieldResult = fieldSchema.safeParse({
        name: "custom-radio",
        type: "radio",
        label: "Choose One",
        required: true,
        options: [
          { label: "Option A", value: "a" },
          { label: "Option B", value: "b" },
          { label: "Option C", value: "c" },
        ],
      });
      expect(fieldResult.success).toBe(true);
      if (fieldResult.success) {
        expect(fieldResult.data.type).toBe("radio");
        expect(fieldResult.data.options).toHaveLength(3);
      }
    });

    it("should support 'checkbox' field type", () => {
      // Calendly "checkbox" → Cal.com "checkbox"
      const enumResult = fieldTypeEnum.safeParse("checkbox");
      expect(enumResult.success).toBe(true);

      const fieldResult = fieldSchema.safeParse({
        name: "custom-checkbox",
        type: "checkbox",
        label: "Select All That Apply",
        required: false,
        options: [
          { label: "Interest A", value: "a" },
          { label: "Interest B", value: "b" },
        ],
      });
      expect(fieldResult.success).toBe(true);
      if (fieldResult.success) {
        expect(fieldResult.data.type).toBe("checkbox");
        expect(fieldResult.data.options).toHaveLength(2);
      }
    });

    it("should support 'phone' field type", () => {
      // Calendly "phone" → Cal.com "phone"
      const enumResult = fieldTypeEnum.safeParse("phone");
      expect(enumResult.success).toBe(true);

      const fieldResult = fieldSchema.safeParse({
        name: "custom-phone",
        type: "phone",
        label: "Phone Number",
        required: true,
      });
      expect(fieldResult.success).toBe(true);
      if (fieldResult.success) {
        expect(fieldResult.data.type).toBe("phone");
      }
    });

    it("should support 'select' field type (Calendly dropdown)", () => {
      // Calendly "dropdown" maps to Cal.com "select"
      const enumResult = fieldTypeEnum.safeParse("select");
      expect(enumResult.success).toBe(true);

      const fieldResult = fieldSchema.safeParse({
        name: "custom-select",
        type: "select",
        label: "Choose from Dropdown",
        required: false,
        options: [
          { label: "Sales", value: "sales" },
          { label: "Support", value: "support" },
          { label: "Billing", value: "billing" },
        ],
      });
      expect(fieldResult.success).toBe(true);
      if (fieldResult.success) {
        expect(fieldResult.data.type).toBe("select");
        expect(fieldResult.data.options).toHaveLength(3);
      }
    });

    it("should support all additional Cal.com field types beyond Calendly", () => {
      // Cal.com supports 15 field types total — 10 beyond Calendly's 5.
      // This documents Cal.com's advantage over Calendly in custom field types.
      const calcomExtraTypes = [
        "textarea",
        "number",
        "email",
        "address",
        "multiemail",
        "multiselect",
        "radioInput",
        "boolean",
        "url",
        "name",
      ] as const;

      for (const fieldType of calcomExtraTypes) {
        const result = fieldTypeEnum.safeParse(fieldType);
        expect(result.success).toBe(true);
      }

      // Verify total field type count: 5 Calendly + 10 Cal.com extra = 15
      const allTypes = fieldTypeEnum.options;
      expect(allTypes).toHaveLength(15);
    });

    it("should reject invalid field types", () => {
      // Ensure unknown types are correctly rejected by the enum
      const invalid = fieldTypeEnum.safeParse("unknown-type");
      expect(invalid.success).toBe(false);
    });

    it("should validate a complete bookingFields array via eventTypeBookingFields", () => {
      // eventTypeBookingFields = z.array(fieldSchema) — validates the full array
      const result = eventTypeBookingFields.safeParse([
        { name: "field-text", type: "text", label: "Text Q" },
        { name: "field-radio", type: "radio", label: "Radio Q", options: [{ label: "A", value: "a" }] },
        { name: "field-phone", type: "phone", label: "Phone Q" },
        {
          name: "field-select",
          type: "select",
          label: "Select Q",
          options: [{ label: "X", value: "x" }],
        },
        { name: "field-checkbox", type: "checkbox", label: "Check Q", options: [{ label: "Y", value: "y" }] },
      ]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(5);
      }
    });
  });

  // =========================================================================
  // Phase 2b: Field Required vs Optional Enforcement
  // =========================================================================

  describe("Field Required vs Optional Enforcement", () => {
    it("should mark field as required when any source requires it", async () => {
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "test-field",
            type: "text",
            label: "Test",
            required: false,
            sources: [],
          },
        ]) as never
      );

      await upsertBookingField(
        { name: "test-field", type: "text", label: "Test" } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: true },
        1
      );

      expect(prisma.eventType.update).toHaveBeenCalledTimes(1);
      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "test-field");
      expect(field).toBeDefined();
      expect(field!.required).toBe(true);
    });

    it("should mark field as optional when no source requires it", async () => {
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "test-field",
            type: "text",
            label: "Test",
            required: false,
            sources: [],
          },
        ]) as never
      );

      await upsertBookingField(
        { name: "test-field", type: "text", label: "Test" } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: false },
        1
      );

      expect(prisma.eventType.update).toHaveBeenCalledTimes(1);
      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "test-field");
      expect(field).toBeDefined();
      expect(field!.required).toBe(false);
    });

    it("should aggregate required status across multiple sources", async () => {
      // Field already has source-1 which requires the field
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "test-field",
            type: "text",
            label: "Test",
            required: true,
            sources: [{ id: "src-1", type: "user", label: "User", fieldRequired: true }],
          },
        ]) as never
      );

      // Add source-2 which does NOT require the field
      await upsertBookingField(
        { name: "test-field", type: "text", label: "Test" } as never,
        { id: "src-2", type: "workflow", label: "Workflow", fieldRequired: false },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "test-field");
      // Still required because src-1 (fieldRequired: true) remains
      expect(field!.required).toBe(true);
      expect(field!.sources).toHaveLength(2);
    });

    it("should recalculate required status when a requiring source is removed", async () => {
      // Field has two sources: src-1 (required: true) and src-2 (not required)
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "test-field",
            type: "text",
            label: "Test",
            required: true,
            sources: [
              { id: "src-1", type: "user", label: "User", fieldRequired: true },
              { id: "src-2", type: "workflow", label: "Workflow", fieldRequired: false },
            ],
          },
        ]) as never
      );

      // Remove the requiring source (src-1)
      await removeBookingField({ name: "test-field" }, { id: "src-1", type: "user" }, 1);

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "test-field");
      // Now optional because only src-2 remains and it's not required
      expect(field).toBeDefined();
      expect(field!.required).toBe(false);
      expect(field!.sources).toHaveLength(1);
      const remainingSource = (field!.sources as Array<Record<string, unknown>>)[0];
      expect(remainingSource.id).toBe("src-2");
    });
  });

  // =========================================================================
  // Phase 2c: Source Tracking via upsertBookingField
  // =========================================================================

  describe("Source Tracking via upsertBookingField", () => {
    it("should add a new source to an existing field", async () => {
      // Field already exists with source-1
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "existing-field",
            type: "text",
            label: "Existing",
            required: false,
            sources: [{ id: "src-1", type: "user", label: "User", fieldRequired: false }],
          },
        ]) as never
      );

      // Upsert with a new source (src-2)
      await upsertBookingField(
        { name: "existing-field", type: "text", label: "Existing" } as never,
        { id: "src-2", type: "workflow", label: "Workflow", fieldRequired: false },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "existing-field");
      const sources = field!.sources as Array<Record<string, unknown>>;
      expect(sources).toHaveLength(2);
      expect(sources[0].id).toBe("src-1");
      expect(sources[1].id).toBe("src-2");
    });

    it("should update an existing source on a field", async () => {
      // Field already has source-1 with old label
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "existing-field",
            type: "text",
            label: "Existing",
            required: false,
            sources: [{ id: "src-1", type: "user", label: "Old Label", fieldRequired: false }],
          },
        ]) as never
      );

      // Upsert with same source id but updated data
      await upsertBookingField(
        { name: "existing-field", type: "text", label: "Existing" } as never,
        { id: "src-1", type: "user", label: "Updated Label", fieldRequired: true },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "existing-field");
      const sources = field!.sources as Array<Record<string, unknown>>;
      // Source should be updated, not duplicated
      expect(sources).toHaveLength(1);
      expect(sources[0].label).toBe("Updated Label");
      expect(sources[0].fieldRequired).toBe(true);
      // Required should be recalculated from the updated source
      expect(field!.required).toBe(true);
    });

    it("should create a new field when name does not exist", async () => {
      // Event type has one existing field
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "existing-field",
            type: "text",
            label: "Existing",
            required: false,
            sources: [{ id: "src-1", type: "user", label: "User", fieldRequired: false }],
          },
        ]) as never
      );

      // Upsert a field with a different name
      await upsertBookingField(
        { name: "new-field", type: "phone", label: "Phone Number" } as never,
        { id: "src-2", type: "workflow", label: "SMS Reminder", fieldRequired: true },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      // Should now have 2 fields (existing + new)
      expect(updatedFields).toHaveLength(2);
      const newField = updatedFields.find((f) => f.name === "new-field");
      expect(newField).toBeDefined();
      expect(newField!.type).toBe("phone");
      expect(newField!.label).toBe("Phone Number");
    });

    it("should initialize new field with the provided source and required status", async () => {
      // Start with empty bookingFields
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(createMockEventType([]) as never);

      await upsertBookingField(
        {
          name: "brand-new-field",
          type: "select",
          label: "Department",
          options: [{ label: "Sales", value: "sales" }],
        } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: true },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      expect(updatedFields).toHaveLength(1);
      const newField = updatedFields[0];
      expect(newField.name).toBe("brand-new-field");
      expect(newField.type).toBe("select");
      expect(newField.sources).toEqual([
        { id: "src-1", type: "user", label: "User", fieldRequired: true },
      ]);
      expect(newField.required).toBe(true);
    });
  });

  // =========================================================================
  // Phase 2d: Source Removal via removeBookingField
  // =========================================================================

  describe("Source Removal via removeBookingField", () => {
    it("should remove a specific source from a field", async () => {
      // Field has two sources
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "multi-source-field",
            type: "text",
            label: "Test",
            required: true,
            sources: [
              { id: "src-1", type: "user", label: "User", fieldRequired: true },
              { id: "src-2", type: "workflow", label: "Workflow", fieldRequired: false },
            ],
          },
        ]) as never
      );

      // Remove src-1
      await removeBookingField({ name: "multi-source-field" }, { id: "src-1", type: "user" }, 1);

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "multi-source-field");
      expect(field).toBeDefined();
      const sources = field!.sources as Array<Record<string, unknown>>;
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe("src-2");
    });

    it("should remove the entire field when no sources remain", async () => {
      // Field has only one source
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "single-source-field",
            type: "text",
            label: "Test",
            required: true,
            sources: [{ id: "src-1", type: "user", label: "User", fieldRequired: true }],
          },
        ]) as never
      );

      // Remove the only source
      await removeBookingField({ name: "single-source-field" }, { id: "src-1", type: "user" }, 1);

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      // Field should be completely removed (filtered out as null)
      expect(updatedFields.find((f) => f.name === "single-source-field")).toBeUndefined();
      expect(updatedFields).toHaveLength(0);
    });

    it("should not modify a field when source to remove does not exist", async () => {
      // Field has source-1
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(
        createMockEventType([
          {
            name: "stable-field",
            type: "text",
            label: "Test",
            required: true,
            sources: [{ id: "src-1", type: "user", label: "User", fieldRequired: true }],
          },
        ]) as never
      );

      // Try to remove a non-existent source
      await removeBookingField(
        { name: "stable-field" },
        { id: "non-existent", type: "system" },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const updatedFields = data.bookingFields as Array<Record<string, unknown>>;
      const field = updatedFields.find((f) => f.name === "stable-field");
      expect(field).toBeDefined();
      const sources = field!.sources as Array<Record<string, unknown>>;
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe("src-1");
      expect(field!.required).toBe(true);
    });
  });

  // =========================================================================
  // Phase 2e: Calendly to Cal.com Field Type Mapping
  // =========================================================================

  describe("Calendly to Cal.com Field Type Mapping", () => {
    it("should have a complete Calendly-to-Cal.com mapping", () => {
      // Authoritative mapping: Calendly question types → Cal.com field types
      const calendlyToCalcom: Record<string, string> = {
        text: "text",
        radio: "radio",
        checkbox: "checkbox",
        phone: "phone",
        dropdown: "select", // Calendly "dropdown" maps to Cal.com "select"
      };

      // Verify each Cal.com equivalent is valid in fieldTypeEnum
      for (const [_calendlyType, calcomType] of Object.entries(calendlyToCalcom)) {
        const result = fieldTypeEnum.safeParse(calcomType);
        expect(result.success).toBe(true);
      }

      // Verify all 5 Calendly types are covered
      expect(Object.keys(calendlyToCalcom)).toHaveLength(5);
    });

    it("should parse Calendly-equivalent fields through fieldSchema", () => {
      // Validate each mapped type can be parsed as a complete field
      const calendlyFields = [
        { name: "f-text", type: "text", label: "Text Question" },
        {
          name: "f-radio",
          type: "radio",
          label: "Radio Question",
          options: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
        },
        {
          name: "f-checkbox",
          type: "checkbox",
          label: "Checkbox Question",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        },
        { name: "f-phone", type: "phone", label: "Phone Question" },
        {
          name: "f-select",
          type: "select",
          label: "Dropdown Question",
          options: [
            { label: "Sales", value: "sales" },
            { label: "Support", value: "support" },
          ],
        },
      ];

      for (const field of calendlyFields) {
        const result = fieldSchema.safeParse(field);
        expect(result.success).toBe(true);
      }
    });
  });

  // =========================================================================
  // Phase 2f: Response Capture Verification
  // =========================================================================

  describe("Response Capture Verification", () => {
    it("should persist field with correct type for text response capture", async () => {
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(createMockEventType([]) as never);

      await upsertBookingField(
        { name: "text-capture", type: "text", label: "Your Name" } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: true },
        1
      );

      expect(prisma.eventType.update).toHaveBeenCalledTimes(1);
      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const fields = data.bookingFields as Array<Record<string, unknown>>;
      expect(fields[0].name).toBe("text-capture");
      expect(fields[0].type).toBe("text");
      expect(fields[0].label).toBe("Your Name");
    });

    it("should persist field with options for radio/checkbox/select types", async () => {
      const fieldDefsWithOptions = [
        {
          name: "radio-capture",
          type: "radio" as const,
          label: "Choose One",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        },
        {
          name: "checkbox-capture",
          type: "checkbox" as const,
          label: "Select Multiple",
          options: [
            { label: "X", value: "x" },
            { label: "Y", value: "y" },
          ],
        },
        {
          name: "select-capture",
          type: "select" as const,
          label: "Pick One",
          options: [
            { label: "Sales", value: "sales" },
            { label: "Support", value: "support" },
          ],
        },
      ];

      for (const fieldDef of fieldDefsWithOptions) {
        // Reset for each iteration
        vi.mocked(prisma.eventType.findUnique).mockResolvedValue(createMockEventType([]) as never);
        vi.mocked(prisma.eventType.update).mockClear();

        await upsertBookingField(
          fieldDef as never,
          { id: "src-1", type: "user", label: "User", fieldRequired: false },
          1
        );

        const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
        const data = updateArg.data as Record<string, unknown>;
        const fields = data.bookingFields as Array<Record<string, unknown>>;
        expect(fields[0].type).toBe(fieldDef.type);
        expect(fields[0].options).toEqual(fieldDef.options);
      }
    });

    it("should persist phone field for phone response capture", async () => {
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(createMockEventType([]) as never);

      await upsertBookingField(
        { name: "phone-capture", type: "phone", label: "Phone Number" } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: true },
        1
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const data = updateArg.data as Record<string, unknown>;
      const fields = data.bookingFields as Array<Record<string, unknown>>;
      expect(fields[0].name).toBe("phone-capture");
      expect(fields[0].type).toBe("phone");
    });

    it("should correctly persist the event type ID in the update call", async () => {
      vi.mocked(prisma.eventType.findUnique).mockResolvedValue(createMockEventType([]) as never);

      const eventTypeId = 42;
      await upsertBookingField(
        { name: "verify-id", type: "text", label: "Test" } as never,
        { id: "src-1", type: "user", label: "User", fieldRequired: false },
        eventTypeId
      );

      const updateArg = vi.mocked(prisma.eventType.update).mock.calls[0][0] as Record<string, unknown>;
      const where = updateArg.where as Record<string, unknown>;
      expect(where.id).toBe(eventTypeId);
    });
  });
});
