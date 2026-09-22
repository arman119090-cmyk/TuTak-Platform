import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { LegalConsentAcceptanceDto, LegalDocumentIndexDto } from '@tutak/shared-types';
import { legalApi } from '../../../data/api/legalApi';
import {
  LegalDocumentLanguage,
  legalLanguageForInterface,
} from '../legal/LegalDocumentLanguage';

/** The label each mandatory purpose is shown under. Wording comes from the legal package. */
const LABEL_KEYS: Record<string, string> = {
  TERMS_AND_BONUS_RULES: 'legal.consentTerms',
  PERSONAL_DATA_REQUIRED: 'legal.consentPersonalData',
};

export interface RequiredConsent {
  purpose: string;
  labelKey: string;
  documents: Array<{ key: string; contentHash: string }>;
}

export interface RegistrationConsents {
  /** What the person must tick. Empty when nothing is published to tick. */
  required: RequiredConsent[];
  accepted: Record<string, boolean>;
  setAccepted: (purpose: string, next: boolean) => void;
  /** Every mandatory choice made — or nothing to make. */
  satisfied: boolean;
  /** The language the texts are shown in, which the record stores. */
  language: LegalDocumentLanguage;
  /** What travels to the API, or null when there is nothing to send. */
  payload: LegalConsentAcceptanceDto[] | null;
  /**
   * The texts moved while the form was open: forget the ticks, fetch the
   * current edition, and ask again. Called when the server answers
   * `LEGAL_REVISION_STALE` or `LEGAL_CONTENT_HASH_MISMATCH`.
   */
  reset: () => void;
}

/**
 * What registration has to ask, straight from the server that will check it.
 *
 * The screen never hard-codes which documents make up which consent, nor
 * their hashes: both come from `GET /legal/documents`, and the same values
 * are quoted back when the account is created — so the record says what the
 * person actually saw, and a client that showed something else is refused.
 *
 * When the publication gate is closed the index call fails, `required` is
 * empty, and registration behaves exactly as it did before this existed.
 * That is deliberate: there is nothing lawful to ask about a draft, and a
 * checkbox against an unapproved text would be worse than no checkbox.
 *
 * The English interface has no English texts to offer, so the documents are
 * read in Russian by default there and the label says as much; the person can
 * still open either language from "Правовая информация".
 */
export function useRegistrationConsents(): RegistrationConsents {
  const { i18n } = useTranslation();
  const language: LegalDocumentLanguage = legalLanguageForInterface(i18n.language) ?? 'ru';
  const [accepted, setAcceptedState] = useState<Record<string, boolean>>({});

  const index = useQuery<LegalDocumentIndexDto>({
    queryKey: ['legal', 'index', language],
    queryFn: () => legalApi.index(language),
    retry: false,
  });

  const required = useMemo<RequiredConsent[]>(() => {
    const data = index.data;
    if (!data || !data.published) return [];
    const hashes = new Map(data.documents.map((document) => [document.key, document.contentHash]));
    return data.requiredConsents
      .filter((entry) => LABEL_KEYS[entry.purpose])
      .map((entry) => ({
        purpose: entry.purpose,
        labelKey: LABEL_KEYS[entry.purpose]!,
        documents: entry.documents.map((key) => ({ key, contentHash: hashes.get(key) ?? '' })),
      }))
      .filter((entry) => entry.documents.every((document) => document.contentHash.length > 0));
  }, [index.data]);

  const satisfied = required.every((entry) => accepted[entry.purpose] === true);

  const payload = useMemo<LegalConsentAcceptanceDto[] | null>(() => {
    if (required.length === 0 || !satisfied || !index.data) return null;
    return required.map((entry) => ({
      purpose: entry.purpose as LegalConsentAcceptanceDto['purpose'],
      language,
      revision: index.data!.revision,
      documents: entry.documents,
    }));
  }, [required, satisfied, index.data, language]);

  return {
    required,
    accepted,
    setAccepted: (purpose, next) => setAcceptedState((current) => ({ ...current, [purpose]: next })),
    satisfied,
    language,
    payload,
    reset: () => {
      setAcceptedState({});
      void index.refetch();
    },
  };
}
