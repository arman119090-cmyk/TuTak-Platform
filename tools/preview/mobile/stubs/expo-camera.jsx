import React from 'react';
import { View } from 'react-native';

/**
 * Preview-only stub for expo-camera.
 *
 * There is no webcam in the screenshot container, so CameraView renders as
 * the black surface a live feed would occupy. Everything drawn *over* the
 * feed — the corner reticle, the hint copy, the safe-area layout — is the
 * real ScanQrScreen implementation, unmodified.
 */
export function CameraView({ style }) {
  return <View style={[style, { backgroundColor: '#0A0D14' }]} />;
}

export function useCameraPermissions() {
  return [{ granted: true, canAskAgain: true, status: 'granted' }, async () => {}];
}
