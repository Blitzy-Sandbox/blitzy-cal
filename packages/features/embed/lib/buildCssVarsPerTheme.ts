function _buildCssVarsPerTheme({
  light,
  dark,
}: {
  light: { "cal-brand": string | null; "cal-brand-accent"?: string | null; "cal-bg-emphasis"?: string | null };
  dark: { "cal-brand": string | null; "cal-brand-accent"?: string | null; "cal-bg-emphasis"?: string | null };
}) {
  // Setting this value should remove it from the API
  const VALUE_WHEN_WE_DONT_WANT_IT_IN_API = undefined;
  const cssVarsPerTheme = Object.entries({ light, dark }).reduce((acc, [theme, themeCssVars]) => {
    if (!Object.values(themeCssVars).some(Boolean)) return acc;

    const truthyValues = Object.fromEntries(
      Object.entries(themeCssVars).filter(([_, value]) => Boolean(value))
    );

    return {
      ...acc,
      [theme]: truthyValues,
    };
  }, {});

  if (Object.keys(cssVarsPerTheme).length === 0) return VALUE_WHEN_WE_DONT_WANT_IT_IN_API;

  return cssVarsPerTheme;
}

export function buildCssVarsPerTheme({
  brandColor,
  darkBrandColor,
  accentColor,
  darkAccentColor,
}: {
  brandColor: string | null;
  darkBrandColor: string | null;
  /** Optional share flow accent color for button/link styling */
  accentColor?: string | null;
  /** Optional dark mode share flow accent color */
  darkAccentColor?: string | null;
}) {
  return _buildCssVarsPerTheme({
    light: {
      "cal-brand": brandColor,
      ...(accentColor !== undefined ? { "cal-brand-accent": accentColor } : {}),
    },
    dark: {
      "cal-brand": darkBrandColor,
      ...(darkAccentColor !== undefined ? { "cal-brand-accent": darkAccentColor } : {}),
    },
  });
}
