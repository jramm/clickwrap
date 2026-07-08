module.exports.default = {
  kind: 'email-provider',
  key: 'noop',
  create: () => ({ send: async () => ({ providerRef: 'duplicate' }) }),
};
