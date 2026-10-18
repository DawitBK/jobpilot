import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { jwtVerify, SignJWT } from 'jose';
import { ROLE_NAMES, type RoleName } from '../db/schema.js';
import { forbidden, unauthorized } from './errors.js';
import { PERMISSIONS, type Permission } from './permissions.js';

export interface Principal {
  userId: string;
  organizationId: string;
  role: RoleName;
  permissions: Permission[];
}

export const PUBLIC_KEY = 'jobpilot:public';
export const PERMISSION_KEY = 'jobpilot:permissions';
export const AUTH_CONFIG = 'AUTH_CONFIG';

export interface AuthConfig {
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  /** Single sign-on through an OpenID Connect provider; absent means password sign-in only. */
  oidc?: { issuer: string; clientId: string; clientSecret: string };
}

/** Routes are denied by default; mark a handler `@Public()` to open it. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** The caller must hold every listed permission (checked against the token, which holds the role's set). */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);

/** The authenticated principal of the request (set by the global AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<{ principal?: Principal }>().principal;
    if (!principal) throw unauthorized();
    return principal;
  },
);

const ACCESS_TYPE = 'at+jwt';
const SELECTION_TYPE = 'org-selection+jwt';

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async signAccessToken(p: Principal): Promise<string> {
    return new SignJWT({ org: p.organizationId, role: p.role, perms: p.permissions })
      .setProtectedHeader({ alg: 'HS256', typ: ACCESS_TYPE })
      .setSubject(p.userId)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.key);
  }

  /** Short-lived proof that a password was checked, good only for choosing an organization. */
  async signSelectionToken(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: SELECTION_TYPE })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.key);
  }

  async verifySelectionToken(token: string): Promise<string> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
      });
      if (protectedHeader.typ !== SELECTION_TYPE || typeof payload.sub !== 'string') {
        throw new Error('wrong token type');
      }
      return payload.sub;
    } catch {
      throw unauthorized('The organization selection token is not valid');
    }
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
      });
      // A selection token must never work as an access token.
      if (protectedHeader.typ !== ACCESS_TYPE) throw new Error('wrong token type');
      const role = payload['role'];
      const org = payload['org'];
      const perms = payload['perms'];
      if (
        typeof payload.sub !== 'string' ||
        typeof org !== 'string' ||
        !(ROLE_NAMES as readonly unknown[]).includes(role) ||
        !Array.isArray(perms)
      ) {
        throw new Error('malformed claims');
      }
      return {
        userId: payload.sub,
        organizationId: org,
        role: role as RoleName,
        permissions: perms.filter((p): p is Permission =>
          (PERMISSIONS as readonly unknown[]).includes(p),
        ),
      };
    } catch {
      throw unauthorized();
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets)) return true;
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      principal?: Principal;
    }>();
    const header = req.headers['authorization'];
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!bearer) throw unauthorized();
    req.principal = await this.tokens.verifyAccessToken(bearer);

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (required && !required.every((p) => req.principal!.permissions.includes(p))) {
      throw forbidden();
    }
    return true;
  }
}
