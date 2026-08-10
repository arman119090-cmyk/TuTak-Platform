/**
 * Applies the saved theme before the first paint.
 *
 * This runs as a blocking inline `<script>` in `<head>`, which is normally
 * something to avoid — here it is the entire point. React sets the attribute
 * after hydration, which is several hundred milliseconds too late: the
 * browser has already painted the default theme, and the user sees a white
 * flash before the dark UI arrives. That flash is the single most common
 * "cheap-looking" tell in a themed web app, and it cannot be fixed with CSS
 * because the choice lives in localStorage.
 *
 * Kept as a string rather than a real module so it can be inlined without a
 * network request; there is nothing to fetch, so there is nothing to wait for.
 */
export const THEME_STORAGE_KEY = 'tutak-theme';

export type ThemeName = 'dark' | 'light';

export const DEFAULT_THEME: ThemeName = 'dark';

export const themeInitScript = `
(function () {
  try {
    var saved = localStorage.getItem('${THEME_STORAGE_KEY}');
    var theme = saved === 'light' || saved === 'dark' ? saved : '${DEFAULT_THEME}';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    // Private browsing can throw on localStorage. Falling back to the
    // default is better than leaving the page unthemed.
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`.trim();
