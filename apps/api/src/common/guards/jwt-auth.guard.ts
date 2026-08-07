import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestContext } from '../observability/request-context';

interface AuthenticatedRequest {
  user?: { id?: string };
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * The one place that knows who the caller is early enough to be useful.
   *
   * Stamping the user onto the correlation context here means every log line
   * the request goes on to produce carries it, which is what makes "show me
   * everything this account did" a query rather than an investigation.
   */
  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const result = super.handleRequest(err, user, info, context, status) as TUser;
    const id = (result as AuthenticatedRequest['user'])?.id;
    if (id) requestContext.setUser(id);
    return result;
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
