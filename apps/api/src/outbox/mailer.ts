import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Sends one email. Throws when it could not be sent, so the caller can record the failure. */
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

export const MAILER = 'JOBPILOT_MAILER';

/** Used when no mail server is configured: nothing is sent and the notification says so ("SKIPPED"). */
export class NoMailer implements Mailer {
  readonly configured = false;
  async send(): Promise<void> {
    throw new Error('No mail server is configured (set SMTP_URL)');
  }
}

/** Real delivery through any SMTP server. `url` is smtp:// or smtps:// with credentials, e.g. smtps://user:pass@host:465. */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
