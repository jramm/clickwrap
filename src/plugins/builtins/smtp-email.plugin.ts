import { definePlugin } from '../../plugin-sdk/index.js';
import { SmtpEmailProvider } from '../email/smtp/smtp.provider.js';

const DEFAULT_SMTP_PORT = 587;

/**
 * SMTP e-mail provider (nodemailer) — send only, NO delivery tracking: objection deadlines then
 * start exclusively via portal-popup access.
 */
export const smtpEmailPlugin = definePlugin({
  kind: 'email-provider',
  key: 'smtp',
  create: (ctx) =>
    new SmtpEmailProvider({
      host: ctx.env('SMTP_HOST', 'localhost') as string,
      port: Number(ctx.env('SMTP_PORT') ?? DEFAULT_SMTP_PORT),
      secure: ctx.env('SMTP_SECURE') === 'true',
      user: ctx.env('SMTP_USER'),
      pass: ctx.env('SMTP_PASS'),
      from: ctx.requireEnv('EMAIL_FROM'),
    }),
});
