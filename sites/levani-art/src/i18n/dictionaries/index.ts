import type { Locale } from '../config';
import { de } from './de';
import { en, type Dictionary } from './en';
import { fr } from './fr';
import { hy } from './hy';
import { it } from './it';
import { ru } from './ru';

export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = { hy, ru, it, de, fr, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
