import { CallToActionIcon } from "./CallToActionIcon";

export const CallToAction = (props: {
  label: string;
  href?: string;
  secondary?: boolean;
  /** Action type variant: "primary" (default), "secondary", or "danger" (cancel/reschedule). Overrides `secondary` boolean when set. */
  variant?: "primary" | "secondary" | "danger";
  /** When true, CTA spans full email width with block display and centered text. */
  fullWidth?: boolean;
  startIconName?: string;
  endIconName?: string;
}) => {
  const { label, href, secondary, variant, fullWidth, startIconName, endIconName } = props;

  const calculatePadding = () => {
    const paddingTop = "0.625rem";
    const paddingBottom = "0.625rem";
    let paddingLeft = "1rem";
    let paddingRight = "1rem";

    if (startIconName) {
      paddingLeft = "0.875rem";
    } else if (endIconName) {
      paddingRight = "0.875rem";
    }

    return `${paddingTop} ${paddingRight} ${paddingBottom} ${paddingLeft}`;
  };

  // Compute background color: variant takes full priority when set, otherwise fall back to secondary boolean
  const getBackgroundColor = () => {
    if (variant === "danger") return "#DC2626";
    if (variant === "secondary") return "#FFFFFF";
    if (variant === "primary") return "#292929";
    // Fallback to secondary boolean when variant is not set
    if (secondary) return "#FFFFFF";
    return "#292929"; // primary default
  };

  // Compute text color: variant takes full priority when set, otherwise fall back to secondary boolean
  const getTextColor = () => {
    if (variant === "danger") return "#FFFFFF";
    if (variant === "secondary") return "#292929";
    if (variant === "primary") return "#FFFFFF";
    // Fallback to secondary boolean when variant is not set
    if (secondary) return "#292929";
    return "#FFFFFF"; // primary default
  };

  // Compute border: variant takes full priority when set, otherwise fall back to secondary boolean
  const getBorder = () => {
    if (variant === "secondary") return "1px solid #d1d5db";
    if (variant) return ""; // variant is set to primary or danger — no border
    // Fallback to secondary boolean when variant is not set
    if (secondary) return "1px solid #d1d5db";
    return "";
  };

  const El = href ? "a" : "button";
  const restProps = href ? { href, target: "_blank" } : { type: "submit" };

  return (
    <p
      style={{
        display: fullWidth ? "block" : "inline-block",
        ...(fullWidth ? { width: "100%", textAlign: "center" as const } : {}),
        background: getBackgroundColor(),
        border: getBorder(),
        color: "#ffffff",
        fontFamily: "Roboto, Helvetica, sans-serif",
        fontSize: "0.875rem",
        fontWeight: 500,
        lineHeight: "1rem",
        margin: 0,
        textDecoration: "none",
        textTransform: "none",
        padding: calculatePadding(),
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        msoPaddingAlt: "0px",
        borderRadius: "6px",
        boxSizing: "border-box",
        height: "2.25rem",
      }}>
      {/* @ts-expect-error shared props between href and button */}
      <El
        style={{
          color: getTextColor(),
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "auto",
          appearance: "none",
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: "inherit",
          fontWeight: 500,
          lineHeight: "1rem",
          cursor: "pointer",
        }}
        {...restProps}
        rel="noreferrer">
        {startIconName && (
          <CallToActionIcon
            style={{
              marginRight: "0.5rem",
              marginLeft: 0,
            }}
            iconName={startIconName}
          />
        )}
        {label}
        {endIconName && <CallToActionIcon iconName={endIconName} />}
      </El>
    </p>
  );
};
