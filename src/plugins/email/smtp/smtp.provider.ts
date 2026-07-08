import { randomUUID } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailDeliveryProvider, OutboundMail, SendResult } from '../core/email-delivery-provider';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * nodemailer-based provider — send only, NO delivery tracking (no fetchDeliveryStatus). With SMTP we
 * cannot prove access, so objection deadlines then start exclusively via portal-popup access
 * (POST /customers/:id/notifications), never via e-mail. `providerRef` is a locally generated id used
 * purely to correlate the send record (SMTP message ids are not reliably queryable).
 */
export class SmtpEmailProvider implements EmailDeliveryProvider {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    const providerRef = `smtp-${randomUUID()}`;
    await this.transporter.sendMail({
      from: this.config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.contentBase64, 'base64'),
        contentType: attachment.contentType,
      })),
    });
    return { providerRef };
  }
}
