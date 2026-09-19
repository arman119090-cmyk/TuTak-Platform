import { radius, spacing, Theme, ThemeName, themes } from './theme';

/**
 * Renders a theme as CSS custom properties for the admin panel, so that the web
 * app and the mobile app are demonstrably driven by the same token values
 * rather than by two hand-maintained copies that slowly diverge.
 */
export function themeToCssVariables(theme: Theme): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [role, value] of Object.entries(theme.colors)) {
    variables[`--color-${kebab(role)}`] = value;
  }
  for (const [name, value] of Object.entries(spacing)) {
    variables[`--space-${kebab(name)}`] = `${value}px`;
  }
  for (const [name, value] of Object.entries(radius)) {
    variables[`--radius-${kebab(name)}`] = `${value}px`;
  }
  for (const [name, value] of Object.entries(theme.typography)) {
    variables[`--font-size-${kebab(name)}`] = `${value.fontSize}px`;
    variables[`--line-height-${kebab(name)}`] = `${value.lineHeight}px`;
  }
  return variables;
}

export function themeToCssBlock(name: ThemeName, selector = ':root'): string {
  const theme = themes[name];
  const body = Object.entries(themeToCssVariables(theme))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
