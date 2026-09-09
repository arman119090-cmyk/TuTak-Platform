import Constants from 'expo-constants';
import { getAllEvents, resetEvents } from './eventLog';
import {
  experimentLabel,
  getCollapsableField,
  getFocusRerender,
  getScrollsChildToFocus,
  resetExperiment,
  toggleCollapsableField,
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
    expect(experimentLabel()).toBe('SCF=off RR=on CF=off');
  });

  it('records every change of arm, so a trial cannot be attributed wrongly', () => {
    toggleScrollsChildToFocus();
    expect(getScrollsChildToFocus()).toBe(true);
    expect(experimentLabel()).toBe('SCF=on RR=on CF=off');

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

    expect(experimentLabel()).toBe('SCF=on RR=off CF=off');
    expect(texts()).toEqual([
      'exp scrollsChildToFocus=on',
      'exp focusRerender=off',
    ]);
  });

  it('records the re-render arm separately from the scroll one', () => {
    toggleFocusRerender();

    expect(getFocusRerender()).toBe(false);
    expect(getScrollsChildToFocus()).toBe(false);
    expect(experimentLabel()).toBe('SCF=off RR=off CF=off');
  });
});

/**
 * The third arm, and the first one aimed at a named mechanism.
 *
 * `SCF` and `RR` were each a guess at which of several things mattered.
 * `collapsable={false}` is different: it pins one Fabric trait —
 * `FormsStackingContext` — true in both states, which is the exact difference
 * the build-40 stack pointed at, and it changes nothing else about the field.
 * So the bookkeeping has to be as strict as for the other two: default is
 * what ships, every flip is recorded, and the header carries all three at
 * once so a trial that moved two is visible as such.
 */
describe('the flattening arm', () => {
  beforeEach(() => {
    resetEvents();
    resetExperiment();
    (Constants as { expoConfig: unknown }).expoConfig = { extra: { diagnostics: true } };
  });

  it('is off by default, which is exactly what the app ships', () => {
    expect(getCollapsableField()).toBe(false);
    expect(experimentLabel()).toBe('SCF=off RR=on CF=off');
  });

  it('records its own flips and leaves the other two arms alone', () => {
    toggleCollapsableField();

    expect(getCollapsableField()).toBe(true);
    expect(getScrollsChildToFocus()).toBe(false);
    expect(getFocusRerender()).toBe(true);
    expect(experimentLabel()).toBe('SCF=off RR=on CF=on');
    expect(texts()).toContain('exp collapsableField=on');
  });

  it('goes back, so one session can carry off → on → off', () => {
    toggleCollapsableField();
    toggleCollapsableField();

    expect(getCollapsableField()).toBe(false);
    expect(texts()).toEqual(['exp collapsableField=on', 'exp collapsableField=off']);
  });
});
