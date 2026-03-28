import * as templates from "./templates";

/**
 * Configuration options for post-render processing of email HTML.
 *
 * These options allow callers to enrich the rendered HTML output with
 * metadata that supports downstream processing such as analytics,
 * delivery tracking, and notification categorization for Calendly
 * parity (NF-001).
 */
interface RenderEmailOptions {
  /**
   * Optional email type identifier injected as a `<meta>` tag into the
   * rendered HTML `<head>`.  When provided, a
   * `<meta name="x-cal-email-type" content="...">` element is inserted
   * immediately after the opening `<head>` tag so that downstream
   * processors (delivery pipelines, analytics hooks, workflow engines)
   * can distinguish between confirmation, cancellation, reminder,
   * follow-up, workflow-triggered, and other notification categories
   * without re-parsing the email body.
   *
   * Acceptable values align with the `EmailType` enum exported from
   * `packages/emails/email-types.ts`.  When omitted or `undefined`,
   * no metadata tag is injected and the output matches the original
   * rendering behavior exactly.
   */
  emailType?: string;
}

/**
 * Renders an email template component to sanitised, namespace-augmented
 * static HTML suitable for delivery via SMTP / SendGrid / Resend.
 *
 * **Rendering pipeline (executed in strict order):**
 * 1. Resolve the template component from the `./templates` namespace.
 * 2. Dynamically import `react-dom/server` (kept dynamic for bundle
 *    optimisation — the server package is only loaded when rendering).
 * 3. Call `ReactDOMServer.renderToStaticMarkup` to produce raw HTML.
 * 4. Strip empty `<script></script>` artefacts left by the `RawHtml`
 *    component's `dangerouslySetInnerHTML` injection technique.
 * 5. *(Additive — NF-001)* If `options.emailType` is provided, inject
 *    a `<meta name="x-cal-email-type">` tag after the opening `<head>`
 *    element for downstream processing metadata.
 * 6. Replace the bare `<html>` tag with one carrying `xmlns`,
 *    `xmlns:v` (VML), and `xmlns:o` (Office) namespace declarations
 *    required by Outlook / MSO rendering engines.
 *
 * @template K - A valid template name from `./templates/index.ts`.
 * @param template  - Template key matching an export from `./templates`.
 * @param props     - Props inferred from the selected template component.
 * @param options   - Optional rendering configuration.  Defaults to `{}`
 *                    for full backward compatibility — existing callers
 *                    that pass only two arguments are unaffected.
 * @returns A `Promise<string>` resolving to the sanitised HTML output.
 */
async function renderEmail<K extends keyof typeof templates>(
  template: K,
  props: React.ComponentProps<(typeof templates)[K]>,
  options: RenderEmailOptions = {}
): Promise<string> {
  const Component = templates[template];
  const ReactDOMServer = (await import("react-dom/server")).default;

  // --- Step 1: Render to static HTML ----------------------------------------
  let html: string =
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    ReactDOMServer.renderToStaticMarkup(Component(props));

  // --- Step 2: Remove `<RawHtml />` injected script artefacts ---------------
  // The RawHtml component uses <script dangerouslySetInnerHTML> to inject raw
  // HTML.  After renderToStaticMarkup, empty <script></script> pairs remain
  // at each injection boundary and must be stripped.
  html = html.replace(/<script><\/script>/g, "");

  // --- Step 3 (NF-001): Inject email-type metadata --------------------------
  // When an emailType is specified, insert a <meta> tag immediately after the
  // opening <head> element.  This allows downstream processors (delivery
  // pipelines, analytics, workflow engines) to identify the notification
  // category without re-parsing the full email body.
  //
  // The value is sanitised to contain only word characters, hyphens, and
  // underscores so that it cannot break out of the HTML attribute context.
  if (options.emailType) {
    const sanitisedType = options.emailType.replace(/[^\w-]/g, "");
    html = html.replace(
      "<head>",
      `<head><meta name="x-cal-email-type" content="${sanitisedType}" />`
    );
  }

  // --- Step 4: Inject xmlns namespace declarations for Outlook / MSO --------
  html = html.replace(
    "<html>",
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">`
  );

  return html;
}

export default renderEmail;
