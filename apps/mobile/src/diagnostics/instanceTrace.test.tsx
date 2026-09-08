import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { getAllEvents, logEvent, resetEvents, runId, serializeEvents } from './eventLog';
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
