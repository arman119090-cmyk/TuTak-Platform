import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../../config/configuration';
import { UsersService } from '../../users/users.service';
import { RequestUser } from '../types/request-user.type';

export interface JwtAccessPayload {
  sub: string;
  phone: string;
  deviceId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      /*
       * Which key verifies this token — the live one, or the one being
       * retired.
       *
       * ## Why rotation needs anything at all
       *
       * Changing `JWT_ACCESS_SECRET` on its own invalidates every access
       * token in flight at once, so every signed-in customer is thrown out
       * mid-action. That cost is exactly why a leaked secret sits unrotated
       * for days, and an unrotated leaked secret is the real danger. With an
       * overlap, the new secret signs from the moment of deploy, tokens
       * minted under the old one keep working until they expire (fifteen
       * minutes by default), and `JWT_ACCESS_SECRET_PREVIOUS` is then
       * removed.
       *
       * ## Why a provider rather than a second strategy
       *
       * A second Passport strategy would have to be registered — or not —
       * from `process.env` at module-definition time, because `@Module()`
       * metadata is evaluated on import, before DI exists. That is both
       * awkward to test and a wiring decision made in a place that cannot
       * see configuration. `secretOrKeyProvider` exists precisely to choose
       * a key per token, and choosing it by trying is a legitimate way to
       * choose.
       *
       * ## What it never does
       *
       * Signs. `AuthService.issueTokenPair` uses `jwt.accessSecret` and only
       * that, so the retiring key verifies and expires; it never mints. A
       * path that could also sign with it would make the retiring secret a
       * second live one, which is the opposite of retiring it.
       *
       * The trial uses the `JwtService` this module already registers rather
       * than reaching for `jsonwebtoken` directly: adding a dependency to
       * hand-verify a token, or hand-rolling HS256, would be two ways of
       * writing verification code that already exists and is already tested.
       *
       * The extra verification costs one HMAC, only while a rotation is in
       * progress, and only for tokens the live secret has already rejected.
       */
      secretOrKeyProvider: (
        _request: unknown,
        rawToken: string,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        const current = config.get('jwt.accessSecret', { infer: true });
        const previous = config.get('jwt.previousAccessSecret', { infer: true });
        if (!previous) return done(null, current);

        try {
          // Same pinned algorithm as below: the trial must not accept a token
          // the real verification would refuse.
          jwtService.verify(rawToken, { secret: current, algorithms: ['HS256'] });
          return done(null, current);
        } catch {
          // Could be a token signed with the retiring key, or simply an
          // invalid one. Handing back `previous` lets Passport decide, and it
          // rejects the invalid case exactly as it would have.
          return done(null, previous);
        }
      },
      // Pin the accepted algorithm. With a symmetric string secret the
      // library already refuses `none` and any asymmetric algorithm, so this
      // is defence in depth rather than a fix for a live hole — but it states
      // the one algorithm we sign with explicitly, so no future change to how
      // the secret is sourced can silently widen what a token may be signed
      // with. Access tokens are minted HS256 (see AuthService.issueTokenPair).
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtAccessPayload): Promise<RequestUser> {
    const claims = await this.usersService.buildRequestUserClaims(payload.sub);
    return { ...claims, deviceId: payload.deviceId };
  }
}
