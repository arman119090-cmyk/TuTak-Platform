import { getAllEvents, resetEvents } from './eventLog';
import { describeFocus, logWithFocus, registerInput, resetFocusRegistry } from './focusRegistry';

const texts = () => getAllEvents().map((event) => event.text);

/**
 * The point of this registry is that it can *disagree* with the app.
 *
 * Every earlier round read focus off what was drawn — a ring on a field, in a
 * photograph or a video frame. That reads the app's opinion about an event it
 * received, which is the inference this investigation keeps having to
 * un-make. These cases are the ones where the answer is not the obvious one.
 */
describe('what the keyboard events say about focus', () => {
  beforeEach(() => {
    resetEvents();
    resetFocusRegistry();
  });

  it('names the focused field and the keyboard it asked for', () => {
    registerInput({ traceId: 'phone', keyboardType: 'number-pad', isFocused: () => false });
    registerInput({ traceId: 'referral', keyboardType: 'default', isFocused: () => true });

    expect(describeFocus()).toBe('on=referral kbd=default');
  });

  it('says so when a keyboard is up and nothing claims focus', () => {
    // The case that would otherwise be invisible: the IME is on screen and
    // React Native believes no input has focus. That is a finding, not a gap.
    registerInput({ traceId: 'phone', keyboardType: 'number-pad', isFocused: () => false });
    registerInput({ traceId: 'referral', keyboardType: 'default', isFocused: () => false });

    expect(describeFocus()).toBe('on=none of=2');
  });

  it('reports both when two inputs claim focus rather than picking one', () => {
    registerInput({ traceId: 'phone', keyboardType: 'number-pad', isFocused: () => true });
    registerInput({ traceId: 'referral', keyboardType: 'default', isFocused: () => true });

    expect(describeFocus()).toBe('on=phone+referral kbd=multiple');
  });

  it('survives a handle whose component is being torn down', () => {
    registerInput({
      traceId: 'phone',
      keyboardType: 'number-pad',
      isFocused: () => {
        throw new Error('view is gone');
      },
    });
    registerInput({ traceId: 'referral', keyboardType: 'default', isFocused: () => true });

    // Not knowing about one input is an answer; throwing inside a keyboard
    // listener would take the log down with it.
    expect(describeFocus()).toBe('on=referral kbd=default');
  });

  it('forgets a field once it is unregistered', () => {
    const remove = registerInput({
      traceId: 'referral',
      keyboardType: 'default',
      isFocused: () => true,
    });
    expect(describeFocus()).toBe('on=referral kbd=default');

    remove();
    expect(describeFocus()).toBe('on=none of=0');
  });

  it('appends the answer to the keyboard lines, which is where it is read', () => {
    registerInput({ traceId: 'phone', keyboardType: 'number-pad', isFocused: () => true });

    logWithFocus('kbShow h=850');
    logWithFocus('kbHide');

    expect(texts()).toEqual([
      'kbShow h=850 on=phone kbd=number-pad',
      'kbHide on=phone kbd=number-pad',
    ]);
  });
});
