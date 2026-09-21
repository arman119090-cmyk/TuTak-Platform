import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PinPad } from './PinPad';

describe('PinPad', () => {
  it('shows one filled dot per typed digit and routes every key', () => {
    const onDigit = jest.fn();
    const onBackspace = jest.fn();
    const onBiometric = jest.fn();
    render(
      <PinPad value="12" onDigit={onDigit} onBackspace={onBackspace} onBiometric={onBiometric} biometricKind="face" biometricLabel="Face ID" />,
    );
    expect(screen.getAllByTestId('pin-dot-filled')).toHaveLength(2);
    expect(screen.getAllByTestId('pin-dot-empty')).toHaveLength(2);
    fireEvent.press(screen.getByTestId('pin-key-7'));
    expect(onDigit).toHaveBeenCalledWith('7');
    fireEvent.press(screen.getByTestId('pin-key-back'));
    expect(onBackspace).toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Face ID'));
    expect(onBiometric).toHaveBeenCalled();
  });

  it('draws no biometric key when there is nothing to offer, and ignores presses while disabled', () => {
    const onDigit = jest.fn();
    render(<PinPad value="" onDigit={onDigit} onBackspace={jest.fn()} disabled />);
    expect(screen.queryByTestId('pin-key-bio')).toBeNull();
    fireEvent.press(screen.getByTestId('pin-key-1'));
    expect(onDigit).not.toHaveBeenCalled();
  });
});
