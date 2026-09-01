import { AppEnvironment, isProductionDeployment, isPublicDeployment } from '../../config/app-environment';
import { ConsoleSmsProvider } from './console-sms.provider';
import { HttpSmsProvider } from './http-sms.provider';
import { UnavailableSmsProvider } from './unavailable-sms.provider';
import { SmsProvider } from './sms-provider.interface';

export interface SmsTransportOptions {
  appEnv: AppEnvironment;
  demoMode: boolean;
  endpoint: string;
  authScheme: 'basic' | 'bearer';
  username: string;
  token: string;
  sender: string;
  encoding: 'form' | 'json';
}

/**
 * Which transport carries the message, decided from configuration alone.
 *
 * A pure function rather than an inline branch in the module factory so the
 * decision can be asserted for every combination of environment and demo
 * mode — including `production` + `DEMO_MODE=true`, which is the one that
 * used to select the transport that writes verification codes to the log.
 */
export function selectSmsTransport(opts: SmsTransportOptions): SmsProvider {
  if (opts.endpoint) {
    return new HttpSmsProvider({
      endpoint: opts.endpoint,
      authScheme: opts.authScheme,
      username: opts.username,
      password: opts.token,
      sender: opts.sender,
      encoding: opts.encoding,
    });
  }

  // Production must not run without a carrier at all: refusing to boot is
  // louder than refusing each send, and a deployment that cannot deliver a
  // verification code cannot sign anybody in.
  if (isProductionDeployment(opts.appEnv) && !opts.demoMode) {
    throw new Error(
      'SMS_ENDPOINT must be configured in production — verification and password ' +
        'reset codes cannot be delivered without a carrier.',
    );
  }

  // Staging, and a public demonstration, boot without a carrier and fail
  // every send with a generic "temporarily unavailable". What they must
  // never do is fall back to a transport that logs the code — which is
  // exactly what `DEMO_MODE` used to buy here.
  if (isPublicDeployment(opts.appEnv)) return new UnavailableSmsProvider();

  // Local development and automated tests only.
  return new ConsoleSmsProvider();
}
