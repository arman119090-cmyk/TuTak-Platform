/**
 * Preview-only stub for expo-image-picker.
 *
 * There is no photo library in the screenshot container, and no user to open
 * one. `launchImageLibraryAsync` therefore returns a small, obviously
 * synthetic square — a flat TuTak-green PNG — so the Profile screen's
 * choose → preview → save → replace → remove flow can be driven and
 * photographed end to end against the real `AvatarControl`, the real
 * `usersApi`, and the real mock transport.
 *
 * It is deliberately a plain colour and not a face: a screenshot of this
 * harness should never be mistakable for a real customer's photograph, and
 * the point being demonstrated is the control, not the picture.
 *
 * Permissions are granted, because a permission dialog is a platform surface
 * this harness cannot render and its denial path is exercised by unit tests
 * rather than by a screenshot.
 */

// 1×1 TuTak green, scaled by the layout. Inline so the stub needs no asset.
const GREEN_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function requestMediaLibraryPermissionsAsync() {
  return { granted: true, canAskAgain: true, status: 'granted' };
}

export async function getMediaLibraryPermissionsAsync() {
  return { granted: true, canAskAgain: true, status: 'granted' };
}

export async function launchImageLibraryAsync() {
  return {
    canceled: false,
    assets: [
      {
        uri: GREEN_PIXEL,
        fileName: 'preview-avatar.png',
        mimeType: 'image/png',
        width: 1,
        height: 1,
      },
    ],
  };
}

export async function launchCameraAsync() {
  return launchImageLibraryAsync();
}
