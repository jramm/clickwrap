import { PostmarkWebhookController } from './postmark-webhook.controller.js';
import type { DeliveryEventService } from '../core/delivery-event.service.js';
import type { InboundDeliveryEvent } from '../core/inbound-delivery-event.js';

const fakeDeliveryEvents = (): jest.Mocked<Pick<DeliveryEventService, 'handle'>> => ({
  handle: jest.fn().mockResolvedValue(undefined),
});

describe('PostmarkWebhookController', () => {
  it('RecordType Delivery: translates into a DELIVERED event with the MessageID as providerRef', async () => {
    const deliveryEvents = fakeDeliveryEvents();
    const controller = new PostmarkWebhookController(deliveryEvents as unknown as DeliveryEventService);

    const result = await controller.handle({ RecordType: 'Delivery', MessageID: 'pm-msg-1', Recipient: 'max@customer.example' });

    expect(deliveryEvents.handle).toHaveBeenCalledWith<[InboundDeliveryEvent]>({
      kind: 'DELIVERED',
      providerRef: 'pm-msg-1',
      recipient: 'max@customer.example',
    });
    expect(result).toEqual({ ok: true });
  });

  it('RecordType Delivery without MessageID: does not call handle, still answers 200', async () => {
    const deliveryEvents = fakeDeliveryEvents();
    const controller = new PostmarkWebhookController(deliveryEvents as unknown as DeliveryEventService);

    const result = await controller.handle({ RecordType: 'Delivery' });

    expect(deliveryEvents.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('RecordType Bounce: translates into a BOUNCED event incl. the inactivated flag', async () => {
    const deliveryEvents = fakeDeliveryEvents();
    const controller = new PostmarkWebhookController(deliveryEvents as unknown as DeliveryEventService);

    const result = await controller.handle({
      RecordType: 'Bounce',
      MessageID: 'pm-msg-1',
      Email: 'max@customer.example',
      Inactive: true,
    });

    expect(deliveryEvents.handle).toHaveBeenCalledWith<[InboundDeliveryEvent]>({
      kind: 'BOUNCED',
      providerRef: 'pm-msg-1',
      recipient: 'max@customer.example',
      meta: { inactivatedRecipient: true },
    });
    expect(result).toEqual({ ok: true });
  });

  it('other RecordTypes (e.g. Open): no-op, answers 200', async () => {
    const deliveryEvents = fakeDeliveryEvents();
    const controller = new PostmarkWebhookController(deliveryEvents as unknown as DeliveryEventService);

    const result = await controller.handle({ RecordType: 'Open', MessageID: 'pm-msg-1' });

    expect(deliveryEvents.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });
});
