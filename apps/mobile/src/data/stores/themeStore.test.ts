import * as storage from '../storage/secureStorage';
import { useThemeStore } from './themeStore';

/**
 * Settings → Appearance persists one of three choices and the app must
 * come back the same way it was left. Failure modes that matter: nothing
 * stored (a fresh install follows the phone), a value from an older build
 * (honoured, not migrated away), and storage that refuses to read or write
 * (the app still opens, in the default or the chosen theme respectively).
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
    useThemeStore.setState({ mode: 'system', isHydrated: false });
  });

  it('follows the device before hydration resolves', () => {
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('a fresh install with nothing persisted follows the device', async () => {
    mockedStorage.getItem.mockResolvedValue(null);
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('system');
    expect(useThemeStore.getState().isHydrated).toBe(true);
  });

  it.each(['light', 'dark', 'system'] as const)('comes back as the persisted %s choice', async (mode) => {
    mockedStorage.getItem.mockResolvedValue(mode);
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe(mode);
    // Reading is not writing: hydration never touches storage.
    expect(mockedStorage.setItem).not.toHaveBeenCalled();
  });

  it('ignores a value it does not understand rather than crashing', async () => {
    mockedStorage.getItem.mockResolvedValue('sepia');
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('degrades to the default, not a crash, if reading storage fails', async () => {
    mockedStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().mode).toBe('system');
    expect(useThemeStore.getState().isHydrated).toBe(true);
  });

  it('setMode applies at once and persists under the theme key', async () => {
    await useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(mockedStorage.setItem).toHaveBeenCalledWith('tutak.themeMode', 'dark');
  });

  it('keeps the choice for this run even when the write fails', async () => {
    mockedStorage.setItem.mockRejectedValue(new Error('disk full'));
    await expect(useThemeStore.getState().setMode('light')).resolves.toBeUndefined();
    expect(useThemeStore.getState().mode).toBe('light');
  });
});
