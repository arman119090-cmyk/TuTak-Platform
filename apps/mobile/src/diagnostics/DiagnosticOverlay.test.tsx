import React from 'react';
import { render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { DiagnosticOverlay } from './DiagnosticOverlay';
import { logEvent, resetEvents } from './eventLog';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
jest.mock('./logExport', () => ({
  __esModule: true,
  shareLogFile: jest.fn(async () => 'shared'),
  shareLogTail: jest.fn(async () => 'shared'),
  shareLogText: jest.fn(async () => 'shared'),
}));

const setExtra = (extra: Record<string, unknown>) => {
  (Constants as { expoConfig: unknown }).expoConfig = { extra };
};

/**
 * A control that does not fit on the screen is a control that does not exist.
 *
 * On a 384-wide handset the buttons sat in a row beside the header, and the
 * last two — EXPORT and CLEAR, the two an operator actually needs — were past
 * the right edge and could not be tapped at all. Nothing failed; they were
 * simply not there. The row now wraps, and this pins both halves of that: the
 * buttons are rendered, and the container they are in is allowed to wrap.
 */
describe('the diagnostic panel controls', () => {
  beforeEach(() => {
    resetEvents();
    setExtra({ diagnostics: true, commit: 'abc1234def' });
  });

  it('renders every control, including the ones that used to fall off the edge', () => {
    render(<DiagnosticOverlay />);

    for (const label of ['SCF', 'RR', 'TXT', 'TAIL50', 'TEXT', 'CLEAR']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('puts them in a row that wraps rather than one that clips', () => {
    render(<DiagnosticOverlay />);

    const row = screen.getByText('CLEAR').parent?.parent;
    expect(wrappingStyleOf(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  });

  it('draws nothing at all outside a diagnostic build', () => {
    setExtra({});
    logEvent('focus Phone');

    render(<DiagnosticOverlay />);
    expect(screen.queryByText('CLEAR')).toBeNull();
  });
});

/** The resolved style of whichever ancestor is the wrapping row, or `{}`. */
function wrappingStyleOf(node: unknown): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { StyleSheet } = require('react-native');
  let current = node as { props?: { style?: unknown }; parent?: unknown } | null | undefined;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const style = StyleSheet.flatten(current.props?.style) as Record<string, unknown> | undefined;
    if (style?.flexWrap) return style;
    current = current.parent as typeof current;
  }
  return {};
}
