# Routing Forms Decisions

Architecture Decision Records (ADRs) for Sprint 5: Routing Forms (F-015) of the Calendly gap closure initiative.

Each ADR documents the context, options evaluated, final decision, and consequences for a key architectural trade-off encountered during Sprint 5 implementation.

---

## ADR-001: RAQB v5.1.2 with `jsonLogic` — Extend vs. Replace

### Context

The routing form engine uses React Awesome Query Builder (RAQB) v5.1.2 with `jsonLogic` for rule evaluation. To achieve Calendly parity, we need to ensure the form builder supports Calendly-equivalent question types and routing logic patterns. The core question is whether to **extend** RAQB's existing configuration with new field types and operators, or **replace** it with a simpler answer-based matching system closer to Calendly's model.

Cal.com's RAQB integration is deep and spans three code locations in the monorepo:

- **`packages/app-store/routing-forms/react-awesome-query-builder/`** — Provides `BasicConfig`, `uiConfig`, custom widgets, and type definitions that configure the RAQB rule builder UI. This directory wires Cal.com's field types (text, select, multiselect, number, etc.) into RAQB's widget and operator system.
- **`packages/app-store/routing-forms/lib/processRoute.tsx`** — Contains the `findMatchingRoute` function, which iterates through form routes, expands nested routers via `isRouter()`, filters fallback routes, and evaluates each route's `queryValue` against form responses by calling `evaluateRaqbLogic({ queryValue, queryBuilderConfig, data: responseValues })`. A match result of `RaqbLogicResult.MATCH` or `RaqbLogicResult.LOGIC_NOT_FOUND_SO_MATCHED` selects the route.
- **`packages/features/routing-forms/lib/findTeamMembersMatchingAttributeLogic.ts`** — Uses the same RAQB `jsonLogic` evaluation to match team members based on organizational attributes (`attributesQueryValue`), supporting dynamic field value operands, fallback logic, and concurrent member evaluation via `async.mapLimit`.

Each route stores a `queryValue` — a serialized `JsonTree` structure representing the RAQB rule configuration — which encodes conditions as nested groups and rules with operators like `multiselect_equals`, `select_equals`, `text_contains`, and numeric comparisons. This `queryValue` schema is enforced by `raqbQueryValueSchema` and branded as `formFieldsQueryValue` in `packages/app-store/routing-forms/zod.ts`.

Calendly, by contrast, uses a simpler form-answer-based conditional routing model. Calendly's routing logic supports conditions that reference form question answers with `AND`/`OR` compound operators, directing respondents to one of three destination types: Event Type, Custom Message, or External URL. Calendly does not support nested rule groups, arbitrary operator composition, attribute-based team member matching, or CRM contact owner lookups within the routing engine itself.

The gap report (`docs/gap-report/routing-forms.mdx`) identifies Cal.com's RAQB engine as **RF-ADV-001** — a significant competitive advantage providing "arbitrarily complex conditional rules with nested groups, multiple operators, and compound logic — far exceeding Calendly's simple answer-based matching."

### Options Considered

1. **Extend RAQB with new field types and operators** — Add Calendly-equivalent field type configurations to the existing RAQB widget and operator mappings, enhancing `getQueryBuilderConfigForFormFields` to support any new field types while preserving the existing rule engine architecture.

   - Pros:
     - Leverages the entire existing RAQB infrastructure — widget configurations, `jsonLogic` evaluation, `queryValue` serialization, and the `findMatchingRoute` pipeline in `processRoute.tsx` — without requiring any architectural changes
     - Maintains Cal.com's documented competitive advantage (RF-ADV-001) of arbitrarily complex rules with nested groups and compound logic, which significantly exceeds Calendly's capabilities
     - Avoids regression risk: all existing routing forms with stored `queryValue` data continue to evaluate correctly since the RAQB configuration is extended, not replaced
     - Existing `queryValue` schemas (enforced by `raqbQueryValueSchema` in `packages/app-store/routing-forms/zod.ts`) and all stored route configurations remain fully compatible — no data migration required
     - RAQB v5.1.2 natively supports custom widgets for new field type UIs, custom operators, and configurable type mappings, making field type extension a first-class operation
     - Attribute-based routing (`findTeamMembersMatchingAttributeLogic`) and CRM contact owner routing (`routerGetCrmContactOwnerEmail`) continue to function without modification since they share the same `jsonLogic` evaluation path
     - The `RoutingFormTraceService` observability instrumentation remains valid and unaffected
   - Cons:
     - RAQB's configuration complexity increases with each new field type — each type requires widget mappings, operator definitions, and `jsonLogic` evaluation support in `getQueryBuilderConfigForFormFields`
     - New field types require thorough testing of RAQB's type system to ensure `jsonLogic` operators behave correctly with new value shapes (booleans, display variants)
     - The RAQB version is pinned at 5.1.2; any incompatibilities discovered during field type extension cannot be resolved by upgrading without broader regression testing of the entire routing form system

2. **Replace RAQB with simpler answer-based matching** — Remove the RAQB dependency and implement a lightweight answer-matching engine that mirrors Calendly's form-answer-based conditional routing model with `AND`/`OR` operators.

   - Pros:
     - Closer behavioral alignment with Calendly's user experience — Calendly users migrating to Cal.com would encounter a familiar routing logic model
     - Simpler UX for non-technical users who only need basic "if answer equals X, route to Y" logic
     - Eliminates the RAQB dependency and its associated bundle size, configuration overhead, and upgrade maintenance burden
     - Easier long-term maintenance since the matching engine would be fully owned Cal.com code with no external library constraints
   - Cons:
     - **Destroys Cal.com's RAQB competitive advantage** (RF-ADV-001) — the gap report explicitly identifies RAQB as a significant differentiator; replacing it eliminates a key selling point for enterprise customers requiring complex routing logic
     - **Requires migrating all existing route `queryValue` data** stored in the database — every routing form's `queryValue` (a `JsonTree` structure) would need to be translated to the new matching format, affecting all Cal.com instances including cloud and self-hosted deployments
     - **Breaks backward compatibility** with all existing forms — the `queryValue` schema (`raqbQueryValueSchema.brand<"formFieldsQueryValue">()`) is deeply embedded in `zodNonRouterRoute`, `findMatchingRoute`, `evaluateRaqbLogic`, and all route evaluation paths
     - **Massive regression risk** — `findMatchingRoute` in `processRoute.tsx`, `getRoutedUrl` in `packages/features/routing-forms/lib/getRoutedUrl.ts`, `handleResponse`, and `findTeamMembersMatchingAttributeLogic` all depend on the RAQB `jsonLogic` evaluation pipeline
     - Loses nested group/rule composition — RAQB supports arbitrarily nested `AND`/`OR` groups with mixed operators; a simpler engine would be limited to flat condition lists
     - Loses the existing attribute-based routing integration, which reuses the same RAQB `jsonLogic` evaluation infrastructure with `attributesQueryValue`
     - Contradicts the AAP's architectural requirement to "Maintain RAQB (`react-awesome-query-builder` v5.1.2) with `jsonLogic` for routing form rule evaluation"

### Decision

**Extend RAQB v5.1.2.** The existing RAQB integration is a significant competitive advantage (RF-ADV-001) and is deeply embedded across three code locations in the monorepo. Extending it preserves full backward compatibility with all existing routing form configurations, maintains Cal.com's superiority over Calendly's simpler routing logic, and avoids the massive regression risk and data migration that replacement would entail.

New Calendly-equivalent field type support will be added by extending the RAQB widget and operator configurations in `getQueryBuilderConfigForFormFields`, adding corresponding `jsonLogic` evaluation support, and updating the form builder UI components in `packages/app-store/routing-forms/components/`. The core evaluation pipeline — `findMatchingRoute` → `evaluateRaqbLogic` → `jsonLogic.apply()` — remains unchanged.

### Consequences

- New field types (e.g., `radio` display variant, `checkbox` boolean type) are added to the RAQB configuration via `getQueryBuilderConfigForFormFields` by registering widget mappings, operator sets, and value types — no changes to the core evaluation pipeline are required
- All existing `queryValue` schemas and stored route configurations remain valid — no data migration is needed for existing routing forms in the database
- New RAQB widgets may be needed for field types requiring specialized UI rendering (e.g., radio button group widget for single-select radio display), added in `packages/app-store/routing-forms/react-awesome-query-builder/`
- RAQB version remains pinned at 5.1.2 to avoid upgrade risks; any future version upgrades must be treated as a separate initiative with full regression testing across all routing form evaluation paths
- The `findTeamMembersMatchingAttributeLogic` attribute routing continues to use the same `jsonLogic` evaluation infrastructure without modification
- All existing Playwright E2E tests in `packages/app-store/routing-forms/playwright/tests/basic.e2e.ts` and `attribute-routing.e2e.ts` must continue to pass after RAQB configuration extensions
- The `RoutingFormTraceService` observability instrumentation remains valid, logging matched routes and fallback usage for the extended field types

---

## ADR-002: `zodNonRouterField` Extension Strategy for New Field Types

### Context

Calendly routing forms support the following question types: **multiple choice** (radio buttons), **dropdowns**, **checkboxes**, and **text fields**. Cal.com already supports **text**, **textarea**, **number**, **email**, **phone**, **select** (single-select dropdown), and **multiselect** (multi-select checkboxes) field types via the `zodNonRouterField` schema defined in `packages/features/routing-forms/lib/zod.ts` and re-exported through `packages/app-store/routing-forms/zod.ts`.

The existing `zodNonRouterField` schema defines fields with properties: `id`, `label`, `identifier`, `placeholder`, `type` (a `z.string()` accepting any string value), `selectText` (deprecated), `required`, `deleted`, and `options` (array of `{ label, id }` for select/multiselect). The `type` field is intentionally a free-form string rather than a strict enum, providing flexibility for dynamic field type additions without schema migration.

The feature comparison matrix in `docs/gap-report/routing-forms.mdx` rates the field type gap as **Low severity**, noting: "Cal.com supports more granular field types (number, email, phone) with validation." The functional mapping between the two platforms is:

| Calendly Question Type | Cal.com Field Type | Behavioral Equivalent? |
|------------------------|-------------------|----------------------|
| Text field | `text` | ✅ Yes — short text input with optional validation |
| Dropdown | `select` | ✅ Yes — single-select from options list |
| Checkboxes | `multiselect` | ✅ Yes — multi-select from options list |
| Multiple choice (radio) | `select` (display variant) | ⚠️ Partial — Cal.com renders as dropdown, not radio buttons |
| _(No equivalent)_ | `textarea` | Cal.com advantage — long text input |
| _(No equivalent)_ | `number` | Cal.com advantage — numeric input with comparison operators |
| _(No equivalent)_ | `email` | Cal.com advantage — validated email input with CRM lookup |
| _(No equivalent)_ | `phone` | Cal.com advantage — phone number input |

The key question is whether Calendly's "multiple choice (radio buttons)" question type requires a new Cal.com field type, or whether the existing `select` type with a display variant is sufficient for behavioral parity.

### Options Considered

1. **Map existing Cal.com field types to Calendly equivalents with no new types** — Declare that Cal.com's existing field type set already functionally covers all Calendly question types. The `select` type provides single-select functionality equivalent to Calendly's dropdown and multiple choice (radio), and the `multiselect` type provides multi-select functionality equivalent to Calendly's checkboxes. No changes to `zodNonRouterField` are required for field type parity.

   - Pros:
     - Zero schema changes required — the existing `zodNonRouterField` schema in `packages/features/routing-forms/lib/zod.ts` remains untouched, eliminating any risk of breaking existing routing form data in the database
     - No `zodNonRouterField` extension required — all downstream consumers (`parseRoutingFormResponse`, `handleResponse`, `findMatchingRoute`, `getQueryBuilderConfigForFormFields`) continue to operate without modification for field type handling
     - Zero backward compatibility risk — existing forms stored in the database with `type: "select"` or `type: "multiselect"` continue to parse and evaluate correctly
     - Cal.com already exceeds Calendly's field type coverage with `number`, `email`, `phone`, and `textarea` types that Calendly lacks
     - The gap severity for field types is rated **Low** in the gap report, indicating that existing coverage is nearly complete
   - Cons:
     - Cal.com's `select` type renders as a dropdown by default, while Calendly's "multiple choice" renders as radio buttons — the visual rendering differs even though the underlying data model (single-select from options list) is identical
     - Users migrating from Calendly may expect a dedicated "multiple choice" or "radio" field type in the form builder, and may be confused when they only see "select" as the option
     - No mechanism to distinguish between dropdown rendering and radio button rendering for single-select fields at the data model level

2. **Add a `fieldType` discriminator and display variant support to `zodNonRouterField`** — Introduce an optional `fieldType` field with a strict enum of Calendly-aligned type values, and add display variant metadata that allows the same underlying data type (single-select) to render differently (dropdown vs. radio buttons) in the form builder UI. Also extend the schema with optional `validation`, `defaultValue`, and `description` fields for enhanced Calendly-equivalent form customization.

   - Pros:
     - Explicit parity with Calendly's labeled question types — a dedicated `radio` value in `fieldType` clearly maps to Calendly's "multiple choice (radio buttons)" question type
     - Clearer user intent when building forms — form creators can choose between "Dropdown" and "Radio Buttons" for single-select fields, matching the Calendly form builder experience
     - Allows different rendering (radio buttons vs. dropdown) for single-select fields without changing the underlying data model or RAQB evaluation logic
     - The `fieldType` discriminator (`z.enum(['text', 'email', 'phone', 'number', 'textarea', 'select', 'multiselect', 'radio', 'checkbox'])`) provides a strict, typed alternative to the existing free-form `type: z.string()`, enabling better TypeScript inference for downstream consumers
     - Additional fields (`validation`, `defaultValue`, `description`) bring Calendly-equivalent form customization (field help text, pre-populated values, input constraints) without requiring multiple schema iterations
   - Cons:
     - Adds new optional fields to the `zodNonRouterField` schema, which requires updating the `TNonRouterField` type definition, the form builder UI components in `packages/app-store/routing-forms/components/FormInputFields.tsx`, and the response handling in `packages/features/routing-forms/lib/handleResponse.ts`
     - Creates a dual-type system where `type` (free-form string) and `fieldType` (strict enum) coexist — consumers must decide which to use, and the relationship between them must be clearly documented
     - New RAQB widget configuration may be needed for `radio` and `checkbox` field types in `getQueryBuilderConfigForFormFields`
     - All new fields must be `optional()` to maintain backward compatibility with existing stored form data — existing forms without `fieldType`, `validation`, `defaultValue`, or `description` must continue to parse and function correctly

### Decision

**Add a `fieldType` discriminator and display variant support to `zodNonRouterField`.** While Cal.com's existing field types functionally cover Calendly's question types at the data model level, the introduction of an optional `fieldType` enum provides explicit Calendly parity in the form builder UX and enables display variant differentiation (radio buttons vs. dropdown) for single-select fields.

The extension follows an **additive-only** strategy:

- The existing `type: z.string()` field remains unchanged for backward compatibility — it continues to accept any string value and existing form data is unaffected
- A new optional `fieldType: z.enum([...])` field provides a strict, Calendly-aligned type discriminator
- Additional optional fields (`validation`, `defaultValue`, `description`) are added for enhanced form customization
- The `routingFormResponseInDbSchema` value union is extended from `z.union([z.string(), z.number(), z.array(z.string())])` to include `z.boolean()` for checkbox field responses
- The `FieldOption` type is extended with an optional `disabled` property for conditionally available options

All new fields are optional (`z.optional()`) to ensure zero impact on existing routing form data stored in the database.

### Consequences

- The `zodNonRouterField` schema in `packages/features/routing-forms/lib/zod.ts` gains four new optional fields: `fieldType`, `validation`, `defaultValue`, and `description` — all additive, all optional, all backward-compatible
- The `TNonRouterField` type definition in `packages/features/routing-forms/lib/zod.ts` is updated in parallel to include the same four optional properties
- A new `FieldType` union type is exported from `packages/features/routing-forms/lib/types.ts` mapping all supported field types including the new `radio` and `checkbox` variants
- The `routingFormResponseInDbSchema` value union is extended to include `z.boolean()` — existing data containing `string | number | string[]` values continues to parse correctly, and new checkbox field responses can store boolean values
- The `FieldOption` type gains an optional `disabled?: boolean` property for conditionally available options in select/multiselect/radio fields
- Form builder UI components in `packages/app-store/routing-forms/components/FormInputFields.tsx` must be updated to render radio button groups when `fieldType === 'radio'` and single-checkbox toggles when `fieldType === 'checkbox'`
- The RAQB configuration in `getQueryBuilderConfigForFormFields` must register widget and operator mappings for the new `radio` and `checkbox` field types
- Existing forms without `fieldType` default to the current rendering behavior — no migration of existing data is required
- The field type mapping table (Calendly → Cal.com) documented above serves as the authoritative parity reference for Sprint 5 validation

---

## ADR-003: `RouteActionType` Expansion Decisions

### Context

Cal.com currently defines three route action types in the `RouteActionType` enum at `packages/app-store/routing-forms/zod.ts`:

| Enum Value | Purpose |
|------------|---------|
| `eventTypeRedirectUrl` | Redirects the visitor to a Cal.com event type booking page, optionally with routed team member IDs, form response ID, attribute routing configuration, and CRM contact owner data as URL parameters |
| `customPageMessage` | Displays a custom text message to the visitor, typically used for disqualification ("Sorry, we can't help you at this time") |
| `externalRedirectUrl` | Redirects the visitor to an external URL with query parameters forwarded from the form submission |

These three action types map directly to Calendly's three routing form destination types:

| Calendly Destination | Cal.com Equivalent |
|---------------------|-------------------|
| Event Type | `RouteActionType.EventTypeRedirectUrl` |
| Custom Message | `RouteActionType.CustomPageMessage` |
| External URL | `RouteActionType.ExternalRedirectUrl` |

Each route in a Cal.com routing form has an `action` object containing `type` (one of the three `RouteActionType` values), an optional `eventTypeId` (for event type redirects), and a `value` (the destination URL or message text). Routes can also specify a `fallbackAction` that is used when the primary `attributesQueryValue` finds no matching team members and no CRM contact owner exists.

Additionally, Cal.com supports **nested routing** via the `zodRouterRoute` schema, where a route references another routing form by its form ID. When `findMatchingRoute` encounters a router route (identified by `isRouter: true`), it expands the nested form's routes inline and evaluates them as part of the current form's route list. This provides native multi-step routing without requiring a new action type.

The question is whether any expansion of `RouteActionType` is needed for Sprint 5 Calendly parity, or whether the existing three action types are sufficient.

### Options Considered

1. **No expansion — existing action types are sufficient for Calendly parity** — The three current `RouteActionType` values (`eventTypeRedirectUrl`, `customPageMessage`, `externalRedirectUrl`) already provide complete functional parity with Calendly's three destination types. No changes to the enum are needed.

   - Pros:
     - Zero breaking changes — the `RouteActionType` enum, `routeActionTypeSchema`, and all route action handling code in `getRoutedUrl` (specifically the action type switch at lines 152–273) remain completely untouched
     - All existing form configurations stored in the database remain valid — no migration, no re-validation, no schema evolution required
     - Calendly's three destination types are already fully covered by the existing enum, as confirmed by the gap report's Low severity rating for route destinations
     - The fallback mechanism (`isFallback` route and `fallbackAction` per route) is already more sophisticated than Calendly's single fallback route, providing Cal.com with a structural advantage (RF-ADV-006) without any enum changes
     - The existing `zodNonRouterRoute` schema in `packages/app-store/routing-forms/zod.ts` does not need modification — the `action` and `fallbackAction` objects retain their current shape
     - The `getRoutedUrl` pipeline's action handling (`customPageMessage` → render message, `eventTypeRedirectUrl` → redirect to booking page, `externalRedirectUrl` → redirect to external URL) remains unchanged and fully tested
   - Cons:
     - No additional routing capabilities beyond the current three destination types — if future requirements call for routing to a specific team member directly (bypassing the booking page) or triggering a webhook action, a new action type would be needed
     - Cal.com's route action UX labels ("Event Type", "Custom Message", "External URL") may not identically match Calendly's terminology — but this is a labeling concern, not a functional gap

2. **Add new action types for enhanced routing capabilities** — Extend `RouteActionType` with additional values such as `teamMemberDirectUrl` (route directly to a specific team member's booking page), `nestedFormRedirectUrl` (explicitly route to another routing form as an action), or `webhookTrigger` (fire a webhook as the route action).

   - Pros:
     - Could enable routing to specific team members without going through the standard booking page team member selection flow
     - Could provide a first-class action type for nested form chaining, making the routing form builder UI more explicit about multi-step routing
     - Could support webhook-trigger-as-action patterns for integration workflows where the route action is to fire a webhook to an external system rather than redirect the user
   - Cons:
     - **Exceeds Calendly parity scope** — Calendly offers only three destination types; adding more action types goes beyond the Sprint 5 parity mandate and introduces scope risk
     - Nested form chaining is already fully supported via `zodRouterRoute` with `isRouter: true` — creating a separate `nestedFormRedirectUrl` action type would duplicate existing functionality and create confusion about which approach to use
     - Adding new enum values to `RouteActionType` requires updating `routeActionTypeSchema` (the `z.nativeEnum(RouteActionType)` schema), the action handling switch in `getRoutedUrl`, form builder UI components, and any downstream consumers that exhaustively check action types
     - Team member direct routing can already be achieved by combining `eventTypeRedirectUrl` with attribute-based routing (`attributesQueryValue`) to narrow the team member set, making a dedicated action type redundant
     - **Adds schema complexity** without immediate user demand — no Cal.com users or gap report items have requested additional action types
     - Contradicts the AAP's additive-only constraint philosophy — while technically an additive enum extension, the cascading changes required across the action handling pipeline are disproportionate to the benefit for parity

### Decision

**No expansion of `RouteActionType` for Sprint 5.** The existing three action types provide complete functional parity with Calendly's three destination types. Nested form chaining is already natively supported via `zodRouterRoute` without requiring a new action type. Team member targeting is already achievable through attribute-based routing on `eventTypeRedirectUrl` routes. Any future action types would exceed the Calendly parity scope of Sprint 5 and introduce unnecessary schema and code changes.

### Consequences

- The `RouteActionType` enum in `packages/app-store/routing-forms/zod.ts` remains stable with exactly three values: `CustomPageMessage`, `ExternalRedirectUrl`, `EventTypeRedirectUrl`
- The `routeActionTypeSchema` (`z.nativeEnum(RouteActionType)`) requires no changes
- No database schema migration is needed for action types — the existing `zodNonRouterRoute` schema with its `action` and `fallbackAction` objects remains fully compatible
- The action handling logic in `packages/features/routing-forms/lib/getRoutedUrl.ts` (the switch over `customPageMessage`, `eventTypeRedirectUrl`, `externalRedirectUrl`) remains unchanged and fully tested
- All existing route configurations stored in the database are fully backward-compatible
- Future action types (if needed beyond parity scope) can be added as additive enum extensions in a later sprint, following the same pattern used for `WebhookTriggerEvents` enum extensions in Sprint 4
- The form builder UI does not need to add new action type selection options for Sprint 5
- The API v2 `RoutingFormsController` at `apps/api/v2/src/modules/routing-forms/controllers/routing-forms.controller.ts` does not need action type handling updates
