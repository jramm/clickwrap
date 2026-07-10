/**
 * Proves the hosted-page HTML comes from the ACTIVE acceptance-page plugin, not from a hard-wired
 * renderer: swapping in a fake AcceptancePageRenderer that returns sentinel strings makes the
 * controller return exactly those strings (200 for a resolved link, 404 for an unknown token).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AcceptancePageLang, AcceptancePageRenderer, AcceptancePageView } from '../plugin-sdk';
import { PLUGIN_DI_TOKENS } from '../plugin-sdk';
import { ACCEPT_PAGE_RATE_LIMITER, AcceptPageController } from './accept-page.controller';
import { AcceptPageService } from './accept-page.service';

const KNOWN_TOKEN = 'known-token';
const PAGE_SENTINEL = '<!doctype html><title>MG-UI SENTINEL PAGE</title>';
const NOT_FOUND_SENTINEL = '<!doctype html><title>MG-UI SENTINEL NOT FOUND</title>';

class FakeRenderer implements AcceptancePageRenderer {
  renderAcceptPage(view: AcceptancePageView, lang: AcceptancePageLang): string {
    return `${PAGE_SENTINEL}<!--${view.linkId}:${lang}-->`;
  }

  renderNotFoundPage(lang: AcceptancePageLang): string {
    return `${NOT_FOUND_SENTINEL}<!--${lang}-->`;
  }
}

const aView = (): AcceptancePageView => ({
  linkId: 'al-1',
  customerName: 'Acme GmbH',
  firstName: 'Jane',
  lastName: 'Doe',
  companyName: 'Acme GmbH',
  suggestedEmail: 'jane@acme.example',
  items: [],
});

describe('AcceptPageController — output comes from the active renderer plugin', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const fakePageService: Pick<AcceptPageService, 'loadPage'> = {
      loadPage: async (token: string) => (token === KNOWN_TOKEN ? aView() : undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AcceptPageController],
      providers: [
        { provide: AcceptPageService, useValue: fakePageService },
        { provide: ACCEPT_PAGE_RATE_LIMITER, useValue: { allow: () => true } },
        { provide: PLUGIN_DI_TOKENS.AcceptancePageRenderer, useValue: new FakeRenderer() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET renders the resolved link via the plugin renderer (200)', async () => {
    const res = await request(app.getHttpServer()).get(`/accept/${KNOWN_TOKEN}`).expect(200);
    expect(res.text).toContain('MG-UI SENTINEL PAGE');
    expect(res.text).toContain('al-1:en');
  });

  it('GET renders the not-found page via the plugin renderer (404)', async () => {
    const res = await request(app.getHttpServer()).get('/accept/unknown').expect(404);
    expect(res.text).toContain('MG-UI SENTINEL NOT FOUND');
  });
});
