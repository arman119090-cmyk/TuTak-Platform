import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AuthService, RequestMeta } from './auth.service';

/**
 * A way into a demonstration without a phone that can receive SMS.
 *
 * ## What this is not
 *
 * It is not a way past authentication. There is no second login path, no
 * "trusted" branch, and nothing here that a session could come out of except
 * `AuthService.login` — the same call the login screen makes, with the same
 * rate limit in front of it, the same lockout behind it, the same password
 * verification, the same token issue and the same refresh cookie.
 *
 * All it does is supply a phone number and password that the deployment has
 * already created for itself. A person who typed those two values into the
 * login form would get exactly this, and the seeded demo credentials are
 * printed by the seeder for that reason. This endpoint saves the typing on a
 * phone; it does not grant anything the typing would not have.
 *
 * ## Why it cannot leak into production
 *
 * It answers only when `DEMO_MODE=true`, and answers `404` otherwise — not
 * `403`, because a route that refuses is a route that exists, and a
 * production deployment should not advertise one. `DEMO_MODE` is the same
 * flag that already governs the sandbox payment adapter and the stub SMS
 * sender: a deployment either is a demonstration or it is not, and there is
 * one switch rather than a family of them that can disagree.
 *
 * Without seeded demo data it answers `404` as well, with a message naming
 * what is missing — an empty demonstration and a disabled one look identical
 * from a phone otherwise.
 */
@Injectable()
export class DemoSessionService {
  private readonly logger = new Logger(DemoSessionService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly authService: AuthService,
  ) {}

  /**
   * The customer the seeder creates first, and the one with a full history
   * behind it — a wallet with points, purchases, a referral, a charging
   * session. The others exist so partner screens have more than one name in
   * them; this is the one worth landing on.
   */
  static readonly DEMO_PHONE = '+37477100001';

  /**
   * @param deviceId the caller's own device id, exactly as a typed login
   * would carry it — so a demo session is bound to the phone it was created
   * on and revoking it works the same way.
   */
  async createSession(deviceId: string, meta: RequestMeta) {
    if (!this.config.get('demoMode', { infer: true })) {
      throw new NotFoundException();
    }

    const password = process.env.DEMO_PASSWORD;
    if (!password) {
      // Deliberately explicit: this is a misconfigured demonstration, not a
      // wrong password, and whoever deployed it needs to know which.
      this.logger.warn('DEMO_MODE is on but DEMO_PASSWORD is not set — demo sign-in is unavailable');
      throw new NotFoundException(
        'This deployment has no demo data. Set DEMO_PASSWORD and DEMO_SEED=true, then redeploy.',
      );
    }

    try {
      return await this.authService.login(
        { phone: DemoSessionService.DEMO_PHONE, password, deviceId },
        meta,
      );
    } catch {
      // `login` refuses without saying why, which is right for a login form
      // and unhelpful here — the only realistic cause is that the seeder has
      // not run.
      throw new NotFoundException(
        'The demo customer does not exist yet. Redeploy with DEMO_SEED=true to create it.',
      );
    }
  }
}
