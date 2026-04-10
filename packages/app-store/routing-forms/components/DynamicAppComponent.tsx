import type { Route, AttributeRoutingConfig } from "../types/types";

/**
 * DynamicAppComponent — Generic slug-based renderer for **provider-specific** routing form option panels.
 *
 * This component is responsible for rendering app-integration-specific UI within the
 * routing form builder (e.g. Salesforce contact-owner lookup settings). It is NOT used
 * for generic field type rendering — standard field types (text, select, multiselect,
 * phone, email, checkbox, url, date, etc.) are rendered by `FormInputFields.tsx` through
 * the RAQB widget factory pipeline.
 *
 * The `componentMap` prop is populated externally (see `../appComponents.ts`) via
 * `next/dynamic` lazy imports, ensuring tree-shaking and code-splitting per provider.
 * To add a new provider-specific panel, register the component in `appComponents.ts` —
 * this renderer will pick it up automatically via the slug key lookup.
 *
 * The generic `T` constraint enforces compile-time slug-to-component correspondence.
 * Any upstream extensions to the `Route` or `AttributeRoutingConfig` types are
 * automatically supported through the `{...rest}` spread pattern.
 *
 * @template T - A record mapping provider slug strings to their React component types
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DynamicAppComponent<T extends Record<string, React.ComponentType<any>>>(props: {
  /** Map of provider slug → lazy-loaded React component, populated by `appComponents.ts` */
  componentMap: T;
  /** Provider identifier used to look up the matching component in `componentMap` */
  slug: string;
  /** Provider-specific configuration data forwarded to the resolved component */
  appData: any;
  /** Current route object from the routing form builder, forwarded to the resolved component */
  route: Route;
  /** Callback to update attribute routing configuration for a given route ID */
  setAttributeRoutingConfig: (id: string, attributeRoutingConfig: Partial<AttributeRoutingConfig>) => void;
  /** Optional CSS class applied to the wrapper div for layout consistency */
  wrapperClassName?: string;
}) {
  const { componentMap, slug, wrapperClassName, appData, route, setAttributeRoutingConfig, ...rest } = props;

  // Return null for slugs with no registered component — this is a critical safety guard
  // that prevents rendering errors when a form references an app without a dedicated panel
  if (!componentMap[slug]) return null;

  const Component = componentMap[slug];

  return (
    <div className={wrapperClassName || ""}>
      <Component
        appData={appData}
        route={route}
        setAttributeRoutingConfig={setAttributeRoutingConfig}
        {...rest}
      />
    </div>
  );
}
