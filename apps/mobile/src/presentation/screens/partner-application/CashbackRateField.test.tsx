import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  CashbackRateField,
  DEFAULT_RATE_BPS,
  MAX_RATE_BPS,
  MIN_RATE_BPS,
  formatRate,
} from './CashbackRateField';

/* eslint-disable @typescript-eslint/no-require-imports */
const { ThemeProvider } = require('../../../app/theme/ThemeProvider');
/* eslint-enable @typescript-eslint/no-require-imports */

const renderField = (valueBps: number, onChange = jest.fn()) => {
  render(
    <ThemeProvider>
      <CashbackRateField valueBps={valueBps} onChange={onChange} />
    </ThemeProvider>,
  );
  return onChange;
};

/**
 * The control an applicant uses to say what they will give back.
 *
 * Two things here are load-bearing and neither is obvious from looking at it.
 *
 * The first is the opening value. An applicant proposes their own rate and we
 * would rather it were generous — a higher one ranks them ahead of
 * nearer-equal neighbours and earns a marker customers can see. Almost nobody
 * moves a control downwards from where it opened, so where it opens decides
 * most outcomes on this screen. It opens high deliberately, and it must stay
 * possible to move it anywhere, including all the way to the floor.
 *
 * The second is the grid. The server accepts half-percent steps between 0.5%
 * and 20% and refuses anything else, so a control that could produce 7.3%
 * would build a form that fails on submit for a reason the applicant cannot
 * see.
 */
describe('the cashback rate an applicant proposes', () => {
  it('opens generously rather than at the floor', () => {
    // Not an arbitrary constant: opening at the minimum would quietly make
    // 0.5% the answer for most applicants.
    expect(DEFAULT_RATE_BPS).toBeGreaterThanOrEqual(500);
    expect(DEFAULT_RATE_BPS).toBeLessThanOrEqual(MAX_RATE_BPS);
  });

  it('steps by half a percent, the only increment the server accepts', () => {
    const onChange = renderField(1000);

    fireEvent.press(screen.getByLabelText('+'));
    expect(onChange).toHaveBeenLastCalledWith(1050);

    fireEvent.press(screen.getByLabelText('−'));
    expect(onChange).toHaveBeenLastCalledWith(950);
  });

  it('will go all the way down to the floor', () => {
    const onChange = renderField(MIN_RATE_BPS + 50);

    fireEvent.press(screen.getByLabelText('−'));
    expect(onChange).toHaveBeenLastCalledWith(MIN_RATE_BPS);
  });

  it('stops at the floor and the ceiling', () => {
    const atFloor = renderField(MIN_RATE_BPS);
    fireEvent.press(screen.getByLabelText('−'));
    expect(atFloor).not.toHaveBeenCalled();

    screen.unmount();

    const atCeiling = renderField(MAX_RATE_BPS);
    fireEvent.press(screen.getByLabelText('+'));
    expect(atCeiling).not.toHaveBeenCalled();
  });

  it('prices a sample basket so the percentage means something', () => {
    renderField(1000);
    // 10% of a 10 000 ֏ basket. The preview is the whole reason a rate a
    // shopkeeper cannot picture becomes one they can.
    expect(screen.getByText(/becomePartner\.ratePreview/)).toBeTruthy();
  });

  it('promises the advantage only where the advantage exists', () => {
    renderField(500);
    expect(screen.queryByText('becomePartner.rateAdvantage')).toBeTruthy();

    screen.unmount();

    // Below the server's own threshold there is no better ranking and no
    // marker, so the screen must not claim either.
    renderField(450);
    expect(screen.queryByText('becomePartner.rateAdvantage')).toBeNull();
  });

  describe('how the rate reads', () => {
    it('writes a whole percentage without a decimal part', () => {
      expect(formatRate(1000)).toBe('10');
      expect(formatRate(300)).toBe('3');
    });

    it('uses a comma, which is the decimal mark in all three languages we ship', () => {
      expect(formatRate(1050)).toBe('10,5');
      expect(formatRate(50)).toBe('0,5');
    });
  });
});
