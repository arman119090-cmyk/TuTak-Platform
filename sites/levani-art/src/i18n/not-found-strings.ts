import type { Locale } from './config';
import strings from './not-found-strings.json';

/**
 * 404 copy lives apart from the main dictionaries so the (client-side)
 * not-found page can import it without shipping every dictionary to the
 * browser. JSON because scripts/finalize-export.mjs also builds the static
 * host's 404.html from it. The dictionaries re-export these entries.
 */
export const notFoundStrings: Record<Locale, { title: string; text: string; back: string }> = strings;
