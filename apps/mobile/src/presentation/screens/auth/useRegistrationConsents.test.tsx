import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRegistrationConsents } from './useRegistrationConsents';

jest.mock('../../../data/api/legalApi', () => ({
  legalApi: { index: jest.fn() },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const { legalApi } = require('../../../data/api/legalApi');
/* eslint-enable @typescript-eslint/no-require-imports */

const published = {
  revision: '1.0-test',
  published: true,
  isDraft: false,
  language: 'ru',
  availableLanguages: ['ru', 'hy'],
  requiredConsents: [
    { purpose: 'TERMS_AND_BONUS_RULES', documents: ['terms', 'bonus-refunds'] },
    { purpose: 'PERSONAL_DATA_REQUIRED', documents: ['consent', 'privacy'] },
  ],
  documents: [
    { key: 'terms', title: 'T', revision: '1.0-test', language: 'ru', contentHash: 'a'.repeat(64), isDraft: false },
    { key: 'bonus-refunds', title: 'B', revision: '1.0-test', language: 'ru', contentHash: 'b'.repeat(64), isDraft: false },
    { key: 'consent', title: 'C', revision: '1.0-test', language: 'ru', contentHash: 'c'.repeat(64), isDraft: false },
    { key: 'privacy', title: 'P', revision: '1.0-test', language: 'ru', contentHash: 'd'.repeat(64), isDraft: false },
  ],
};

let activeClient: QueryClient | undefined;

const wrapper = ({ children }: { children: React.ReactNode }) => {
  // `gcTime: 0` and the teardown below: react-query keeps a timer per cached
  // query, and a cache left behind keeps jest's event loop alive.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  activeClient = client;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

/**
 * Where the registration form learns what it has to ask.
 *
 * Never from a constant in the app: which documents make up which consent,
 * and what their text hashes are, come from the server that will check them.
 * That is what keeps the record honest — the app quotes back exactly what it
 * was given, and cannot agree on behalf of a text it never received.
 */
describe('what registration must ask for', () => {
  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    activeClient?.clear();
    activeClient = undefined;
  });

  it('builds both choices from the published index, with the hashes the server gave', async () => {
    legalApi.index.mockResolvedValue(published);
    const { result } = renderHook(() => useRegistrationConsents(), { wrapper });

    await waitFor(() => expect(result.current.required).toHaveLength(2));
    expect(result.current.required.map((entry) => entry.purpose)).toEqual([
      'TERMS_AND_BONUS_RULES',
      'PERSONAL_DATA_REQUIRED',
    ]);
    expect(result.current.satisfied).toBe(false);
    expect(result.current.payload).toBeNull();

    act(() => result.current.setAccepted('TERMS_AND_BONUS_RULES', true));
    act(() => result.current.setAccepted('PERSONAL_DATA_REQUIRED', true));

    await waitFor(() => expect(result.current.satisfied).toBe(true));
    expect(result.current.payload).toEqual([
      {
        purpose: 'TERMS_AND_BONUS_RULES',
        language: 'ru',
        revision: '1.0-test',
        documents: [
          { key: 'terms', contentHash: 'a'.repeat(64) },
          { key: 'bonus-refunds', contentHash: 'b'.repeat(64) },
        ],
      },
      {
        purpose: 'PERSONAL_DATA_REQUIRED',
        language: 'ru',
        revision: '1.0-test',
        documents: [
          { key: 'consent', contentHash: 'c'.repeat(64) },
          { key: 'privacy', contentHash: 'd'.repeat(64) },
        ],
      },
    ]);
  });

  it('asks for nothing while the texts are an unapproved draft', async () => {
    legalApi.index.mockResolvedValue({ ...published, published: false, isDraft: true });
    const { result } = renderHook(() => useRegistrationConsents(), { wrapper });

    await waitFor(() => expect(legalApi.index).toHaveBeenCalled());
    expect(result.current.required).toEqual([]);
    // Nothing to agree to, so nothing blocks registration and nothing is sent.
    expect(result.current.satisfied).toBe(true);
    expect(result.current.payload).toBeNull();
  });

  it('asks for nothing when the documents cannot be reached at all', async () => {
    legalApi.index.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useRegistrationConsents(), { wrapper });

    await waitFor(() => expect(legalApi.index).toHaveBeenCalled());
    expect(result.current.required).toEqual([]);
    expect(result.current.satisfied).toBe(true);
  });
});
