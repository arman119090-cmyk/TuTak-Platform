import { contrastRatio, meetsContrast, parseHexColor, relativeLuminance } from '../src/contrast';
import { themeToCssBlock, themeToCssVariables } from '../src/css';
import { darkTheme, lightTheme, radius, spacing, touchTarget, typography } from '../src/theme';

describe('contrast maths', () => {
  it('parses short and long hex', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor('0E1211')).toEqual({ r: 14, g: 18, b: 17 });
    expect(() => parseHexColor('nope')).toThrow(RangeError);
  });

  it('agrees with the reference values', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 3);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('the light theme meets WCAG AA', () => {
  const c = lightTheme.colors;

  it('primary text on every surface', () => {
    for (const background of [c.background, c.backgroundElevated, c.surface, c.surfaceMuted]) {
      expect(meetsContrast(c.textPrimary, background)).toBe(true);
    }
  });

  it('secondary text on every surface', () => {
    for (const background of [c.background, c.backgroundElevated, c.surface, c.surfaceMuted]) {
      expect(meetsContrast(c.textSecondary, background)).toBe(true);
    }
  });

  it('the primary button label on the primary button', () => {
    expect(meetsContrast(c.onPrimary, c.primary)).toBe(true);
    expect(meetsContrast(c.onPrimary, c.primaryPressed)).toBe(true);
  });

  it('every status colour on its own soft background', () => {
    const pairs: ReadonlyArray<[string, string]> = [
      [c.success, c.successSoft],
      [c.warning, c.warningSoft],
      [c.danger, c.dangerSoft],
      [c.info, c.infoSoft],
    ];
    for (const [foreground, background] of pairs) {
      expect(meetsContrast(foreground, background)).toBe(true);
    }
  });

  it('status colours against the plain surface too', () => {
    for (const status of [c.success, c.warning, c.danger, c.info]) {
      expect(meetsContrast(status, c.surface)).toBe(true);
    }
  });

  it('inverse text on the inverse surface', () => {
    expect(meetsContrast(c.textInverse, c.surfaceInverse)).toBe(true);
  });
});

describe('the dark theme meets WCAG AA', () => {
  const c = darkTheme.colors;

  it('primary and secondary text on every surface', () => {
    for (const background of [c.background, c.backgroundElevated, c.surface, c.surfaceMuted]) {
      expect(meetsContrast(c.textPrimary, background)).toBe(true);
      expect(meetsContrast(c.textSecondary, background)).toBe(true);
    }
  });

  it('the primary button label on the primary button', () => {
    expect(meetsContrast(c.onPrimary, c.primary)).toBe(true);
  });

  it('brand text on the canvas and on a card', () => {
    expect(meetsContrast(c.primary, c.background)).toBe(true);
    expect(meetsContrast(c.primary, c.surface)).toBe(true);
  });

  it('every status colour on its own soft background and on the surface', () => {
    const pairs: ReadonlyArray<[string, string]> = [
      [c.success, c.successSoft],
      [c.warning, c.warningSoft],
      [c.danger, c.dangerSoft],
      [c.info, c.infoSoft],
    ];
    for (const [foreground, background] of pairs) {
      expect(meetsContrast(foreground, background)).toBe(true);
      expect(meetsContrast(foreground, c.surface)).toBe(true);
    }
  });
});

describe('the design system’s fixed points', () => {
  it('uses the specified canvas, surface, text and emerald in light', () => {
    expect(lightTheme.colors.background.toUpperCase()).toBe('#F6F2EA');
    expect(lightTheme.colors.surface.toUpperCase()).toBe('#FFFFFF');
    expect(lightTheme.colors.textPrimary.toUpperCase()).toBe('#0A1322');
    expect(lightTheme.colors.primary.toUpperCase()).toBe('#0A7A63');
  });

  it('uses the specified navy canvas and surface in dark', () => {
    expect(darkTheme.colors.background.toUpperCase()).toBe('#0B1424');
    expect(darkTheme.colors.surface.toUpperCase()).toBe('#111D31');
  });

  it('keeps cards at 28, controls at 18, the CTA in the 54–58 band, targets at 48+', () => {
    expect(radius.card).toBe(28);
    expect(radius.control).toBe(18);
    expect(touchTarget.primaryAction).toBeGreaterThanOrEqual(54);
    expect(touchTarget.primaryAction).toBeLessThanOrEqual(58);
    expect(touchTarget.minimum).toBeGreaterThanOrEqual(48);
  });

  it('exposes the same roles in both themes, so no screen can style for one only', () => {
    expect(Object.keys(darkTheme.colors).sort()).toEqual(Object.keys(lightTheme.colors).sort());
  });
});

describe('scale tokens', () => {
  it('keeps the spacing scale on a 4pt grid, with a deliberate 2pt hairline', () => {
    for (const [name, value] of Object.entries(spacing)) {
      if (name === 'xxs') {
        expect(value).toBe(2);
        continue;
      }
      expect(value % 4).toBe(0);
    }
  });

  it('keeps the type scale monotonic and legible', () => {
    const sizes = Object.values(typography).map((t) => t.fontSize);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    for (const token of Object.values(typography)) {
      expect(token.lineHeight).toBeGreaterThan(token.fontSize);
    }
    expect(typography.body.fontSize).toBeGreaterThanOrEqual(15);
  });

  it('keeps every tap target at or above the platform minimum', () => {
    expect(touchTarget.minimum).toBeGreaterThanOrEqual(44);
    expect(touchTarget.comfortable).toBeGreaterThanOrEqual(touchTarget.minimum);
    expect(touchTarget.primaryAction).toBeGreaterThanOrEqual(touchTarget.comfortable);
  });
});

describe('CSS export', () => {
  it('emits a variable for every colour role', () => {
    const variables = themeToCssVariables(lightTheme);
    for (const role of Object.keys(lightTheme.colors)) {
      const key = `--color-${role.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
      expect(variables[key]).toBeDefined();
    }
  });

  it('renders a usable CSS block', () => {
    const block = themeToCssBlock('light');
    expect(block.startsWith(':root {')).toBe(true);
    expect(block).toContain('--color-primary:');
    expect(block).toContain('--space-base: 16px;');
    expect(block.trimEnd().endsWith('}')).toBe(true);
  });

  it('gives light and dark the same variable names', () => {
    expect(Object.keys(themeToCssVariables(lightTheme)).sort()).toEqual(
      Object.keys(themeToCssVariables(darkTheme)).sort(),
    );
  });
});
