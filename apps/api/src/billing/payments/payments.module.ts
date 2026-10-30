import { Module, type DynamicModule } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import {
  PAYMENT_OPTIONS,
  PAYMENT_PROVIDERS,
  PaymentsService,
  type PaymentOptions,
} from './payments.service.js';
import type { PaymentProviders } from './registry.js';

/** Paying for a plan through whichever provider the server has keys for. */
@Module({})
export class PaymentsModule {
  static register(providers: PaymentProviders, options: PaymentOptions): DynamicModule {
    return {
      module: PaymentsModule,
      controllers: [PaymentsController],
      providers: [
        PaymentsService,
        { provide: PAYMENT_PROVIDERS, useValue: providers },
        { provide: PAYMENT_OPTIONS, useValue: options },
      ],
      exports: [PaymentsService],
    };
  }
}
