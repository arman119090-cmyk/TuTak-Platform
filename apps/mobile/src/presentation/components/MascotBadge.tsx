import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { useAppTheme } from '../../app/theme/ThemeProvider';

/**
 * Minimal vector placeholder for "Jako", TuTak's African Grey Parrot
 * mascot — a simplified head silhouette in brand green, sized for use as
 * an avatar/empty-state icon. Swap for final illustrated artwork once
 * the brand/design team delivers it; the API (size prop) is stable.
 */
export function MascotBadge({ size = 64 }: { size?: number }) {
  const { theme } = useAppTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx="32" cy="32" r="32" fill={theme.primarySurface} />
      <Path
        d="M32 14c-7.2 0-13 5.8-13 13 0 4.9 2.7 9.1 6.7 11.3-.4 1.7-1.4 3.1-2.9 4.1a1 1 0 0 0 .5 1.8c3.1.3 6-.6 8.2-2.4 1.6.4 3.3.4 5 0 2.2 1.8 5.1 2.7 8.2 2.4a1 1 0 0 0 .5-1.8c-1.5-1-2.5-2.4-2.9-4.1 4-2.2 6.7-6.4 6.7-11.3 0-7.2-5.8-13-13-13Z"
        fill={theme.primary}
      />
      <Circle cx="27.5" cy="26" r="2.2" fill={theme.background} />
      <Path d="M32 27.5c1.8 0 3.2 1 3.2 2.2S33.8 32 32 32s-3.2-1-3.2-2.3 1.4-2.2 3.2-2.2Z" fill={theme.bonusPending} />
    </Svg>
  );
}
