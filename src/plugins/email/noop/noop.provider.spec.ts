import { NoopEmailProvider } from './noop.provider';

describe('NoopEmailProvider', () => {
  it('returns a unique fake providerRef and does not send', async () => {
    const provider = new NoopEmailProvider();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const a = await provider.send({ to: 'a@customer.example', subject: 's', text: 't' });
    const b = await provider.send({ to: 'b@customer.example', subject: 's', text: 't' });

    expect(a.providerRef).toMatch(/^noop-/);
    expect(b.providerRef).not.toBe(a.providerRef);
    warn.mockRestore();
  });

  it('offers no delivery tracking (no fetchDeliveryStatus)', () => {
    const provider = new NoopEmailProvider();
    expect((provider as { fetchDeliveryStatus?: unknown }).fetchDeliveryStatus).toBeUndefined();
  });
});
