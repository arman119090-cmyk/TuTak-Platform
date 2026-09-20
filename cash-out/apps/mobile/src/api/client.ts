import Constants from 'expo-constants';
import type { ApiErrorBody, ErrorCode } from '@cashout/contracts';

/**
 * The HTTP client.
 *
 * Three things it does that a bare `fetch` would not:
 *
 *  - turns every failure into an `ApiError` carrying the server's stable error
 *    code, so screens switch on a code rather than on message text;
 *  - refreshes the access token once, transparently, and queues the calls that
 *    arrive while a refresh is in flight so that ten screens mounting at once
 *    do not each burn a refresh token;
 *  - never retries a POST on its own. The withdrawal endpoints are idempotent
 *    on a key the *caller* supplies, and a client that silently retried without
 *    one would be the fastest way to pay a driver twice.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isAuth(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.code === 'TOKEN_EXPIRED';
  }
}

export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  save(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
  clear(): Promise<void>;
  getDeviceId(): Promise<string>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the bearer token, for sign-in endpoints. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export const API_BASE_URL: string =
  // The build profile (eas.json) sets EXPO_PUBLIC_API_BASE_URL; app.json's
  // `extra.apiBaseUrl` is the `expo start` default; localhost is the last resort.
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'http://localhost:3000';

export class ApiClient {
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly tokens: TokenStore,
    private readonly onSignedOut: () => void,
    private readonly baseUrl: string = API_BASE_URL,
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);

    if (response.status === 401 && !options.anonymous) {
      const refreshed = await this.refreshOnce();
      if (!refreshed) {
        this.onSignedOut();
        throw new ApiError('UNAUTHENTICATED', 'Session ended', 401);
      }
      return this.parse<T>(await this.send(path, options));
    }

    return this.parse<T>(response);
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!options.anonymous) {
      const token = await this.tokens.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal ?? null,
      });
    } catch (error) {
      throw new ApiError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network request failed',
        0,
      );
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : {};

    if (!response.ok) {
      const body = payload as ApiErrorBody;
      throw new ApiError(
        body.code ?? 'INTERNAL_ERROR',
        body.message ?? 'Request failed',
        response.status,
        body.details,
        body.requestId,
      );
    }

    return payload as T;
  }

  /** At most one refresh in flight; everyone else waits for its result. */
  private refreshOnce(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.tokens.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const deviceId = await this.tokens.getDeviceId();
      const response = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId }),
      });
      if (!response.ok) {
        await this.tokens.clear();
        return false;
      }
      const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
      await this.tokens.save(tokens);
      return true;
    } catch {
      return false;
    }
  }
}
