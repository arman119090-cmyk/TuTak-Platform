/**
 * Which language a legal text should open in.
 *
 * The package exists in Russian and Armenian. An English interface has no
 * English text to show, and handing someone Russian under an English label is
 * the one outcome the brief rules out — so English resolves to "ask", and the
 * screens offer the real choice instead of guessing.
 */
export type LegalDocumentLanguage = 'ru' | 'hy';

export const LEGAL_DOCUMENT_LANGUAGES: LegalDocumentLanguage[] = ['ru', 'hy'];

export function isLegalDocumentLanguage(value: string): value is LegalDocumentLanguage {
  return (LEGAL_DOCUMENT_LANGUAGES as string[]).includes(value);
}

/** The interface language when the documents exist in it, otherwise null — ask. */
export function legalLanguageForInterface(interfaceLanguage: string): LegalDocumentLanguage | null {
  return isLegalDocumentLanguage(interfaceLanguage) ? interfaceLanguage : null;
}
