import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  getAllEvents,
  logEvent,
  logEventCoalesced,
  resetEvents,
  runId,
  serializeEvents,
} from './eventLog';
import { resetInstanceTrace, useMountTrace } from './instanceTrace';

function Traced({ name }: { name: string }) {
  useMountTrace(name);
  return <Text>{name}</Text>;
}

const texts = () => getAllEvents().map((event) => event.text);

/**
 * The claim these tests exist to keep honest is a negative one: a repeated
 * `mount` line does **not** show that Android recreated the activity. The
 * previous round read it that way, and the log could not have contradicted
 * it. What follows is the machinery that now can.
 */
describe('telling a remount apart from a restart', () => {
  beforeEach(() => {
    resetEvents();
    resetInstanceTrace();
  });

  it('numbers each mount of a name within one JS runtime', () => {
    const first = render(<Traced name="OtpRegister" />);
    first.unmount();
    render(<Traced name="OtpRegister" />);

    expect(texts()).toEqual([
      'mount OtpRegister #1 @1',
      'unmount OtpRegister @1',
      'mount OtpRegister #2 @2',
    ]);
  });

  it('gives the second instance a different id, so two fields are never read as one', () => {
    // The registration screen's actual shape: two inputs, alive at once.
    render(
      <>
        <Traced name="field:phone" />
        <Traced name="field:referral" />
      </>,
    );

    const ids = texts().map((text) => /@(\d+)$/.exec(text)?.[1]);
    expect(new Set(ids).size).toBe(2);
    expect(texts()).toEqual(['mount field:phone #1 @1', 'mount field:referral #1 @2']);
  });

  it('counts a screen and its root separately, which is the whole distinction', () => {
    // A screen rebuilt under a root that stayed put: `App` still says #1.
    render(<Traced name="App" />);
    const screen = render(<Traced name="OtpRegister" />);
    screen.unmount();
    render(<Traced name="OtpRegister" />);

    expect(texts().filter((t) => t.startsWith('mount App'))).toEqual(['mount App #1 @1']);
    expect(texts().filter((t) => t.startsWith('mount OtpRegister'))).toEqual([
      'mount OtpRegister #1 @2',
      'mount OtpRegister #2 @3',
    ]);
  });

  it('re-rendering a mounted component logs nothing at all', () => {
    const view = render(<Traced name="field:phone" />);
    view.rerender(<Traced name="field:phone" />);
    view.rerender(<Traced name="field:phone" />);

    expect(texts()).toEqual(['mount field:phone #1 @1']);
  });
});

describe('the exported log', () => {
  beforeEach(() => {
    resetEvents();
    resetInstanceTrace();
  });

  it('carries the build, the run and the row count above the events', () => {
    logEvent('focus phone');
    logEvent('kbShow h=850');

    const text = serializeEvents({ commit: 'abc1234', profile: 'preview' });

    expect(text).toContain(`run ${runId()}`);
    expect(text).toContain('commit abc1234');
    expect(text).toContain('profile preview');
    expect(text).toContain('events 2');
    expect(text).toContain('focus phone');
    expect(text).toContain('kbShow h=850');
  });

  it('keeps far more than the panel draws, because the panel is not the evidence', () => {
    for (let i = 0; i < 60; i += 1) logEvent(`event ${i}`);

    // The panel shows the last fourteen; the export has all sixty.
    expect(getAllEvents()).toHaveLength(60);
    expect(serializeEvents({}).split('\n').filter((l) => l.includes('event '))).toHaveLength(60);
  });

  it('is emptied only by an explicit clear, never by moving between screens', () => {
    logEvent('mount Login #1 @1');
    const screen = render(<Traced name="OtpRegister" />);
    screen.unmount();
    render(<Traced name="Login" />);

    // Everything from before the navigation is still there: the sequence that
    // explains a fault starts before the screen it happens on.
    expect(texts()[0]).toBe('mount Login #1 @1');
    expect(texts()).toHaveLength(4);

    resetEvents();
    expect(texts()).toEqual([]);
  });
});

/**
 * The one way this instrument could lie about the very thing it measures.
 */
describe('a renamed trace is not a remount', () => {
  beforeEach(() => {
    resetEvents();
    resetInstanceTrace();
  });

  it('says nothing when only the name changes under a component that stayed put', () => {
    // What a language switch does to a field whose trace id falls back to its
    // translated label. The component did not go anywhere, and the log must
    // not claim it did.
    const view = render(<Traced name="field:Phone number" />);
    view.rerender(<Traced name="field:Հեռախոսահամար" />);

    expect(texts()).toEqual(['mount field:Phone number #1 @1']);
  });
});


/**
 * The instrument defect that cost a capture, pinned so it cannot come back.
 *
 * A finger drag emits a scroll sample every 16ms and none of them are
 * textually identical, so `logEvent`'s repeat counter never fired: ninety
 * lines a second pushed the focus events out of the ring buffer, and the
 * export came back "older ones dropped", ending one line before the part it
 * was taken for.
 */
describe('folding a burst of related lines', () => {
  beforeEach(resetEvents);

  /** What `KeyboardAwareScroll` does: keep the start, rewrite the end. */
  const scroll = (y: number) =>
    logEventCoalesced('scroll y=', (previous) => {
      const from = /^scroll y=(-?\d+)/.exec(previous ?? '')?.[1];
      return from === undefined ? `scroll y=${y}` : `scroll y=${from}→${y}`;
    });

  it('keeps one line for a whole drag, with where it started and where it ended', () => {
    logEvent('focus phone');
    scroll(10);
    scroll(40);
    scroll(90);

    expect(getAllEvents().map((e) => e.text)).toEqual([
      'focus phone',
      'scroll y=10→90 ×3',
    ]);
  });

  it('dates the burst from its first sample, not its last', () => {
    // That timestamp is the whole point: a scroll is only worth anything
    // against a `focus` if you can see which came first.
    logEvent('focus phone');
    scroll(10);
    const started = getAllEvents()[1].at;
    scroll(40);
    scroll(90);

    expect(getAllEvents()[1].at).toBe(started);
  });

  it('does not swallow what comes after the burst', () => {
    scroll(10);
    scroll(20);
    logEvent('blur  phone');
    scroll(30);

    expect(getAllEvents().map((e) => e.text)).toEqual([
      'scroll y=10→20 ×2',
      'blur  phone',
      'scroll y=30',
    ]);
  });

  it('leaves a scroll inside focus handling perfectly legible', () => {
    // One sample between a focus and a blur is the signal the whole thing
    // exists for, and it must not be folded into invisibility.
    logEvent('focus phone');
    scroll(12);
    logEvent('blur  phone');

    expect(getAllEvents().map((e) => e.text)).toEqual([
      'focus phone',
      'scroll y=12',
      'blur  phone',
    ]);
  });
});

/**
 * The guarantee that a fault which scrolls cannot hide itself.
 *
 * Folding made eviction rare. This makes it impossible: when the buffer is
 * full, a scroll line is spent before any focus, blur, REQ, mount, keyboard,
 * experiment or app-state line — and only when there is no scroll left does
 * anything else go.
 */
describe('what the buffer sacrifices when it is full', () => {
  beforeEach(resetEvents);

  it('spends scroll lines before anything the log was taken for', () => {
    logEvent('focus phone');
    logEvent('REQ focus phone');
    for (let i = 0; i < 500; i += 1) logEvent(`scroll y=${i}`);

    const texts = getAllEvents().map((e) => e.text);
    expect(texts).toContain('focus phone');
    expect(texts).toContain('REQ focus phone');
  });

  it('keeps the order it recorded, rather than moving survivors around', () => {
    logEvent('focus phone');
    for (let i = 0; i < 500; i += 1) logEvent(`scroll y=${i}`);
    logEvent('blur  phone');

    const texts = getAllEvents().map((e) => e.text);
    expect(texts.indexOf('focus phone')).toBeLessThan(texts.indexOf('blur  phone'));
  });

  it('falls back to dropping the oldest once no scroll is left to spend', () => {
    for (let i = 0; i < 500; i += 1) logEvent(`focus field-${i}`);

    const texts = getAllEvents().map((e) => e.text);
    expect(texts).not.toContain('focus field-0');
    expect(texts[texts.length - 1]).toBe('focus field-499');
  });
});
