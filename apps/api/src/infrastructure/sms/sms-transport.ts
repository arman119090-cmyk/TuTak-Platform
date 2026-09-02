import { AppEnvironment, isProductionDeployment, isPublicDeployment } from '../../config/app-environment';
import { ConsoleSmsProvider } from './console-sms.provider';
import { HttpSmsProvider } from './http-sms.provider';
import { UnavailableSmsProvider } from './unavailable-sms.provider';
import {
  VIVA_NUMBER_FORMATS,
  VivaNumberFormat,
  VivaSmsProvider,
} from './viva-sms.provider';
import { SmsProvider } from './sms-provider.interface';

export interface SmsTransportOptions {
  appEnv: AppEnvironment;
  demoMode: boolean;
  driver: 'http' | 'viva';
  endpoint: string;
  authScheme: 'basic' | 'bearer';
  username: string;
  token: string;
  sender: string;
  encoding: 'form' | 'json';
  viva: {
    clientId: string;
    clientSecret: string;
    templateName: string;
    sendUtf: boolean;
    /** Required: the document settles this only by example. */
    numberFormat: string;
    /** Where the access token goes; `bearer` is an inference, not a fact. */
    tokenPlacement: string;
  };
}

/**
 * What a Viva integration cannot work without.
 *
 * Named individually rather than checked as a group because the failure they
 * prevent is silent: a template name that is empty is still a valid JSON
 * request, and Viva would reject it — or worse, accept it — for reasons that
 * would take a support ticket to work out. Failing at boot with the name of
 * the missing variable costs seconds instead.
 */
export function missingVivaSettings(opts: SmsTransportOptions): string[] {
  return (
    [
      ['SMS_ENDPOINT', opts.endpoint],
      ['SMS_VIVA_CLIENT_ID', opts.viva.clientId],
      ['SMS_VIVA_CLIENT_SECRET', opts.viva.clientSecret],
      ['SMS_USERNAME', opts.username],
      ['SMS_TOKEN', opts.token],
      ['SMS_SENDER', opts.sender],
      ['SMS_VIVA_TEMPLATE_NAME', opts.viva.templateName],
      // No default on purpose. The integration document shows one example
      // number and states no rule, and a number in a shape Viva does not
      // recognise is accepted into the batch and never delivered — a failure
      // with no symptom except a customer saying no code arrived. Ask Viva,
      // then say the answer out loud here.
      ['SMS_VIVA_NUMBER_FORMAT', opts.viva.numberFormat],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);
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
  if (opts.driver === 'viva') {
    const missing = missingVivaSettings(opts);
    if (missing.length > 0) {
      // Deliberately a boot failure in every environment, not only
      // production: somebody who asked for Viva by name and did not get it
      // has a deployment that cannot sign anyone in, and finding that out
      // from a customer is the expensive way.
      throw new Error(
        `SMS_DRIVER=viva but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`,
      );
    }

    if (!(VIVA_NUMBER_FORMATS as readonly string[]).includes(opts.viva.numberFormat)) {
      throw new Error(
        `SMS_VIVA_NUMBER_FORMAT must be one of ${VIVA_NUMBER_FORMATS.join(', ')} — ` +
          `got "${opts.viva.numberFormat}".`,
      );
    }

    return new VivaSmsProvider({
      baseUrl: opts.endpoint.replace(/\/+$/, ''),
      clientId: opts.viva.clientId,
      clientSecret: opts.viva.clientSecret,
      username: opts.username,
      password: opts.token,
      senderName: opts.sender,
      templateName: opts.viva.templateName,
      sendUtf: opts.viva.sendUtf,
      numberFormat: opts.viva.numberFormat as VivaNumberFormat,
      tokenPlacement: opts.viva.tokenPlacement,
    });
  }

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
