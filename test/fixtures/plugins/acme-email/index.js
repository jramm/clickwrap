/**
 * Fixture third-party e-mail provider. Deliberately plain CommonJS without the SDK package:
 * the host validates the default export structurally, so a published plugin only needs to match
 * the definePlugin shape ({ kind, key, create }).
 */
module.exports.default = {
  kind: 'email-provider',
  key: 'acme',
  create(ctx) {
    const apiToken = ctx.env('ACME_API_TOKEN', 'unset');
    ctx.logger.log(`acme provider ready (token ${apiToken === 'unset' ? 'missing' : 'configured'})`);
    let sequence = 0;
    return {
      async send(mail) {
        sequence += 1;
        return { providerRef: `acme-${sequence}-${mail.to}` };
      },
    };
  },
};
