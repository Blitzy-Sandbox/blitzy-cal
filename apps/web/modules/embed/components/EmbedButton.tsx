/**
 * EmbedButton — EM-004 Share Flow Embed Trigger Button
 *
 * Dedicated module for the embed trigger button component.
 * This re-exports the EmbedButton from Embed.tsx for consistent module structure
 * and extends it with EM-004 share flow convenience utilities.
 *
 * The EmbedButton opens the embed configuration dialog when clicked,
 * supporting all embed types (inline, floating-popup, element-click).
 *
 * Usage:
 * ```tsx
 * import { EmbedButton, ShareEmbedButton } from "./EmbedButton";
 *
 * // Standard embed button (opens embed dialog)
 * <EmbedButton embedUrl="/my-cal" namespace="default" />
 *
 * // Share-focused embed button with copy-link shortcut
 * <ShareEmbedButton embedUrl="/my-cal" namespace="default" />
 * ```
 *
 * @module EmbedButton
 */

import type React from "react";
import { useCallback } from "react";

import { Button } from "@calcom/ui/components/button";
import { showToast } from "@calcom/ui/components/toast";

/**
 * Props for the ShareEmbedButton component.
 * Extends standard HTML button attributes with embed-specific configuration.
 */
interface ShareEmbedButtonProps {
  /** The booking link URL path to share (e.g., "/john/30min") */
  embedUrl: string;
  /** Cal.com namespace for multi-embed isolation */
  namespace: string;
  /** The base origin URL for generating absolute share links */
  calOrigin?: string;
  /** Child elements to render inside the button */
  children?: React.ReactNode;
  /** Additional CSS classes for the button */
  className?: string;
}

/**
 * Resolves the origin URL for generating absolute share links.
 * Uses the provided calOrigin if available, otherwise falls back to the current window origin.
 */
function resolveOrigin(calOrigin: string | undefined): string {
  if (calOrigin) {
    return calOrigin;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

/**
 * ShareEmbedButton — A convenience button that copies the direct booking link
 * to the clipboard with a single click. Provides EM-004 share flow shortcut
 * for quickly sharing booking links without opening the full embed dialog.
 *
 * Generates the booking link from the provided embedUrl and calOrigin,
 * copies it to the clipboard, and displays a toast notification.
 *
 * The `namespace` prop is accepted for API consistency with other embed components
 * and is passed as a data attribute for testing and potential future use.
 */
export function ShareEmbedButton({
  embedUrl,
  namespace,
  calOrigin,
  children,
  className = "",
}: ShareEmbedButtonProps): React.ReactElement {
  const handleCopyLink = useCallback(async (): Promise<void> => {
    const origin = resolveOrigin(calOrigin);
    const shareLink = `${origin}/${embedUrl.replace(/^\//, "")}`;

    try {
      await navigator.clipboard.writeText(shareLink);
      showToast("Link copied to clipboard", "success");
    } catch {
      // Fallback for older browsers or restricted contexts
      const textArea = document.createElement("textarea");
      textArea.value = shareLink;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        showToast("Link copied to clipboard", "success");
      } catch {
        showToast("Failed to copy link", "error");
      } finally {
        document.body.removeChild(textArea);
      }
    }
  }, [embedUrl, calOrigin]);

  return (
    <Button
      type="button"
      className={className}
      data-test-embed-url={embedUrl}
      data-cal-namespace={namespace}
      data-testid="share-embed"
      onClick={handleCopyLink}>
      {children ?? "Copy link"}
    </Button>
  );
}

// Re-export the base EmbedButton from the main Embed module for consistent imports
export { EmbedButton } from "./Embed";
export type { default as EmbedDialogProps } from "./Embed";
export default ShareEmbedButton;
