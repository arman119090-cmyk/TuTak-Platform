import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OtpRegisterScreen } from './OtpRegisterScreen';
import { getAllEvents, resetEvents } from '../../../diagnostics/eventLog';
import { resetInstanceTrace } from '../../../diagnostics/instanceTrace';
import { describeFocus, resetFocusRegistry } from '../../../diagnostics/focusRegistry';

jest.mock('../../../data/api/authApi', () => ({
  authApi: {
    requestRegistrationOtp: jest.fn(),
    verifyRegistrationOtp: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');

const renderScreen = () =>
  render(
    <ThemeProvider>
      {/* `BackButton` asks the navigator whether it can go back, so the
          screen needs a real navigation context to render at all. */}
      <NavigationContainer>
        <OtpRegisterScreen
          navigation={{ navigate: jest.fn(), replace: jest.fn() } as never}
          route={{ key: 'OtpRegister', name: 'OtpRegister' } as never}
        />
      </NavigationContainer>
    </ThemeProvider>,
  );

const texts = () => getAllEvents().map((event) => event.text);

/**
 * What a log from this screen has to be able to say.
 *
 * The reported sequence — an alphabetic keyboard, then a numeric one, then no
 * keyboard — is only interpretable if the log names *which* field each event
 * belongs to and whether that field is the same object throughout. Labels
 * could not do that: they are translated, and under test they are i18n keys.
 *
 * These assertions are about the instrumentation, not about the fault. They
 * cannot reproduce it — there is no IME in Jest and react-native-web has no
 * keyboard at all — and pretending otherwise is how five earlier fixes were
 * declared finished.
 */
describe('OtpRegisterScreen diagnostics', () => {
  beforeEach(() => {
    resetEvents();
    resetInstanceTrace();
    resetFocusRegistry();
  });

  it('announces the screen and both fields, each as its own instance', () => {
    renderScreen();

    expect(texts()).toContain('mount OtpRegister #1 @1');
    const fields = texts().filter((t) => t.startsWith('mount field:'));
    expect(fields.map((t) => t.replace(/ @\d+$/, ''))).toEqual([
      'mount field:phone #1',
      'mount field:referral #1',
    ]);
    // Two inputs, two ids. A log that gave them the same id could not say
    // which of them the keyboard was serving.
    const ids = fields.map((t) => /@(\d+)$/.exec(t)?.[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it('names phone and referral separately on focus and on blur', () => {
    const { getByPlaceholderText } = renderScreen();

    const phone = getByPlaceholderText('00 000 000');
    const referral = getByPlaceholderText('TT-XXXXXXXX');

    fireEvent(phone, 'focus');
    fireEvent(phone, 'blur');
    fireEvent(referral, 'focus');

    expect(texts().filter((t) => t.startsWith('focus') || t.startsWith('blur'))).toEqual([
      'focus phone kbd=number-pad',
      // Two spaces after `blur` so the two line up in a photograph of the
      // panel — the alignment is what makes an alternating pattern legible.
      'blur  phone',
      'focus referral kbd=default',
    ]);
  });

  it('records nothing a person typed', () => {
    const { getByPlaceholderText } = renderScreen();

    fireEvent.changeText(getByPlaceholderText('00 000 000'), '93600600');
    fireEvent.changeText(getByPlaceholderText('TT-XXXXXXXX'), 'TT-SECRET1');

    const log = texts().join('\n');
    expect(log).not.toContain('93600600');
    expect(log).not.toContain('TT-SECRET1');
    expect(log).not.toContain('SECRET');
  });

  it('does not remount a field when the other one is typed into', () => {
    // A remount here would be a real finding — and would also mean the log
    // could never distinguish it from the one being chased.
    const { getByPlaceholderText } = renderScreen();
    resetEvents();

    fireEvent.changeText(getByPlaceholderText('00 000 000'), '9360');
    fireEvent.changeText(getByPlaceholderText('TT-XXXXXXXX'), 'TT');

    expect(texts().filter((t) => t.includes('mount'))).toEqual([]);
  });
});

/**
 * The half of the log that answers "which input was the keyboard serving".
 *
 * Simon's two React tests establish that neither field's instance nor its
 * `keyboardType` changes across focus, blur, typing, clearing and a keyboard
 * height change — on the base commit, with the app code untouched. That is
 * worth having and it settles the JS side of the question. It says nothing
 * about native focus, and it does not touch scenario E or F, so what is
 * needed from the device is a log that names the focused input at the moment
 * the keyboard appears and goes.
 *
 * These assertions cover the wiring that produces that line. They cannot
 * reproduce the fault: Jest has no IME.
 */
describe('OtpRegisterScreen focus reporting', () => {
  beforeEach(() => {
    resetEvents();
    resetInstanceTrace();
    resetFocusRegistry();
  });

  it('registers both fields with the keyboard each one asks for', () => {
    renderScreen();

    // Neither is focused under Jest, and the count is what proves both
    // registered — `on=none of=2` rather than `on=none of=0`.
    expect(describeFocus()).toBe('on=none of=2');
  });

  it('puts the keyboard type on the focus line, since the fault is a keyboard changing type', () => {
    const { getByPlaceholderText } = renderScreen();

    fireEvent(getByPlaceholderText('00 000 000'), 'focus');
    fireEvent(getByPlaceholderText('TT-XXXXXXXX'), 'focus');

    expect(texts().filter((t) => t.startsWith('focus'))).toEqual([
      'focus phone kbd=number-pad',
      'focus referral kbd=default',
    ]);
  });

  it('drops a field from the registry when the form swaps to the code stage', () => {
    // The one place this screen replaces its fields. If it ever happened
    // mid-interaction it would look exactly like the reported fault, so the
    // log has to be able to show it.
    const { getByPlaceholderText, unmount } = renderScreen();
    expect(getByPlaceholderText('00 000 000')).toBeTruthy();

    unmount();
    expect(describeFocus()).toBe('on=none of=0');
  });
});
