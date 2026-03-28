import { WEBSITE_URL, IS_SELF_HOSTED, WEBAPP_URL } from "@calcom/lib/constants";

import type { PreviewState } from "../types";
import { embedLibUrl } from "./constants";
import { getApiNameForReactSnippet, getApiNameForVanillaJsSnippet } from "./getApiName";
import { getDimension } from "./getDimension";

export const doWeNeedCalOriginProp = (embedCalOrigin: string) => {
  // If we are self hosted, calOrigin won't be app.cal.com so we need to pass it
  // If we are not self hosted but it's still different from WEBAPP_URL and WEBSITE_URL, we need to pass it -> It happens for organization booking URL at the moment
  return IS_SELF_HOSTED || (embedCalOrigin !== WEBAPP_URL && embedCalOrigin !== WEBSITE_URL);
};

/**
 * Generates a shareable booking link URL with optional embed, prefill, UTM, and custom query parameters.
 * Supports both event type URLs (e.g., "username/event-slug") and routing form URLs (e.g., "forms/form-slug")
 * for Calendly-equivalent share flow parity (EM-004).
 *
 * All config fields are optional — the function works with minimal input (just calLink and embedCalOrigin).
 * URL encoding is handled automatically via URLSearchParams.
 *
 * @param calLink - The cal link path segment (event type slug or routing form slug)
 * @param embedCalOrigin - The embed cal origin URL
 * @param embedType - Optional embed type: "inline", "popup", "floating" add an embed query param; "link" produces a direct URL
 * @param config - Optional configuration for redirect, prefill, UTM, and custom query parameters
 * @returns The complete shareable URL string with properly encoded query parameters
 */
export function generateShareableLink({
  calLink,
  embedCalOrigin,
  embedType,
  config,
}: {
  calLink: string;
  embedCalOrigin: string;
  embedType?: "inline" | "popup" | "floating" | "link";
  config?: {
    redirectUrl?: string;
    prefill?: {
      name?: string;
      email?: string;
      guests?: string[];
      customFields?: Record<string, string>;
    };
    utmParams?: Record<string, string>;
    customQueryParams?: Record<string, string>;
  };
}): string {
  const baseUrl = doWeNeedCalOriginProp(embedCalOrigin)
    ? `${embedCalOrigin}/${calLink}`
    : `${WEBAPP_URL}/${calLink}`;

  const params = new URLSearchParams();

  // Add embed param based on embedType (only if not "link" — direct links have no embed query param)
  if (embedType && embedType !== "link") {
    params.set("embed", embedType);
  }

  if (config) {
    // Add redirectUrl if provided
    if (config.redirectUrl) {
      params.set("redirectUrl", config.redirectUrl);
    }

    // Add prefill params if provided
    if (config.prefill) {
      const { name, email, guests, customFields } = config.prefill;

      if (name) {
        params.set("name", name);
      }
      if (email) {
        params.set("email", email);
      }
      if (guests && guests.length > 0) {
        params.set("guests", guests.join(","));
      }
      if (customFields) {
        for (const [key, value] of Object.entries(customFields)) {
          params.set(`field_${key}`, value);
        }
      }
    }

    // Add UTM params as-is (keys like utm_source, utm_medium, etc.)
    if (config.utmParams) {
      for (const [key, value] of Object.entries(config.utmParams)) {
        params.set(key, value);
      }
    }

    // Add custom query params as-is
    if (config.customQueryParams) {
      for (const [key, value] of Object.entries(config.customQueryParams)) {
        params.set(key, value);
      }
    }
  }

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

/**
 * Generates a set of share-ready embed links for all supported embed types plus a direct booking link.
 * Leverages the existing Codes snippet architecture and generateShareableLink to produce properly
 * formatted URLs for Calendly-equivalent share flows (EM-004).
 *
 * Works for both event type calLinks ("username/event-slug") and routing form calLinks ("forms/form-slug").
 * When previewState.shareConfig is present, its customQueryParams are included in all generated links.
 *
 * @param calLink - The cal link path segment (event type slug or routing form slug)
 * @param embedCalOrigin - The embed cal origin URL
 * @param namespace - The embed namespace identifier
 * @param previewState - The current preview state with inline dimensions, floating config, and optional shareConfig
 * @returns Object containing shareable links for inline, popup, floating, and direct link modes
 */
export function generateShareFlowSnippets({
  calLink,
  embedCalOrigin,
  namespace,
  previewState,
}: {
  calLink: string;
  embedCalOrigin: string;
  namespace: string;
  previewState: PreviewState;
}): {
  inlineShareLink: string;
  popupShareLink: string;
  floatingShareLink: string;
  directLink: string;
} {
  const shareConfig = previewState.shareConfig;
  const customQueryParams = shareConfig?.customQueryParams;

  // Build config object only when there are custom query params from the share flow configuration
  const shareFlowConfig = customQueryParams ? { customQueryParams } : undefined;

  const inlineShareLink = generateShareableLink({
    calLink,
    embedCalOrigin,
    embedType: "inline",
    config: shareFlowConfig,
  });

  const popupShareLink = generateShareableLink({
    calLink,
    embedCalOrigin,
    embedType: "popup",
    config: shareFlowConfig,
  });

  const floatingShareLink = generateShareableLink({
    calLink,
    embedCalOrigin,
    embedType: "floating",
    config: shareFlowConfig,
  });

  const directLink = generateShareableLink({
    calLink,
    embedCalOrigin,
    embedType: "link",
    config: shareFlowConfig,
  });

  return {
    inlineShareLink,
    popupShareLink,
    floatingShareLink,
    directLink,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Codes = {
  react: {
    inline: ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["inline"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      const width = getDimension(previewState.width);
      const height = getDimension(previewState.height);
      const namespaceProp = `${namespace ? `namespace="${namespace}"` : ""}`;
      const argumentForGetCalApi = getArgumentForGetCalApi(namespace);
      return code`
import Cal, { getCalApi } from "@calcom/embed-react";
import { useEffect } from "react";
export default function MyApp() {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi(${argumentForGetCalApi ? JSON.stringify(argumentForGetCalApi) : ""});
      ${uiInstructionCode}
    })();
  }, [])
  return <Cal ${namespaceProp}
    calLink="${calLink}"
    style={{width:"${width}",height:"${height}",overflow:"scroll"}}
    config={${JSON.stringify(previewState.config)}}
    ${doWeNeedCalOriginProp(embedCalOrigin) ? `calOrigin="${embedCalOrigin}"` : ""}
    ${IS_SELF_HOSTED ? `embedJsUrl="${embedLibUrl}"` : ""}
  />;
};`;
    },
    "floating-popup": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      embedCalOrigin: string;
      uiInstructionCode: string;
      namespace: string;
      previewState: PreviewState["floatingPopup"];
    }) => {
      const argumentForGetCalApi = getArgumentForGetCalApi(namespace);
      const floatingButtonArg = JSON.stringify({
        calLink,
        ...(doWeNeedCalOriginProp(embedCalOrigin) ? { calOrigin: embedCalOrigin } : null),
        ...previewState,
      });
      return code`
import { getCalApi } from "@calcom/embed-react";
import { useEffect } from "react";
export default function MyApp() {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi(${argumentForGetCalApi ? JSON.stringify(argumentForGetCalApi) : ""});
      ${getApiNameForReactSnippet({ mainApiName: "cal" })}("floatingButton", ${floatingButtonArg});
      ${uiInstructionCode}
    })();
  }, [])
};`;
    },
    "element-click": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["elementClick"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      const argumentForGetCalApi = getArgumentForGetCalApi(namespace);
      return code`
import { getCalApi } from "@calcom/embed-react";
import { useEffect } from "react";
export default function MyApp() {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi(${argumentForGetCalApi ? JSON.stringify(argumentForGetCalApi) : ""});
      ${uiInstructionCode}
    })();
  }, [])
  return <button data-cal-namespace="${namespace}"
    data-cal-link="${calLink}"
    ${doWeNeedCalOriginProp(embedCalOrigin) ? `data-cal-origin="${embedCalOrigin}"` : ""}
    ${`data-cal-config='${JSON.stringify(previewState.config)}'`}
  >Click me</button>;
};`;
    },
    headless: () => {
      return null;
    },
  },
  "react-atom": {
    inline: ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["inline"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      return code`
import { BookerEmbed } from "@calcom/atoms";

// You might need to define or import BookerProps depending on your setup
// For example: type BookerProps = { eventTypeSlug: string; calUsername: string; /* other props */ };
export default function Booker( props : BookerProps ) {
  return (
    <>
      <BookerEmbed
        // Use the parsed username and event slug from calLink
        eventSlug={eventSlug}
        // layout can be of three types: COLUMN_VIEW, MONTH_VIEW or WEEK_VIEW, 
        // you can choose whichever you prefer
        view="${previewState.config?.layout || "MONTH_VIEW"}"
        username={calUsername}
        customClassNames={{
          bookerContainer: "border-subtle border",
        }}
        onCreateBookingSuccess={() => {
          console.log("booking created successfully");
        }}
      />
    </>
  );
};`;
    },
    "floating-popup": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      embedCalOrigin: string;
      uiInstructionCode: string;
      namespace: string;
      previewState: PreviewState["floatingPopup"];
    }) => {
      return code`
import { BookerEmbed } from "@calcom/atoms";

// You might need to define or import BookerProps depending on your setup
export default function Booker( props : BookerProps ) {
  return (
    <>
      <BookerEmbed
        // Use the parsed username and event slug from calLink
        eventSlug={eventSlug}
        // layout can be of three types: COLUMN_VIEW, MONTH_VIEW or WEEK_VIEW, 
        // you can choose whichever you prefer
        view="${previewState.config?.layout || "MONTH_VIEW"}"
        username={calUsername}
        customClassNames={{
          bookerContainer: "border-subtle border",
        }}
        onCreateBookingSuccess={() => {
          console.log("booking created successfully");
        }}
      />
    </>
  );
};`;
    },
    "element-click": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["elementClick"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      return code`
import { BookerEmbed } from "@calcom/atoms";

// You might need to define or import BookerProps depending on your setup
export default function Booker( props : BookerProps ) {
  return (
    <>
      <BookerEmbed
        // Use the parsed username and event slug from calLink
        eventSlug={eventSlug}
        // layout can be of three types: COLUMN_VIEW, MONTH_VIEW or WEEK_VIEW, 
        // you can choose whichever you prefer
        view="${previewState.config?.layout || "MONTH_VIEW"}"
        username={calUsername}
        customClassNames={{
          bookerContainer: "border-subtle border",
        }}
        onCreateBookingSuccess={() => {
          console.log("booking created successfully");
        }}
      />
    </>
  );
};`;
    },
    headless: () => {
      return null;
    },
  },
  HTML: {
    inline: ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["inline"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      return code`${getApiNameForVanillaJsSnippet({ namespace, mainApiName: "Cal" })}("inline", {
    elementOrSelector:"#my-cal-inline-${namespace}",
    config: ${JSON.stringify(previewState.config)},
    calLink: "${calLink}",
  });

  ${uiInstructionCode}`;
    },
    "floating-popup": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["floatingPopup"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      const floatingButtonArg = JSON.stringify({
        calLink,
        ...previewState,
      });
      return code`${getApiNameForVanillaJsSnippet({
        namespace,
        mainApiName: "Cal",
      })}("floatingButton", ${floatingButtonArg}); 
  ${uiInstructionCode}`;
    },
    "element-click": ({
      calLink,
      uiInstructionCode,
      previewState,
      embedCalOrigin,
      namespace,
    }: {
      calLink: string;
      uiInstructionCode: string;
      previewState: PreviewState["elementClick"];
      embedCalOrigin: string;
      namespace: string;
    }) => {
      return code`
  // Important: Please add the following attributes to the element that should trigger the calendar to open upon clicking.
  // \`data-cal-link="${calLink}"\`
  // data-cal-namespace="${namespace}"
  // \`data-cal-config='${JSON.stringify(previewState.config)}'\`

  ${uiInstructionCode}`;
    },
    headless: () => {
      return null;
    },
  },
};

/**
 * It allows us to show code with certain reusable blocks indented according to the block variable placement
 * So, if you add a variable ${abc} with indentation of 4 spaces, it will automatically indent all newlines in `abc` with the same indent before constructing the final string
 * `A${var}C` with var = "B" ->   partsWithoutBlock=['A','C'] blocksOrVariables=['B']
 */
const code = (partsWithoutBlock: TemplateStringsArray, ...blocksOrVariables: string[]) => {
  const constructedCode: string[] = [];
  for (let i = 0; i < partsWithoutBlock.length; i++) {
    const partWithoutBlock = partsWithoutBlock[i];
    // blocksOrVariables length would always be 1 less than partsWithoutBlock
    // So, last item should be concatenated as is.
    if (i >= blocksOrVariables.length) {
      constructedCode.push(partWithoutBlock);
      continue;
    }
    const block = blocksOrVariables[i];
    const indentedBlock: string[] = [];
    let indent = "";
    block.split("\n").forEach((line) => {
      indentedBlock.push(line);
    });
    // non-null assertion is okay because we know that we are referencing last element.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const indentationMatch = partWithoutBlock
      .split("\n")
      .at(-1)!
      .match(/(^[\t ]*).*$/);
    if (indentationMatch) {
      indent = indentationMatch[1];
    }
    constructedCode.push(partWithoutBlock + indentedBlock.join(`\n${indent}`));
  }
  return constructedCode.join("");
};

function getArgumentForGetCalApi(namespace: string) {
  const libUrl = IS_SELF_HOSTED ? embedLibUrl : undefined;
  const argumentForGetCalApi = namespace ? { namespace, embedLibUrl: libUrl } : { embedLibUrl: libUrl };
  return argumentForGetCalApi;
}
