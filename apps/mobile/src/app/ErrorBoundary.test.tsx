import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ErrorBoundary } from './ErrorBoundary';

const mockWithScope = jest.fn((cb: (scope: { setTag: jest.Mock; setExtra: jest.Mock }) => void) =>
  cb({ setTag: jest.fn(), setExtra: jest.fn() }),
);
const mockCaptureException = jest.fn();
jest.mock('@sentry/react-native', () => ({
  withScope: (cb: (scope: unknown) => void) => mockWithScope(cb),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

function Bomb(): React.ReactElement {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    mockWithScope.mockClear();
    mockCaptureException.mockClear();
    // The boundary logs the caught error deliberately; React also logs its
    // own warning about the error boundary catching it. Silenced here so the
    // test output stays readable — this is not what the test asserts on.
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders its existing fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('TuTak could not start')).toBeTruthy();
    expect(screen.getAllByText(/boom/).length).toBeGreaterThan(0);
  });

  it('reports the caught error to Sentry without changing what is rendered', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect((mockCaptureException.mock.calls[0]![0] as Error).message).toBe('boom');
  });

  it('renders children normally, and never calls Sentry, when nothing throws', () => {
    render(
      <ErrorBoundary>
        <React.Fragment />
      </ErrorBoundary>,
    );

    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
