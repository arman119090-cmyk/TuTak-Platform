import * as storage from '../storage/secureStorage';
import { useThemeStore } from './themeStore';

/**
 * `TUTAK_V2_CLAUDE_READ_FIRST.md`: "Migrate the default/persisted theme
 * behaviour so neither a fresh nor an existing customer silently lands in
 * the legacy dark shell; do not build an unapproved partial dark v2
 * variant." This is the regression test for that migration: a pre-v2
 * install may have `'dark'` (the old default) or nothing at all persisted
 * under the theme key, and both must resolve to `'light'` after hydration —
 * never a stale `'dark'` re-read on a later run.
 */
jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockedStorage = storage as jest.Mocked<typeof storage>;

describe('themeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.setItem.mockResolvedValue();
    useThemeStore.setState({ mode: 'light', isHydrated: false });
  });

  it('defaults to light before hydration resolves, not the legacy dark default', () => {
    expect(useThemeStore.getState().mode).toBe('light');
  });

  it('a fresh install with nothing persisted hydrates to light', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('light');
    expect(useThemeStore.getState().isHydrated).toBe(true);
  });

  it('an existing install with the legacy persisted "dark" value is migrated to light', async () => {
    mockedStorage.getItem.mockResolvedValue('dark');
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('light');
    // The migration is durable, not just in-memory for this run — the
    // stale 'dark' value is actively rewritten so a later read of the same
    // key does not keep reporting a preference the app no longer honours.
    expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.themeMode', 'light');
  });

  it('an existing install with an already-explicit "light" value stays light without rewriting storage', async () => {
    mockedStorage.getItem.mockResolvedValue('light');
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('light');
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
  });

  it('degrades to light, not a crash, if reading storage fails', async () => {
    mockedStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('light');
    expect(useThemeStore.getState().isHydrated).toBe(true);
  });

  it('does not expose a way to opt back into dark mode', () => {
    // The v2 store has no `setMode` — the old Settings appearance toggle
    // that could set 'dark' was removed in the same change as this
    // migration (see SettingsScreen.tsx / ThemeProvider.tsx docblocks).
    expect((useThemeStore.getState() as unknown as Record<string, unknown>).setMode).toBeUndefined();
  });
});
