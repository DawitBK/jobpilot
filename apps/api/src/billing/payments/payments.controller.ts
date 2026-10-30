import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ProblemException, ZodValidationPipe } from '@jobpilot/kit';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, RequirePermission, type Principal } from '../../common/auth.js';
import { PLAN_NAMES } from '../plans.js';
import { PaymentsService } from './payments.service.js';

export const checkoutSchema = z
  .object({ plan: z.enum(PLAN_NAMES), provider: z.string().min(1).max(30) })
  .strict();
type Checkout = z.output<typeof checkoutSchema>;

@Controller('api/v1/billing')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  /** Every way of paying the application knows, and whether it works on this server. */
  @RequirePermission('billing:manage')
  @Get('providers')
  providers() {
    return this.payments.list();
  }

  /** Buy a plan: returns the address of the provider's page. The plan changes only when the provider confirms the payment. */
  @RequirePermission('billing:manage')
  @Post('checkout')
  @HttpCode(201)
  checkout(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(checkoutSchema)) body: Checkout,
  ) {
    return this.payments.checkout(p, body);
  }

  @RequirePermission('billing:manage')
  @Get('orders')
  orders(@CurrentUser() p: Principal) {
    return this.payments.orders(p);
  }

  /**
   * Where a provider reports a payment. Public (the provider has no session) and protected by the provider's signature; even then
   * the body is only used to find the order, and the provider is asked directly whether it was paid.
   */
  @Public()
  @Post('webhooks/:provider')
  @HttpCode(200)
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    const outcome = await this.payments.handleWebhook(provider, raw, headers);
    if (outcome === 'bad-signature') {
      throw new ProblemException(
        400,
        'bad-signature',
        'Bad signature',
        'The signature does not match.',
      );
    }
    return { received: true };
  }
}
