# Routing Forms Future Work

Ideas and enhancements deferred from the Sprint 5: Routing Forms initial implementation.

## Enhancements

- Response analytics dashboard (RF-GAP-002, Medium severity) — Build a routing form response analytics view with date filtering, destination result filtering, CSV export, and aggregate metrics (total submissions, conversion rate to bookings, destination distribution). Leverage existing `RoutingFormResponseRepository` and `PrismaRoutingFormResponseRepository` data for response listing with date, destination result, questions, and answers. Reference: `docs/gap-report/routing-forms.mdx` recommendations section.
- Third-party form integrations (RF-GAP-003, Medium severity) — Create integration adapters that import form field definitions from HubSpot, Marketo, and Pardot marketing automation platforms. Map external field types to Cal.com's `zodNonRouterField` types. Support hidden field values for routing decisions. Enable routing logic based on imported form submissions. Reference: Calendly supports importing HubSpot, Marketo, and Pardot forms as routing form sources.
- Data enrichment integration (RF-GAP-004, Medium severity) — Integrate data enrichment providers (Clearbit, ZoomInfo, or equivalent) to populate routing form fields with enriched prospect data (company size, industry, revenue range, job title, seniority level, geographic data) without requiring the visitor to manually enter it. Enriched data would be available as hidden field values for routing decisions.
- Extended RAQB operator support (RF-ADV-001) — Enhance the RAQB integration with additional operators and field type support beyond current parity requirements. Continue expanding the `jsonLogic` evaluation capabilities to maintain Cal.com's rule engine advantage over Calendly's simpler answer-based matching.
- Attribute type switching safety — Handle Select → MultiSelect attribute type switching without breaking routing logic or removing selected options. Add warnings recommending creation of a new attribute instead in unsupported type-change scenarios. From `packages/app-store/routing-forms/TODO.md` backlog.
- Full CRUD API v2 endpoints — Extend the `RoutingFormsController` API v2 controller with additional endpoints for form creation, update, deletion, and submission listing to achieve full programmatic management parity with Calendly's `GET /routing_forms` and `GET /routing_form_submissions` read-only API while exceeding it with write operations.
- Routing form response deletion API — Provide a proper response deletion workflow via API and UI. Neither Cal.com nor Calendly currently offers a robust submission deletion mechanism; adding this would be a competitive advantage.

## Technical Debt

- Performance optimization for large teams — Optimize attribute-based routing for teams with ~1000 members and ~100 attributes. Includes `getAttributes` query optimization across `Attribute`, `AttributeOption`, `AttributeToUser`, and `Membership` tables, and parallelizing `jsonLogic.apply` across team members in `findTeamMembersMatchingAttributeLogic`. From `packages/app-store/routing-forms/TODO.md` performance backlog.
- `routedTeamMemberIds` URL parameter size — Address potential URL length limits when routing to large teams. Consider switching to a short-lived database row that holds the routed team member IDs, passing only the row ID as a query parameter. `handleNewBooking` would retrieve the IDs from the row and delete the entry after successfully creating a booking. From `packages/app-store/routing-forms/TODO.md` V2.0 backlog.
- Fallback tracking — Mark when fallback route was used in response records for better analytics and debugging. This enables identifying routing scenarios where the primary route conditions did not match and the fallback was triggered. From `packages/app-store/routing-forms/TODO.md` V2.0 backlog.
- Consolidate duplicate routing form Zod schemas — `packages/app-store/routing-forms/zod.ts` re-exports from `packages/features/routing-forms/lib/zod.ts`; evaluate whether this layering can be simplified to reduce duplication and clarify the canonical schema location.

## Nice to Have

- Routing form A/B testing — Enable split testing of different routing configurations to optimize conversion rates. Allow form administrators to create variant routing rules and measure which configuration produces better booking outcomes.
- Seated event support — Support routing form targets that are seated events. Currently seated events require special handling for re-routing and capacity management that is not yet integrated with the routing form pipeline. From `packages/app-store/routing-forms/TODO.md` backlog.
- Visual routing flow builder — A graphical drag-and-drop routing logic designer as an alternative to the RAQB rule editor. Provide a flowchart-style interface for building conditional routing paths that is more intuitive for non-technical form administrators.
- Routing form templates — Pre-built form templates for common use cases (sales qualification, support triage, demo booking). Reduce time-to-value by providing ready-made field configurations and routing rules that users can customize.
- Form submission webhooks dashboard — Visual webhook delivery history and retry UI for routing form submission events. Display delivery status, response codes, and payload previews for each `FORM_SUBMITTED` webhook dispatch with manual retry capability.
