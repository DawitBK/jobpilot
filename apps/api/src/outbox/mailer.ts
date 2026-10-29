import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Development only: every message becomes a text file in a folder, so the whole recovery and notification flow can be
 * tried (and tested in a browser) on a machine that has no mail server. Never used in production: createApp refuses it.
 */
export class FileMailer implements Mailer {
  readonly configured = true;
  private counter = 0;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  async send(message: MailMessage): Promise<void> {
    this.counter += 1;
    const safe = message.to.replace(/[^a-z0-9@._-]/gi, '_');
    const name = `${Date.now()}-${String(this.counter).padStart(4, '0')}-${safe}.txt`;
    writeFileSync(
      join(this.dir, name),
      `To: ${message.to}
Subject: ${message.subject}

${message.text}
`,
      'utf8',
    );
  }
}
