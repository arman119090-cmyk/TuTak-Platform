import type { ImageMetadata } from 'astro';

/**
 * «Слоты» фото сайта. Файл src/assets/photos/<slot>.(jpg|jpeg|png|webp) —
 * есть: секция показывается с фото; нет: в типографском варианте без фото.
 * Серые заглушки намеренно не используются — они выглядят дёшево.
 */
export type PhotoSlot =
  | 'hero'
  | 'direction-residential'
  | 'direction-commercial'
  | 'direction-renovation'
  | 'direction-infrastructure'
  | 'about';

const files = import.meta.glob<{ default: ImageMetadata }>('../assets/photos/*.{jpg,jpeg,png,webp}', {
  eager: true,
});

export function photo(slot: PhotoSlot): ImageMetadata | null {
  for (const [path, mod] of Object.entries(files)) {
    const name = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    if (name === slot) return mod.default;
  }
  return null;
}
