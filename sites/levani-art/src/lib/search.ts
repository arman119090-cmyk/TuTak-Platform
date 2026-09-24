/** Search runs in the browser over a tiny prebuilt index (one row per work). */
export interface SearchEntry {
  slug: string;
  title: string;
  artist: string | null;
  category: string;
  image: string;
  /** Lower-cased, accent-stripped haystack. */
  text: string;
}

export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every query word must appear somewhere in the entry. Title hits rank first. */
export function searchEntries(entries: SearchEntry[], query: string): SearchEntry[] {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return entries
    .filter((e) => words.every((w) => e.text.includes(w)))
    .map((e) => {
      const title = normalizeForSearch(e.title);
      const score = words.reduce((s, w) => s + (title.includes(w) ? 2 : 1), 0);
      return { e, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ e }) => e);
}
