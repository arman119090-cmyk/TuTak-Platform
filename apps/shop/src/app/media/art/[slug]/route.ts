import { NextResponse } from 'next/server';
import { parseArtworkUrl, renderArtwork } from '@/lib/media/artwork';

/**
 * Serves the generated catalogue artwork.
 *
 * The URL carries every input the renderer needs, so this is a pure function of
 * the path: no database read, no filesystem, and the response can be cached
 * forever. That is also why the demo keeps working with no network at all.
 */
export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> => {
  const { slug } = await params;
  const artwork = parseArtworkUrl(slug);
  if (!artwork) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(renderArtwork(artwork), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
