import type { AuthenticatedUserDto, MediaImageDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export interface PickedImage {
  /** A local `file://` (or `blob:`/`data:` on web) URI from the image picker. */
  uri: string;
  name: string;
  mimeType: string;
}

/**
 * Whether this runtime's `FormData` is React Native's own.
 *
 * RN's implementation keeps its entries on a private `_parts` array and
 * accepts the `{ uri, name, type }` triple; the DOM's does neither. Feature-
 * detected rather than branched on `Platform.OS`, because the thing that
 * actually differs is the FormData implementation, and react-native-web
 * supplies the DOM one while still reporting a native-looking platform in
 * some configurations.
 */
function isReactNativeFormData(form: FormData): boolean {
  return Array.isArray((form as unknown as { _parts?: unknown })._parts);
}

export const usersApi = {
  async me() {
    const { data } = await httpClient.get<ApiEnvelope<AuthenticatedUserDto>>('/users/me');
    return data.data;
  },

  /**
   * Uploads or replaces the caller's avatar.
   *
   * Sent as `multipart/form-data` with the file as a `{ uri, name, type }`
   * triple rather than as base64 in JSON. Two reasons, and the second is the
   * one that matters: React Native's fetch/XHR streams the file straight off
   * disk from a URI, so a 5 MB photo never exists as a 6.7 MB base64 string in
   * the JS heap on a low-end Android device; and
   * `TUTAK_V2_MEDIA_SYSTEM_SPEC.md`'s non-goals forbid image bytes inside
   * ordinary API payloads, which a base64 field would be.
   *
   * The Content-Type header is deliberately not set. The runtime has to
   * append its own multipart boundary, and a hand-set `multipart/form-data`
   * without one produces a body the server cannot parse — a classic, and the
   * error it yields ("Unexpected end of form") says nothing about the cause.
   *
   * Resolves only once the server has stored the derived asset. The Profile
   * screen depends on that: spec §4 forbids showing success earlier.
   */
  async uploadAvatar(image: PickedImage) {
    const form = new FormData();

    if (isReactNativeFormData(form)) {
      form.append('file', {
        uri: image.uri,
        name: image.name,
        type: image.mimeType,
        // React Native's FormData accepts this triple and streams the file
        // off disk from the URI. The DOM's typings do not describe the shape,
        // and no `lib` setting covers both targets.
      } as unknown as Blob);
    } else {
      // The DOM's FormData — react-native-web, and the preview harness.
      // Appending a plain object there does not stream anything: it calls
      // `String(value)` and sends the literal text "[object Object]", which
      // reaches the server as a field rather than a file and fails with a
      // message about the form being malformed rather than about the image.
      // So on that target the URI is read into a real Blob first.
      const blob = await (await fetch(image.uri)).blob();
      form.append('file', blob, image.name);
    }

    const { data } = await httpClient.put<ApiEnvelope<MediaImageDto>>('/users/me/avatar', form);
    return data.data;
  },

  async removeAvatar() {
    const { data } = await httpClient.delete<ApiEnvelope<{ removedAssetId: string | null }>>(
      '/users/me/avatar',
    );
    return data.data;
  },

  /**
   * Level-1 referral-list visibility. Default false, and it governs nothing
   * else — see `UpdateAvatarConsentRequestDto`.
   */
  async setAvatarConsent(showAvatarInReferralList: boolean) {
    const { data } = await httpClient.patch<ApiEnvelope<{ showAvatarInReferralList: boolean }>>(
      '/users/me/avatar-consent',
      { showAvatarInReferralList },
    );
    return data.data;
  },

  /**
   * Turn nearby-partner personalisation on or off — off by default, its own
   * route for the same reason `setAvatarConsent` has one: this is a consent
   * decision, not a profile edit.
   */
  async setPersonalizationConsent(personalizedRecommendationsEnabled: boolean) {
    const { data } = await httpClient.patch<
      ApiEnvelope<{ personalizedRecommendationsEnabled: boolean }>
    >('/users/me/personalization-consent', { personalizedRecommendationsEnabled });
    return data.data;
  },
};
