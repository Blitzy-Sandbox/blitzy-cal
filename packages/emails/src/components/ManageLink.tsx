import { getBookingUrl, getCancelLink, getRescheduleLink } from "@calcom/lib/CalEventParser";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";

export function ManageLink(props: {
  calEvent: CalendarEvent;
  attendee: Person;
  /** NF-001: When true, renders a "Book a new time" rebook CTA linking to the event type booking page.
   *  Designed for cancellation email contexts where Calendly-parity rebook action is needed.
   *  Defaults to false for backward compatibility with existing templates. */
  showRebookLink?: boolean;
}) {
  // Only the original attendee can make changes to the event
  // Guests cannot
  const t = props.attendee.language.translate;
  const cancelLink = getCancelLink(
    {
      platformClientId: props.calEvent.platformClientId,
      platformCancelUrl: props.calEvent.platformCancelUrl,
      type: props.calEvent.type,
      organizer: props.calEvent.organizer,
      recurringEvent: props.calEvent.recurringEvent,
      bookerUrl: props.calEvent.bookerUrl,
      uid: props.calEvent.uid,
      attendeeSeatId: props.calEvent.attendeeSeatId,
      team: props.calEvent.team,
    },
    props.attendee
  );
  const rescheduleLink = getRescheduleLink({ calEvent: props.calEvent, attendee: props.attendee });
  const bookingLink = getBookingUrl({
    platformClientId: props.calEvent.platformClientId,
    platformBookingUrl: props.calEvent.platformBookingUrl,
    bookerUrl: props.calEvent.bookerUrl,
    type: props.calEvent.type,
    uid: props.calEvent.uid,
    organizer: props.calEvent.organizer,
    attendeeSeatId: props.calEvent.attendeeSeatId,
  });

  // NF-001: Compute rebook link — points to the event type booking page so the attendee can
  // quickly book the same event type again after cancellation (Calendly CTA parity).
  // Only computed when showRebookLink is enabled; requires bookerUrl and organizer username
  // to construct a valid event type URL (e.g., https://cal.com/username/30min).
  const rebookLink =
    props.showRebookLink && props.calEvent.bookerUrl && props.calEvent.organizer.username
      ? `${props.calEvent.bookerUrl}/${props.calEvent.organizer.username}/${props.calEvent.type}`
      : "";

  const isOriginalAttendee = props.attendee.email === props.calEvent.attendees[0]?.email;
  const isOrganizer = props.calEvent.organizer.email === props.attendee.email;
  const hasCancelLink = Boolean(cancelLink) && !props.calEvent.disableCancelling;
  const hasRescheduleLink = Boolean(rescheduleLink) && !props.calEvent.disableRescheduling;
  const hasBookingLink = Boolean(bookingLink);
  const isRecurringEvent = props.calEvent.recurringEvent;
  const shouldDisplayRescheduleLink = Boolean(hasRescheduleLink && !isRecurringEvent);
  const isTeamMember = props.calEvent.team?.members.some((member) => props.attendee.email === member.email);
  const hasRebookLink = Boolean(rebookLink);

  if (
    (isOriginalAttendee || isOrganizer || isTeamMember) &&
    (hasCancelLink || (!isRecurringEvent && hasRescheduleLink) || hasBookingLink || hasRebookLink)
  ) {
    return (
      <div
        style={{
          fontFamily: "Roboto, Helvetica, sans-serif",
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "0px",
          textAlign: "left",
          color: "#101010",
        }}>
        <p
          style={{
            fontWeight: 400,
            lineHeight: "24px",
            textAlign: "center",
            width: "100%",
          }}>
          {(shouldDisplayRescheduleLink || hasCancelLink) && <>{t("need_to_make_a_change")}</>}
          {shouldDisplayRescheduleLink && (
            <span>
              <a
                href={rescheduleLink}
                style={{
                  color: "#374151",
                  marginLeft: "5px",
                  marginRight: "5px",
                  textDecoration: "underline",
                }}>
                <>{t("reschedule")}</>
              </a>
              {hasCancelLink && <>{t("or_lowercase")}</>}
            </span>
          )}
          {hasCancelLink && (
            <span>
              <a
                href={cancelLink}
                style={{
                  color: "#374151",
                  marginLeft: "5px",
                  textDecoration: "underline",
                }}>
                <>{t("cancel")}</>
              </a>
            </span>
          )}

          {props.calEvent.platformClientId && hasBookingLink && (
            <span>
              {(hasCancelLink || shouldDisplayRescheduleLink) && (
                <span
                  style={{
                    marginLeft: "5px",
                  }}>
                  {t("or_lowercase")}
                </span>
              )}
              <a
                href={bookingLink}
                style={{
                  color: "#374151",
                  marginLeft: "5px",
                  textDecoration: "underline",
                }}>
                <>{t("check_here")}</>
              </a>
            </span>
          )}

          {/* NF-001: Rebook CTA for Calendly parity — shown in cancellation email contexts */}
          {hasRebookLink && (
            <span>
              {(hasCancelLink ||
                shouldDisplayRescheduleLink ||
                (props.calEvent.platformClientId && hasBookingLink)) && (
                <span
                  style={{
                    marginLeft: "5px",
                  }}>
                  {t("or_lowercase")}
                </span>
              )}
              <a
                href={rebookLink}
                style={{
                  color: "#374151",
                  marginLeft: "5px",
                  textDecoration: "underline",
                }}>
                <>{t("book_a_new_time")}</>
              </a>
            </span>
          )}
        </p>
      </div>
    );
  }

  // Don't have the rights to the manage link
  return null;
}
