export function getApiNameWithNamespace({
  namespace,
  mainApiName,
}: {
  namespace: string;
  mainApiName: string;
}) {
  const isAValidVariableName = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(namespace);
  // Try to use dot notation if possible because it's more readable otherwise use bracket notation
  return isAValidVariableName ? `${mainApiName}.ns.${namespace}` : `${mainApiName}.ns["${namespace}"]`;
}

function getApiNameWithoutNamespace({ mainApiName }: { mainApiName: string }) {
  return mainApiName;
}

export function getApiNameForReactSnippet({ mainApiName }: { mainApiName: string }) {
  return getApiNameWithoutNamespace({ mainApiName });
}

export function getApiNameForVanillaJsSnippet({
  namespace,
  mainApiName,
}: {
  namespace: string;
  mainApiName: string;
}) {
  return getApiNameWithNamespace({ mainApiName, namespace });
}

/**
 * Unified API name resolver for share flow embed code generation.
 * Delegates to the framework-specific helper based on the embed framework type,
 * providing a single entry point for share flow link generation across both
 * React and vanilla JS embed contexts.
 */
export function getApiNameForShareFlow({
  namespace,
  mainApiName,
  embedFramework,
}: {
  namespace: string;
  mainApiName: string;
  embedFramework: "react" | "vanilla";
}): string {
  if (embedFramework === "react") {
    return getApiNameForReactSnippet({ mainApiName });
  }
  return getApiNameForVanillaJsSnippet({ namespace, mainApiName });
}
