import { NoopEmailProvider } from './noop.provider.js';

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

  it('logs each attachment with its filename and decoded byte size', async () => {
    const provider = new NoopEmailProvider();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const content = Buffer.from('%PDF-1.7 hello');
    await provider.send({
      to: 'a@customer.example',
      subject: 's',
      text: 't',
      attachments: [{ filename: 'dpa.pdf', contentBase64: content.toString('base64'), contentType: 'application/pdf' }],
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`"dpa.pdf" (${content.length} bytes)`));
    warn.mockRestore();
  });

  it('offers no delivery tracking (no fetchDeliveryStatus)', () => {
    const provider = new NoopEmailProvider();
    expect((provider as { fetchDeliveryStatus?: unknown }).fetchDeliveryStatus).toBeUndefined();
  });
});
