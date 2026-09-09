import Constants from 'expo-constants';
import { getAllEvents, resetEvents } from './eventLog';
import {
  experimentLabel,
  getFocusRerender,
  getScrollsChildToFocus,
  resetExperiment,
  toggleFocusRerender,
  toggleScrollsChildToFocus,
} from './experiment';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { diagnostics: true } } },
}));

const texts = () => getAllEvents().map((event) => event.text);

/**
 * The switch that turns a correlation into a comparison.
 *
 * Everything the log has said about `scrollsChildToFocus` so far is ordering,
 * not cause, and it cannot become cause passively: `ReactScrollView` runs
 * `scrollToChild` on every focus but only scrolls when the delta is non-zero
 * (`if (scrollDelta != 0) { scrollBy(0, scrollDelta); }`), so on a short form
 * the call happens and emits nothing. Absence of a scroll line excludes
 * nothing at all.
 *
 * What can settle it is varying this one prop and nothing else, in one build
 * and one session. These assertions are about the bookkeeping that makes such
 * a trial attributable — the arm has to be recorded, and it has to be in the
 * export, or a run cannot be assigned to the side it belongs to.
 */
describe('the single-parameter experiment switch', () => {
  beforeEach(() => {
    resetEvents();
    resetExperiment();
    (Constants as { expoConfig: unknown }).expoConfig = { extra: { diagnostics: true } };
  });

  it('ships in the state the app ships in', () => {
    // `false` is what is committed; the trial exists to compare against it,
    // not to change what a build does by default.
    expect(getScrollsChildToFocus()).toBe(false);
    expect(getFocusRerender()).toBe(true);
    expect(experimentLabel()).toBe('SCF=off RR=on');
  });

  it('records every change of arm, so a trial cannot be attributed wrongly', () => {
    toggleScrollsChildToFocus();
    expect(getScrollsChildToFocus()).toBe(true);
    expect(experimentLabel()).toBe('SCF=on RR=on');

    toggleScrollsChildToFocus();
    expect(getScrollsChildToFocus()).toBe(false);

    expect(texts()).toEqual([
      'exp scrollsChildToFocus=on',
      'exp scrollsChildToFocus=off',
    ]);
  });

  it('shows both arms at once, so a trial that changed two is visible as such', () => {
    // A trial is only worth reading if exactly one arm moved. The label
    // carries both, so two flips cannot be mistaken for one.
    toggleScrollsChildToFocus();
    toggleFocusRerender();

    expect(experimentLabel()).toBe('SCF=on RR=off');
    expect(texts()).toEqual([
      'exp scrollsChildToFocus=on',
      'exp focusRerender=off',
    ]);
  });

  it('records the re-render arm separately from the scroll one', () => {
    toggleFocusRerender();

    expect(getFocusRerender()).toBe(false);
    expect(getScrollsChildToFocus()).toBe(false);
    expect(experimentLabel()).toBe('SCF=off RR=off');
  });
});
