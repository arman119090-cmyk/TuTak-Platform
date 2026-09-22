import type {
  LegalConsentStateDto,
  LegalDocumentDto,
  LegalDocumentIndexDto,
} from '@tutak/shared-types';
import { httpClient, apiOrigin, ApiEnvelope } from './httpClient';

/**
 * The legal texts.
 *
 * Read without a token on purpose: the two consents on the registration
 * screen link straight into these, and there is no account yet when someone
 * taps one. The routes are version-neutral on the API (a store listing points
 * at a fixed path), so they are addressed absolutely rather than through the
 * `/v1` base — same reason `healthUrl` exists.
 */
export const legalApi = {
  async index(language: string): Promise<LegalDocumentIndexDto> {
    const { data } = await httpClient.get<ApiEnvelope<LegalDocumentIndexDto>>('/legal/documents', {
      baseURL: apiOrigin,
      params: { lang: language },
    });
    return data.data;
  },

  async document(key: string, language: string, revision?: string): Promise<LegalDocumentDto> {
    const { data } = await httpClient.get<ApiEnvelope<LegalDocumentDto>>(
      `/legal/documents/${encodeURIComponent(key)}`,
      { baseURL: apiOrigin, params: { lang: language, ...(revision ? { revision } : {}) } },
    );
    return data.data;
  },

  /** Where a saved copy of an exact edition comes from — opened in the browser. */
  fileUrl(key: string, language: string, revision?: string): string {
    const query = new URLSearchParams({ lang: language });
    if (revision) query.set('revision', revision);
    return `${apiOrigin}/legal/documents/${encodeURIComponent(key)}/file?${query.toString()}`;
  },

  async myConsents(): Promise<LegalConsentStateDto> {
    const { data } = await httpClient.get<ApiEnvelope<LegalConsentStateDto>>('/legal/consents/me');
    return data.data;
  },
};
