/* eslint-disable @next/next/no-head-element */
import BaseTable from "./BaseTable";
import EmailBodyLogo from "./EmailBodyLogo";
import EmailHead from "./EmailHead";
import EmailScheduledBodyHeaderContent from "./EmailScheduledBodyHeaderContent";
import EmailSchedulingBodyDivider from "./EmailSchedulingBodyDivider";
import type { BodyHeadType } from "./EmailSchedulingBodyHeader";
import EmailSchedulingBodyHeader from "./EmailSchedulingBodyHeader";
import RawHtml from "./RawHtml";
import Row from "./Row";

const Html = (props: { children: React.ReactNode }) => (
  <>
    <RawHtml html="<!doctype html>" />
    <html>{props.children}</html>
  </>
);

/** Accent color mapping for Calendly-parity email category border differentiation (NF-001). */
const EMAIL_CATEGORY_ACCENT_COLORS: Record<
  "confirmation" | "reminder" | "cancellation" | "follow-up" | "update",
  string
> = {
  confirmation: "#16A34A",
  reminder: "#2563EB",
  cancellation: "#DC2626",
  "follow-up": "#7C3AED",
  update: "#D97706",
};

export const BaseEmailHtml = (props: {
  children: React.ReactNode;
  callToAction?: React.ReactNode;
  subject: string;
  title?: string;
  subtitle?: React.ReactNode | string;
  headerType?: BodyHeadType;
  hideLogo?: boolean;
  /** Optional email category for Calendly-parity accent color border differentiation (NF-001). */
  emailCategory?: "confirmation" | "reminder" | "cancellation" | "follow-up" | "update";
  /** Optional preheader text hidden from visual rendering but visible to email client preview panes (NF-001). */
  preheaderText?: string;
  /** Optional additional sections rendered after children content, before the CTA area (NF-001). */
  additionalSections?: React.ReactNode;
}) => {
  const accentColor = props.emailCategory
    ? EMAIL_CATEGORY_ACCENT_COLORS[props.emailCategory]
    : undefined;

  return (
    <Html>
      <EmailHead title={props.subject} />
      <body style={{ wordSpacing: "normal", backgroundColor: "#F3F4F6" }}>
        <div style={{ backgroundColor: "#F3F4F6" }}>
          {props.preheaderText && (
            <div
              style={{
                display: "none",
                fontSize: "1px",
                color: "#F3F4F6",
                lineHeight: "1px",
                maxHeight: "0px",
                maxWidth: "0px",
                opacity: 0,
                overflow: "hidden",
              }}>
              {props.preheaderText}
            </div>
          )}
          <RawHtml
            html={`<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
          />
          <div style={{ margin: "0px auto", maxWidth: 600 }}>
            <Row align="center" border="0" style={{ width: "100%" }}>
              <td
                style={{
                  direction: "ltr",
                  fontSize: "0px",
                  padding: "0px",
                  paddingTop: "40px",
                  textAlign: "center",
                }}>
                <RawHtml
                  html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr></tr></table><![endif]-->`}
                />
              </td>
            </Row>
          </div>
          <div
            style={{
              margin: "0px auto",
              maxWidth: 600,
              borderRadius: "8px",
              border: "1px solid #E5E7EB",
              padding: "2px",
              backgroundColor: "#FFFFFF",
              ...(accentColor ? { borderTop: `3px solid ${accentColor}` } : {}),
            }}>
            {props.headerType && (
              <EmailSchedulingBodyHeader headerType={props.headerType} headStyles={{ border: 0 }} />
            )}
            {props.title && (
              <EmailScheduledBodyHeaderContent
                headStyles={{ border: 0 }}
                title={props.title}
                subtitle={props.subtitle}
              />
            )}
            {(props.headerType || props.title || props.subtitle) && (
              <EmailSchedulingBodyDivider headStyles={{ border: 0 }} />
            )}

            <RawHtml
              html={`<!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" className="" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
            />
            <div
              style={{
                background: "#FFFFFF",
                backgroundColor: "#FFFFFF",
                margin: "0px auto",
                maxWidth: 600,
              }}>
              <Row
                align="center"
                border="0"
                style={{ background: "#FFFFFF", backgroundColor: "#FFFFFF", width: "100%" }}>
                <td
                  style={{
                    direction: "ltr",
                    fontSize: 0,
                    padding: 0,
                    textAlign: "center",
                  }}>
                  <RawHtml
                    html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td className="" style="vertical-align:top;width:598px;" ><![endif]-->`}
                  />
                  <div
                    className="mj-column-per-100 mj-outlook-group-fix"
                    style={{
                      fontSize: 0,
                      textAlign: "left",
                      direction: "ltr",
                      display: "inline-block",
                      verticalAlign: "top",
                      width: "100%",
                    }}>
                    <Row border="0" style={{ verticalAlign: "top" }} width="100%">
                      <td align="left" style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                        <div
                          style={{
                            fontFamily: "Roboto, Helvetica, sans-serif",
                            fontSize: 16,
                            fontWeight: 500,
                            lineHeight: 1,
                            textAlign: "left",
                            color: "#101010",
                          }}>
                          {props.children}
                        </div>
                      </td>
                    </Row>
                    {props.additionalSections && (
                      <Row border="0" style={{ verticalAlign: "top" }} width="100%">
                        <td
                          align="left"
                          style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                          {props.additionalSections}
                        </td>
                      </Row>
                    )}
                  </div>
                  <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
                </td>
              </Row>
            </div>
            {props.callToAction && <EmailSchedulingBodyDivider headStyles={{ border: 0 }} />}
            <RawHtml
              html={`<!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" className="" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
            />

            <div
              style={{
                background: "#FFFFFF",
                backgroundColor: "#FFFFFF",
                margin: "0px auto",
                maxWidth: 600,
              }}>
              <Row
                align="center"
                border="0"
                style={{ background: "#FFFFFF", backgroundColor: "#FFFFFF", width: "100%" }}>
                <td
                  style={{
                    direction: "ltr",
                    fontSize: 0,
                    padding: 0,
                    textAlign: "center",
                  }}>
                  <RawHtml
                    html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td className="" style="vertical-align:top;width:598px;" ><![endif]-->`}
                  />
                  {props.callToAction && (
                    <div
                      className="mj-column-per-100 mj-outlook-group-fix"
                      style={{
                        fontSize: 0,
                        textAlign: "left",
                        direction: "ltr",
                        display: "inline-block",
                        verticalAlign: "top",
                        width: "100%",
                      }}>
                      <BaseTable border="0" style={{ verticalAlign: "top" }} width="100%">
                        <tbody>
                          <tr>
                            <td
                              align="center"
                              vertical-align="middle"
                              style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                              {props.callToAction}
                            </td>
                          </tr>
                          <tr>
                            <td
                              align="left"
                              style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                              <div
                                style={{
                                  fontFamily: "Roboto, Helvetica, sans-serif",
                                  fontSize: 13,
                                  lineHeight: 1,
                                  textAlign: "left",
                                  color: "#000000",
                                }}
                              />
                            </td>
                          </tr>
                        </tbody>
                      </BaseTable>
                    </div>
                  )}
                  <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
                </td>
              </Row>
            </div>
          </div>
          {!Boolean(props.hideLogo) && <EmailBodyLogo />}
          <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
        </div>
      </body>
    </Html>
  );
};
