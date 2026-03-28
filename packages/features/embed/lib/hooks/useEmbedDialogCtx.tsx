import type React from "react";
import { createContext, useContext, useState } from "react";

import type { EmbedState } from "../../types";

type EmbedDialogContextType = {
  embedState: EmbedState;
  setEmbedState: React.Dispatch<React.SetStateAction<EmbedState>>;
};

const EmbedDialogContext = createContext<EmbedDialogContextType | null>(null);

/**
 * Provider for embed dialog state, including share flow configuration.
 * Supports all EmbedState fields including the shareMode field for share flow parity.
 */
export function EmbedDialogProvider({ children }: { children: React.ReactNode }) {
  const [embedState, setEmbedState] = useState<EmbedState>(null);
  return (
    <EmbedDialogContext.Provider value={{ embedState, setEmbedState }}>
      {children}
    </EmbedDialogContext.Provider>
  );
}

/**
 * Hook to access embed dialog context state.
 * When noQueryParamMode is true, requires an EmbedDialogProvider ancestor.
 * When false, returns stub values with null embedState and no-op setter.
 * Supports extended EmbedState including shareMode for share flow parity.
 */
export function useEmbedDialogCtx(noQueryParamMode: boolean) {
  const context = useContext(EmbedDialogContext);
  if (noQueryParamMode) {
    if (!context) {
      throw new Error("useEmbedDialogCtx must be used within an EmbedDialogProvider");
    }
    return context;
  } else {
    return {
      embedState: null,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      setEmbedState: ((_state: EmbedState) => {}) as React.Dispatch<React.SetStateAction<EmbedState>>,
    };
  }
}
