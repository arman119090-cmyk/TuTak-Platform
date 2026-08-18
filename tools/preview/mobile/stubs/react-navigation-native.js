/**
 * Navigation hooks for the preview harness.
 *
 * The harness renders one screen at a time with no navigator above it, so
 * `useNavigation` throws — and a screen that throws renders as a blank white
 * page, which in a set of screenshots looks like a design that was never
 * built rather than a harness that cannot mount it. That is exactly what
 * happened to the settings screen the moment it started reading navigation
 * from context instead of from props.
 *
 * Screens only ever call navigate/goBack, and in a still screenshot both are
 * no-ops, so a double is enough. Route params come from the query string so
 * a screen that needs one (the charging session) can be previewed at all.
 */
const params = new URLSearchParams(window.location.search);

const navigation = {
  navigate: () => {},
  goBack: () => {},
  push: () => {},
  replace: () => {},
  setOptions: () => {},
  addListener: () => () => {},
  removeListener: () => {},
  canGoBack: () => true,
  isFocused: () => true,
  dispatch: () => {},
  reset: () => {},
  setParams: () => {},
  // `Screen` reads `getState()?.type` to tell a pushed screen from a tab
  // root so it knows whether to draw a back arrow. The harness renders one
  // screen with no navigator above it, so "not a tab root" (undefined type)
  // is the closest honest answer — a screen previewed alone still gets its
  // back arrow, which is more informative in a screenshot than none at all.
  getState: () => ({ type: 'stack' }),
};

export function useNavigation() {
  return navigation;
}

export function useRoute() {
  let parsed = {};
  try {
    parsed = JSON.parse(params.get('params') ?? '{}');
  } catch {
    parsed = {};
  }
  return { key: 'preview', name: params.get('screen') ?? 'Preview', params: parsed };
}

export function useIsFocused() {
  return true;
}

export function useFocusEffect(effect) {
  // Runs once on mount, which is the only "focus" a screenshot ever gets.
  const cleanup = effect?.();
  return typeof cleanup === 'function' ? cleanup : undefined;
}

export const NavigationContainer = ({ children }) => children;
export const DefaultTheme = { dark: false, colors: {} };
export const DarkTheme = { dark: true, colors: {} };
