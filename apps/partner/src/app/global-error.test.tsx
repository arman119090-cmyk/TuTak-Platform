import { render } from '@testing-library/react';
import GlobalError from './global-error';

const mockCaptureException = jest.fn();
jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

describe('GlobalError (partner)', () => {
  beforeEach(() => {
    mockCaptureException.mockClear();
  });

  it('reports the error to Sentry exactly once', () => {
    const error = new Error('root layout blew up');

    render(<GlobalError error={error} />);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });
});
