import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_CONFIG, AuthGuard, TokenService, type AuthConfig } from '../common/auth.js';
import { AccountController } from './account.controller.js';
import { ACCOUNT_OPTIONS, AccountService, type AccountOptions } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { MAILER, NoMailer, type Mailer } from '../outbox/mailer.js';
import { MfaController } from './mfa.controller.js';
import { MfaService } from './mfa.service.js';
import { AuthService } from './auth.service.js';
import { OidcService } from './oidc.service.js';

@Global()
@Module({})
export class AuthModule {
  static forRoot(
    config: AuthConfig,
    account: { options: AccountOptions; mailer?: Mailer } = { options: { appUrl: '' } },
  ): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController, MfaController, AccountController],
      providers: [
        { provide: AUTH_CONFIG, useValue: config },
        TokenService,
        AuthService,
        MfaService,
        OidcService,
        AccountService,
        { provide: ACCOUNT_OPTIONS, useValue: account.options },
        { provide: MAILER, useValue: account.mailer ?? new NoMailer() },
        // Every route requires a valid token unless it is marked @Public().
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [TokenService, AuthService],
    };
  }
}
