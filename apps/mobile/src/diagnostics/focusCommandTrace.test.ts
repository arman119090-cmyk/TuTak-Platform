import Constants from 'expo-constants';
import { getAllEvents, resetEvents } from './eventLog';
import { registerInput, resetFocusRegistry, nameForNode } from './focusRegistry';
import { installFocusCommandTrace, resetFocusCommandTrace } from './focusCommandTrace';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true } } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TextInputState = require('react-native/Libraries/Components/TextInput/TextInputState');

const state: Record<string, (arg: unknown) => void> =
  TextInputState.default ?? TextInputState;

const texts = () => getAllEvents().map((event) => event.text);
const setDiagnostics = (on: boolean) => {
  (Constants as { expoConfig: unknown }).expoConfig = { extra: { diagnostics: on } };
};

/**
 * The discriminator the whole next capture rests on.
 *
 * The device log shows focus moving between two fields in twenty
 * milliseconds. `onFocus` fires the same way whether some JavaScript asked
 * for that or Android did it and merely told React Native — and those have
 * different fixes. This records the *asking*, so its absence is as
 * meaningful as its presence.
 */
describe('recording who asked for focus to move', () => {
  const originals = { ...state };

  beforeEach(() => {
    resetEvents();
    resetFocusRegistry();
    resetFocusCommandTrace();
    Object.assign(state, originals);
    setDiagnostics(true);
  });

  afterEach(() => {
    Object.assign(state, originals);
  });

  it('names the field a focus command was aimed at', () => {
    const node = { id: 'phone-node' };
    registerInput({
      traceId: 'phone',
      keyboardType: 'number-pad',
      isFocused: () => false,
      node: () => node,
    });

    installFocusCommandTrace();
    state.focusTextInput(node);

    expect(texts().some((t) => t.startsWith('REQ focus phone'))).toBe(true);
  });

  it('records a blur command, which is how the keyboard is usually closed', () => {
    const node = { id: 'password-node' };
    registerInput({
      traceId: 'password',
      keyboardType: 'default',
      isFocused: () => true,
      node: () => node,
    });

    installFocusCommandTrace();
    state.blurTextInput(node);

    expect(texts().some((t) => t.startsWith('REQ blur password'))).toBe(true);
  });

  it('still calls through, so the instrument cannot change what it measures', () => {
    const seen: unknown[] = [];
    state.focusTextInput = (node: unknown) => void seen.push(node);
    const node = { id: 'phone-node' };

    installFocusCommandTrace();
    state.focusTextInput(node);

    expect(seen).toEqual([node]);
  });

  it('says nothing when native reports focus rather than being asked for it', () => {
    // `focusInput`/`blurInput` are React Native's bookkeeping, called from
    // TextInput's own onFocus/onBlur — the record of what native said. If
    // those were patched too, case B would be logged as if it were case A
    // and the log would answer the wrong question.
    const node = { id: 'phone-node' };
    registerInput({
      traceId: 'phone',
      keyboardType: 'number-pad',
      isFocused: () => false,
      node: () => node,
    });

    installFocusCommandTrace();
    state.focusInput(node);
    state.blurInput(node);

    expect(texts().filter((t) => t.startsWith('REQ'))).toEqual([]);
  });

  it('is not installed outside a diagnostic build', () => {
    setDiagnostics(false);
    const before = state.focusTextInput;

    installFocusCommandTrace();

    expect(state.focusTextInput).toBe(before);
    expect(texts()).toEqual([]);
  });

  it('installs once, however many times it is called', () => {
    installFocusCommandTrace();
    const wrapped = state.focusTextInput;
    installFocusCommandTrace();

    expect(state.focusTextInput).toBe(wrapped);
    expect(texts().filter((t) => t.includes('focus-commands armed'))).toHaveLength(1);
  });

  it('names a command aimed at something no field registered', () => {
    // Worth a line rather than silence: focus being moved to a view this app
    // does not own is itself a finding.
    expect(nameForNode({ id: 'stranger' })).toBe('other-input');
    expect(nameForNode(null)).toBe('nothing');
  });

  it('matches the inner host instance React Native actually passes', () => {
    // A `ref` on TextInput is the outer instance; the commands receive the
    // inner one. Both have to resolve to the same name or every real request
    // would be logged as `other-input`.
    const inner = { id: 'inner' };
    const outer = { getNativeRef: () => inner };
    registerInput({
      traceId: 'phone',
      keyboardType: 'number-pad',
      isFocused: () => false,
      node: () => outer,
    });

    expect(nameForNode(inner)).toBe('phone');
    expect(nameForNode(outer)).toBe('phone');
  });
});
