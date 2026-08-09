import * as SecureStore from 'expo-secure-store';
import { deleteItem, getItem, setItem } from './secureStorage';
import * as web from './secureStorage.web';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe('secureStorage (native)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads through to the OS keystore', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValue('token-1');
    await expect(getItem('tutak.accessToken')).resolves.toBe('token-1');
    expect(mockedSecureStore.getItemAsync).toHaveBeenCalledWith('tutak.accessToken');
  });

  it('writes and deletes through to the OS keystore', async () => {
    mockedSecureStore.setItemAsync.mockResolvedValue();
    mockedSecureStore.deleteItemAsync.mockResolvedValue();

    await setItem('tutak.accessToken', 'token-2');
    await deleteItem('tutak.accessToken');

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith('tutak.accessToken', 'token-2');
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith('tutak.accessToken');
  });
});

describe('secureStorage (web)', () => {
  // The web file is what Metro substitutes in a browser build. It is imported
  // here directly rather than through the platform resolver, because the
  // whole point of the file is that it must work where the native module does
  // not exist — including here, where `expo-secure-store` is a mock.
  const backing = new Map<string, string>();
  const localStorageStub: Storage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  };

  afterEach(() => {
    backing.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageStub,
      configurable: true,
    });
  });

  beforeEach(() => {
    // Without this the native block's calls are still on the mock, and the
    // "never touches the native module" assertion below would be reading
    // someone else's history.
    jest.clearAllMocks();
    backing.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageStub,
      configurable: true,
    });
  });

  it('never touches the native module', async () => {
    await web.setItem('tutak.accessToken', 'token-3');
    await web.getItem('tutak.accessToken');
    await web.deleteItem('tutak.accessToken');

    // This is the regression under test: the browser build crashed during
    // hydration precisely because it reached a native module that a page
    // cannot provide.
    expect(mockedSecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('round-trips a value through localStorage', async () => {
    await expect(web.getItem('tutak.accessToken')).resolves.toBeNull();

    await web.setItem('tutak.accessToken', 'token-4');
    await expect(web.getItem('tutak.accessToken')).resolves.toBe('token-4');
    expect(backing.get('tutak.accessToken')).toBe('token-4');

    await web.deleteItem('tutak.accessToken');
    await expect(web.getItem('tutak.accessToken')).resolves.toBeNull();
  });

  it('falls back to memory when the browser blocks storage', async () => {
    // Safari private mode, and any browser configured to deny storage,
    // throws on the property access itself.
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      configurable: true,
    });

    await expect(web.setItem('tutak.accessToken', 'token-5')).resolves.toBeUndefined();
    await expect(web.getItem('tutak.accessToken')).resolves.toBe('token-5');

    await web.deleteItem('tutak.accessToken');
    await expect(web.getItem('tutak.accessToken')).resolves.toBeNull();
  });

  it('reports a missing key as null rather than undefined', async () => {
    // The auth store puts this value straight into state and compares it
    // against null; undefined would read as "still loading".
    await expect(web.getItem('tutak.nothingHere')).resolves.toBeNull();
  });
});
