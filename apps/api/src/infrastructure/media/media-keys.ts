import { randomBytes } from 'node:crypto';
import { MediaAssetKind } from '@prisma/client';

export type MediaVariant = 'original' | 'display' | 'thumb';

export const MEDIA_VARIANTS: readonly MediaVariant[] = ['original', 'display', 'thumb'] as const;

export function isMediaVariant(value: string): value is MediaVariant {
  return (MEDIA_VARIANTS as readonly string[]).includes(value);
}

const KIND_PREFIX: Record<MediaAssetKind, string> = {
  USER_AVATAR: 'avatar',
  PARTNER_LOGO: 'partner-logo',
  PARTNER_COVER: 'partner-cover',
};

/**
 * Mints the opaque storage keys for one asset.
 *
 * Server-generated, unguessable and unrelated to anything the caller sent:
 * not the filename, not the subject's id, not a hash of the bytes. Spec §3.2
 * puts key ownership on the API, and the reason is narrower than it sounds —
 * a key derived from `userId` would let anyone who knows a user id construct
 * that user's avatar key, which matters the moment a driver's objects are
 * ever exposed by any path other than `MediaDeliveryService`. The random
 * segment costs nothing and removes the whole class of question.
 *
 * The prefix is human-readable purely so an operator staring at a bucket
 * listing during an incident can tell a partner logo from an avatar without
 * joining against the database.
 */
export function mintMediaKeys(kind: MediaAssetKind): Record<MediaVariant, string> {
  const id = randomBytes(16).toString('hex');
  const prefix = `${KIND_PREFIX[kind]}/${id.slice(0, 2)}/${id}`;
  return {
    original: `${prefix}/original`,
    display: `${prefix}/display`,
    thumb: `${prefix}/thumb`,
  };
}
