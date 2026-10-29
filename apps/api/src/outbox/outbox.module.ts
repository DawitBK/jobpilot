import { Module, type DynamicModule } from '@nestjs/common';
import { MAILER, NoMailer, type Mailer } from './mailer.js';
import { NotificationsController } from './notifications.controller.js';
import { OUTBOX_OPTIONS, OutboxDispatcher, type OutboxOptions } from './outbox.dispatcher.js';

/** The outbox dispatcher and the notification inbox. */
@Module({})
export class OutboxModule {
  static register(options: OutboxOptions, mailer?: Mailer): DynamicModule {
    return {
      module: OutboxModule,
      controllers: [NotificationsController],
      providers: [
        OutboxDispatcher,
        { provide: OUTBOX_OPTIONS, useValue: options },
        { provide: MAILER, useValue: mailer ?? new NoMailer() },
      ],
      exports: [OutboxDispatcher],
    };
  }
}
