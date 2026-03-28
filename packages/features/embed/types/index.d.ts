import type { Brand } from "@calcom/types/utils";

import type { tabs } from "../lib/EmbedTabs";
import type { useEmbedTypes } from "../lib/hooks";

export type EmbedType = "inline" | "floating-popup" | "element-click" | "email" | "headless";

/** Pre-fill configuration for pre-populating booking form fields (Calendly parity: prefill URL parameters). */
export type EmbedPrefillConfig = {
  /** Pre-fill attendee name */
  name?: string;
  /** Pre-fill attendee email */
  email?: string;
  /** Pre-fill guest email addresses */
  guests?: string[];
  /** Pre-fill custom question responses keyed by field identifier */
  customFields?: Record<string, string>;
};

/** Share flow configuration for link generation and UTM tracking (EM-004 share flow parity). */
export type ShareFlowConfig = {
  /** Type of share link to generate — maps to embed suite modes */
  shareType?: "link" | "inline" | "popup" | "floating";
  /** Whether to include UTM tracking parameters in the share link */
  includeUtmParams?: boolean;
  /** Additional query parameters to append to the share link */
  customQueryParams?: Record<string, string>;
};

type EmbedConfig = {
  layout?: BookerLayouts;
  theme?: Theme;
  useSlotsViewOnSmallScreen?: "true" | "false";
  /** URL to redirect to after booking completion (Calendly parity: post-booking redirect) */
  redirectUrl?: string;
  /** Whether to forward parent page query parameters to the booking page (Calendly parity: UTM parameter forwarding) */
  forwardQueryParams?: boolean;
  /** Prefill configuration for pre-populating form fields (Calendly parity: prefill support) */
  prefill?: EmbedPrefillConfig;
};

export type EmbedState = {
  embedType: EmbedType | null;
  embedTabName: string | null;
  embedUrl: string | null;
  eventId: string | null;
  namespace: string | null;
  date: string | null;
  month: string | null;
  /** Current share flow mode (EM-004 share flow parity) */
  shareMode?: string | null;
} | null;

export type PreviewState = {
  inline: Brand<
    {
      width: string;
      height: string;
      config?: EmbedConfig;
    },
    "inline"
  >;
  theme: Theme;
  floatingPopup: Brand<
    {
      config?: EmbedConfig;
      hideButtonIcon?: boolean;
      buttonPosition?: "bottom-left" | "bottom-right";
      buttonColor?: string;
      buttonTextColor?: string;
    },
    "floating-popup"
  >;
  elementClick: Brand<
    {
      config?: EmbedConfig;
    },
    "element-click"
  >;
  palette: {
    brandColor: string | null;
    darkBrandColor: string | null;
  };
  hideEventTypeDetails: boolean;
  layout: BookerLayouts;
  /** Share flow configuration for preview rendering (EM-004 share flow parity) */
  shareConfig?: ShareFlowConfig;
};

export type EmbedFramework = "react" | "react-atom" | "HTML";
export type EmbedTabs = typeof tabs;
export type EmbedTypes = ReturnType<typeof useEmbedTypes>;
