import isSmsCalEmail from "@calcom/lib/isSmsCalEmail";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { Info } from "./Info";

/**
 * Generates initials from a person's name for avatar display.
 * Handles edge cases: empty names, single-character names, multi-space names.
 * Returns first letter of first name + first letter of last name, or
 * first two characters if name has no space.
 */
function getInitials(name: string): string {
  if (!name || name.trim().length === 0) return "?";
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.substring(0, Math.min(2, trimmed.length)).toUpperCase();
}

/**
 * Derives a consistent avatar background color from a person's identifier (name or email).
 * Uses a simple hash to select from a curated palette of pleasant colors.
 */
function getAvatarColor(identifier: string): string {
  const colors = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6", "#EF4444", "#14B8A6"];
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const PersonInfo = ({
  name = "",
  email = "",
  role = "",
  phoneNumber = "",
  showAvatar = false,
  timeZone,
}: {
  name?: string;
  email?: string;
  role?: string;
  phoneNumber?: string;
  /** When true, renders a colored initials circle before the person's name (Calendly parity). */
  showAvatar?: boolean;
  /** Optional timezone string displayed in subtle styling next to participant info. */
  timeZone?: string;
}) => {
  const displayEmail = !isSmsCalEmail(email);
  const formattedPhoneNumber = phoneNumber ? `${phoneNumber} ` : "";

  return (
    <div style={{ color: "#101010", fontWeight: 400, lineHeight: "24px" }}>
      {showAvatar && (
        <span
          style={{
            display: "inline-block",
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            backgroundColor: getAvatarColor(name || email),
            color: "#FFFFFF",
            textAlign: "center",
            lineHeight: "32px",
            fontSize: "14px",
            fontWeight: 600,
            marginRight: "8px",
            verticalAlign: "middle",
          }}>
          {getInitials(name)}
        </span>
      )}
      {name} - {role} {formattedPhoneNumber}
      {displayEmail && (
        <span style={{ color: "#4B5563" }}>
          <a href={`mailto:${email}`} style={{ color: "#4B5563" }}>
            {email}
          </a>
        </span>
      )}
      {timeZone && (
        <span style={{ color: "#6B7280", fontSize: "13px", fontWeight: 400, marginLeft: "4px" }}>
          ({timeZone})
        </span>
      )}
    </div>
  );
};

export function WhoInfo(props: {
  calEvent: CalendarEvent;
  t: TFunction;
  /** When true, uses Calendly-style role labels: "host" instead of "organizer", "invitee" instead of "guest". */
  useCalendlyRoleLabels?: boolean;
}) {
  const { t, useCalendlyRoleLabels = false } = props;
  const organizerRole = useCalendlyRoleLabels ? t("host") : t("organizer");
  const guestRole = useCalendlyRoleLabels ? t("invitee") : t("guest");
  return (
    <Info
      label={t("who")}
      description={
        <>
          <PersonInfo
            name={props.calEvent.organizer.name}
            role={organizerRole}
            email={props.calEvent.hideOrganizerEmail ? "" : props.calEvent.organizer.email}
            timeZone={props.calEvent.organizer.timeZone}
          />
          {props.calEvent.team?.members.map((member) => (
            <PersonInfo
              key={member.name}
              name={member.name}
              role={t("team_member")}
              email={props.calEvent.hideOrganizerEmail ? "" : member?.email}
              timeZone={member.timeZone}
            />
          ))}
          {props.calEvent.attendees.map((attendee) => (
            <PersonInfo
              key={attendee.id || attendee.name}
              name={attendee.name}
              role={guestRole}
              email={attendee.email}
              phoneNumber={attendee.phoneNumber ?? undefined}
              timeZone={attendee.timeZone}
            />
          ))}
        </>
      }
      withSpacer
    />
  );
}
