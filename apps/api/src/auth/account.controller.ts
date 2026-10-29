import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, Public, type Principal } from '../common/auth.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type ChangePassword,
  type ForgotPassword,
  type ResetPassword,
} from './auth.contract.js';
import { AccountService } from './account.service.js';

@Controller('api/v1')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  /** Asks for a recovery link. The answer is the same for every address, so it cannot be used to find out who has an account. */
  @Public()
  @Post('auth/forgot-password')
  @HttpCode(202)
  async forgot(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPassword) {
    await this.account.requestReset(body);
    return { accepted: true };
  }

  @Public()
  @Post('auth/reset-password')
  @HttpCode(204)
  async reset(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPassword) {
    await this.account.reset(body);
  }

  /** The signed-in person's own password. */
  @Post('me/password')
  @HttpCode(204)
  async change(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePassword,
  ) {
    await this.account.change(p, body);
  }
}
