/**
 * next/image loader: artworks come from the variants pre-rendered by
 * scripts/build-images.mjs; anything else is served as is (the `w` query
 * only tells next/image the loader honoured the width).
 */
export default function imageLoader({ src, width }: { src: string; width: number; quality?: number }) {
  if (src.startsWith('/artworks/') && !src.startsWith('/artworks/_w/')) {
    return `/artworks/_w/${width}/${src.slice('/artworks/'.length)}`;
  }
  return `${src}?w=${width}`;
}
