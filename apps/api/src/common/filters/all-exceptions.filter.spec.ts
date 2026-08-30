import { BadRequestException, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

const captureApiExceptionMock = jest.fn();
jest.mock('../observability/sentry', () => ({
  captureApiException: (...args: unknown[]) => captureApiExceptionMock(...args),
  normalizeRoute: () => '/v1/users/:id',
}));

function buildHost(method: string, url: string): ArgumentsHost {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = { method, url, route: undefined };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter — Sentry capture policy', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    captureApiExceptionMock.mockClear();
  });

  it('captures an unexpected 500 exactly once, with only allow-listed metadata', () => {
    const host = buildHost('GET', '/v1/users/abc');
    const error = new Error('database connection lost');

    filter.catch(error, host);

    expect(captureApiExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureApiExceptionMock).toHaveBeenCalledWith(error, {
      method: 'GET',
      route: '/v1/users/:id',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });

  it('never sends an expected 4xx validation error to Sentry', () => {
    const host = buildHost('POST', '/v1/auth/login');
    const exception = new BadRequestException('phone must be a valid Armenian number');

    filter.catch(exception, host);

    expect(captureApiExceptionMock).not.toHaveBeenCalled();
  });

  it('never sends an expected 401/403 to Sentry', () => {
    const host = buildHost('GET', '/v1/wallet/me');
    const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    filter.catch(exception, host);

    expect(captureApiExceptionMock).not.toHaveBeenCalled();
  });
});
