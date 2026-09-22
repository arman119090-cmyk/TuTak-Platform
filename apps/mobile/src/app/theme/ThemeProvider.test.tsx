import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { tutakMobileDarkTheme, tutakMobileLightTheme } from '@tutak/design';
import { ThemeProvider, resolveTheme, useTheme } from './ThemeProvider';
import { useThemeStore } from '../../data/stores/themeStore';

jest.mock('../../data/storage/secureStorage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

// `useColorScheme` is what "same as device" reads. Swapped per test so the
// resolution can be checked under either phone setting.
const mockColorScheme = jest.fn<'light' | 'dark' | null, []>(() => 'light');
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockColorScheme(),
}));

function Probe() {
  const theme = useTheme();
  return <Text testID="mode">{theme.mode}</Text>;
}

describe('resolveTheme', () => {
  it('pins light and dark regardless of the device', () => {
    expect(resolveTheme('light', 'dark')).toBe(tutakMobileLightTheme);
    expect(resolveTheme('dark', 'light')).toBe(tutakMobileDarkTheme);
  });

  it('follows the device for "system", and falls back to light when the device says nothing', () => {
    expect(resolveTheme('system', 'dark')).toBe(tutakMobileDarkTheme);
    expect(resolveTheme('system', 'light')).toBe(tutakMobileLightTheme);
    expect(resolveTheme('system', null)).toBe(tutakMobileLightTheme);
    expect(resolveTheme('system', undefined)).toBe(tutakMobileLightTheme);
  });
});

describe('ThemeProvider', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'system', isHydrated: false });
    mockColorScheme.mockReturnValue('light');
  });

  it('renders the dark theme when the person chose it', () => {
    useThemeStore.setState({ mode: 'dark' });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').props.children).toBe('dark');
  });

  it('follows a dark phone under "system" and re-themes when the choice changes', () => {
    mockColorScheme.mockReturnValue('dark');
    const view = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').props.children).toBe('dark');

    // The person pins light in Settings: the very next render is light,
    // with no restart and no await on storage.
    React.act(() => {
      useThemeStore.setState({ mode: 'light' });
    });
    view.rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').props.children).toBe('light');
  });

  it('the two themes expose the same keys, so no screen can read undefined under one of them', () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(tutakMobileDarkTheme)).toEqual(keys(tutakMobileLightTheme));
    expect(keys(tutakMobileDarkTheme.color)).toEqual(keys(tutakMobileLightTheme.color));
    expect(keys(tutakMobileDarkTheme.premium)).toEqual(keys(tutakMobileLightTheme.premium));
    expect(keys(tutakMobileDarkTheme.bonusState.available)).toEqual(
      keys(tutakMobileLightTheme.bonusState.available),
    );
  });
});
