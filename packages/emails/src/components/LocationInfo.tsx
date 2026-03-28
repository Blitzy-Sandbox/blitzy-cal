import type { TFunction } from "i18next";

import { guessEventLocationType } from "@calcom/app-store/locations";
import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import type { CalendarEvent } from "@calcom/types/Calendar";

import { Info } from "./Info";

export function LocationInfo(props: { calEvent: CalendarEvent; t: TFunction }) {
  const { t } = props;

  // Extract full location type object for enhanced Calendly-parity rendering (NF-001)
  const eventLocationType = guessEventLocationType(props.calEvent.location);

  // We would not be able to determine provider name for DefaultEventLocationTypes
  const providerName = eventLocationType?.label;

  const location = props.calEvent.location;
  let meetingUrl = location?.search(/^https?:/) !== -1 ? location : undefined;

  if (props.calEvent) {
    meetingUrl = getVideoCallUrlFromCalEvent(props.calEvent) || meetingUrl;
  }

  const isPhone = location?.startsWith("+");

  // Detect in-person physical address location types for Calendly parity (NF-001)
  const locationType = eventLocationType?.type;
  const isInPersonLocationType = locationType === "inPerson" || locationType === "attendeeInPerson";

  // Detect physical addresses by pattern: not a URL, not a phone number, and contains
  // comma-separated parts (e.g., "123 Main St, Anytown, CA 90210")
  const addressParts =
    location && !meetingUrl && !isPhone
      ? location
          .split(",")
          .map((part: string) => part.trim())
          .filter(Boolean)
      : [];
  const isPhysicalAddress = isInPersonLocationType || addressParts.length >= 2;

  // Detect specific phone location types for invitee/organizer differentiation (NF-001)
  const isAttendeePhoneType = locationType === "phone";
  const isOrganizerPhoneType = locationType === "userPhone";

  // Because of location being a value here, we can determine the app that generated the location only for Dynamic Link based apps where the value is integrations:*
  // For static link based location apps, the value is that URL itself. So, it is not straightforward to determine the app that generated the location.
  // If we know the App we can always provide the name of the app like we do it for Google Hangout/Google Meet

  // Branch 1 — Meeting URL with "Join [Provider]" CTA for Calendly parity (NF-001)
  if (meetingUrl) {
    // Calendly-parity: "Join Zoom", "Join Google Meet", etc. using existing i18n key
    const joinLabel = providerName ? t("join_platform", { platform: providerName }) : "Link";

    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          <a
            href={meetingUrl}
            target="_blank"
            title={t("meeting_url")}
            style={{ color: "#101010", fontWeight: 500 }}
            rel="noreferrer">
            {joinLabel}
          </a>
        }
        extraInfo={
          meetingUrl && (
            <div style={{ color: "#494949", fontWeight: 400, lineHeight: "24px" }}>
              <>
                {t("meeting_url")}:{" "}
                <a href={meetingUrl} title={t("meeting_url")} style={{ color: "#3E3E3E" }}>
                  {meetingUrl}
                </a>
              </>
            </div>
          )
        }
      />
    );
  }

  // Branch 2 — Phone with invitee/organizer differentiation for Calendly parity (NF-001)
  if (isPhone) {
    // Determine phone context label: organizer phone vs. attendee phone vs. generic
    let phoneContextLabel: string | undefined;
    if (isOrganizerPhoneType) {
      phoneContextLabel = t("organizer_phone_number");
    } else if (isAttendeePhoneType) {
      phoneContextLabel = t("attendee_phone_number");
    }

    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          <a href={`tel:${location}`} title="Phone" style={{ color: "#3E3E3E" }}>
            {location}
          </a>
        }
        extraInfo={
          phoneContextLabel ? (
            <div style={{ color: "#494949", fontWeight: 400, lineHeight: "24px" }}>{phoneContextLabel}</div>
          ) : undefined
        }
      />
    );
  }

  // Branch 3 — Physical address with multi-line formatting for Calendly parity (NF-001)
  // Handles in-person locations (organizer address, attendee address) and address-like strings
  if (isPhysicalAddress && location) {
    return (
      <Info
        label={t("where")}
        withSpacer
        description={
          addressParts.length > 1 ? (
            <div
              style={{
                color: "#101010",
                fontWeight: 400,
                lineHeight: "24px",
                whiteSpace: "pre-wrap",
              }}>
              {addressParts.map((part: string, index: number) => (
                <span key={`addr-${part}`}>
                  {part}
                  {index < addressParts.length - 1 ? <br /> : null}
                </span>
              ))}
            </div>
          ) : (
            providerName || location
          )
        }
      />
    );
  }

  // Branch 4 — Fallback (preserved exactly from original implementation)
  return (
    <Info
      label={t("where")}
      withSpacer
      description={providerName || location}
      extraInfo={
        (providerName === "Zoom" || providerName === "Google") && props.calEvent.requiresConfirmation ? (
          <p style={{ color: "#494949", fontWeight: 400, lineHeight: "24px" }}>
            <>{t("meeting_url_provided_after_confirmed")}</>
          </p>
        ) : null
      }
    />
  );
}
