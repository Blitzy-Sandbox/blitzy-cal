/**
 * v2025-01-01 Webhook Payload Builder Set
 *
 * Barrel export for all versioned payload builders in the v2025-01-01 webhook version.
 * This file enables the PayloadBuilderFactory registry to import and wire the complete
 * builder set for this version.
 *
 * Builder inventory (7 builders):
 * - BookingPayloadBuilder   — BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED, etc.
 * - FormPayloadBuilder      — FORM_SUBMITTED, FORM_SUBMITTED_NO_EVENT
 * - MeetingPayloadBuilder   — MEETING_STARTED, MEETING_ENDED, AFTER_*_NO_SHOW
 * - InstantMeetingBuilder   — INSTANT_MEETING
 * - DelegationPayloadBuilder — DELEGATION_CREDENTIAL_ERROR
 * - OOOPayloadBuilder       — OOO_CREATED
 * - RecordingPayloadBuilder — RECORDING_READY, RECORDING_TRANSCRIPTION_GENERATED
 *
 * @see PayloadBuilderFactory — Consumer that imports and registers these builders
 * @see v2021-10-20/index.ts  — Sibling version barrel for the legacy builder set
 */
export { BookingPayloadBuilder } from "./BookingPayloadBuilder";
export { FormPayloadBuilder } from "./FormPayloadBuilder";
export { MeetingPayloadBuilder } from "./MeetingPayloadBuilder";
export { InstantMeetingBuilder } from "./InstantMeetingBuilder";
export { DelegationPayloadBuilder } from "./DelegationPayloadBuilder";
export { OOOPayloadBuilder } from "./OOOPayloadBuilder";
export { RecordingPayloadBuilder } from "./RecordingPayloadBuilder";

export type { V20250101BookingEventPayload } from "./types";
