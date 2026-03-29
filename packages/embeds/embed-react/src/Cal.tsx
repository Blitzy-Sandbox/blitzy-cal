"use client";

import { useEffect, useRef } from "react";

import type { PrefillAndIframeAttrsConfig, UiConfig } from "@calcom/embed-core";

import useEmbed from "./useEmbed";

type CalProps = {
  calOrigin?: string;
  calLink: string;
  initConfig?: {
    debug?: boolean;
    uiDebug?: boolean;
  };
  namespace?: string;
  config?: PrefillAndIframeAttrsConfig;
  embedJsUrl?: string;
  /** Full UI configuration for Calendly parity (EM-001, EM-004). Supports hideEventTypeDetails, styles, theme, layout, colorScheme, and modal customization. */
  uiConfig?: UiConfig;
  /** Convenience shortcut to hide event type details in the embed (Calendly parity EM-001). Merged into uiConfig when provided. */
  hideEventTypeDetails?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

const Cal = function Cal(props: CalProps) {
  const { calLink, calOrigin, namespace = "", config, initConfig = {}, embedJsUrl, uiConfig, hideEventTypeDetails, ...restProps } =
    props;
  if (!calLink) {
    throw new Error("calLink is required");
  }
  const initializedRef = useRef(false);
  const Cal = useEmbed(embedJsUrl);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!Cal || initializedRef.current || !ref.current) {
      return;
    }
    initializedRef.current = true;
    const element = ref.current;

    // Merge UI configuration for Calendly parity (EM-001, EM-004)
    const mergedUiConfig: UiConfig = {
      ...uiConfig,
      ...(hideEventTypeDetails !== undefined ? { hideEventTypeDetails } : {}),
    };
    const hasUiConfig = Object.keys(mergedUiConfig).length > 0;

    if (namespace) {
      Cal("init", namespace, {
        ...initConfig,
        origin: calOrigin,
      });
      Cal.ns[namespace]("inline", {
        elementOrSelector: element,
        calLink,
        config,
      });
      if (hasUiConfig) {
        Cal.ns[namespace]("ui", mergedUiConfig);
      }
    } else {
      Cal("init", {
        ...initConfig,
        origin: calOrigin,
      });
      Cal("inline", {
        elementOrSelector: element,
        calLink,
        config,
      });
      if (hasUiConfig) {
        Cal("ui", mergedUiConfig);
      }
    }
  }, [Cal, calLink, config, namespace, calOrigin, initConfig, uiConfig, hideEventTypeDetails]);

  if (!Cal) {
    return null;
  }

  return <div ref={ref} {...restProps} />;
};
export default Cal;
