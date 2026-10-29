import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, type Principal } from '../common/auth.js';
import {
  mfaDisableSchema,
  mfaEnableSchema,
  type MfaDisable,
  type MfaEnable,
} from './mfa.contract.js';
import { MfaService } from './mfa.service.js';

/** A person's own two-step sign-in. Every route acts on the signed-in person only. */
@Controller('api/v1/me/mfa')
export class MfaController {
  constructor(@Inject(MfaService) private readonly mfa: MfaService) {}

  @Get()
  status(@CurrentUser() p: Principal) {
    return this.mfa.status(p.userId);
  }

  /** Step 1: a new secret and the address an authenticator app scans. Nothing is switched on yet. */
  @Post('setup')
  @HttpCode(200)
  setup(@CurrentUser() p: Principal) {
    return this.mfa.setup(p);
  }

  /** Step 2: prove the app works with a current code. Returns the recovery codes, shown only this once. */
  @Post('enable')
  @HttpCode(200)
  enable(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(mfaEnableSchema)) body: MfaEnable,
  ) {
    return this.mfa.enable(p, body.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  recoveryCodes(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(mfaEnableSchema)) body: MfaEnable,
  ) {
    return this.mfa.regenerateRecoveryCodes(p, body.code);
  }

  @Post('disable')
  @HttpCode(204)
  async disable(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(mfaDisableSchema)) body: MfaDisable,
  ) {
    await this.mfa.disable(p, body.password, { code: body.code, recoveryCode: body.recoveryCode });
  }
}
