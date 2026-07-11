import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadLegalEntitiesConfig,
  parseLegalEntitiesConfig,
} from './legal-entities.config.js';

const validConfig = {
  audiences: [{ key: 'customer', name: 'Customers' }],
  documentTypes: [
    {
      key: 'terms',
      name: 'Terms of Service',
      external: false,
      notificationTemplateId: null,
      reminderTemplateId: null,
      acceptanceConfirmationTemplateId: null,
    },
  ],
};

describe('parseLegalEntitiesConfig', () => {
  it('parses a valid config and defaults external to false, template ids to undefined', () => {
    const config = parseLegalEntitiesConfig(
      { audiences: [{ key: 'customer', name: 'Customers' }], documentTypes: [{ key: 'terms', name: 'Terms' }] },
      'test',
    );
    expect(config.audiences).toEqual([{ key: 'customer', name: 'Customers' }]);
    expect(config.documentTypes[0]).toMatchObject({ key: 'terms', name: 'Terms', external: false });
    expect(config.documentTypes[0].notificationTemplateId ?? undefined).toBeUndefined();
  });

  it('keeps explicit external and template ids', () => {
    const config = parseLegalEntitiesConfig(
      {
        audiences: [],
        documentTypes: [{ key: 'nda', name: 'NDA', external: true, notificationTemplateId: 'tpl-1' }],
      },
      'test',
    );
    expect(config.documentTypes[0]).toMatchObject({ external: true, notificationTemplateId: 'tpl-1' });
  });

  it('throws on a missing required field (name)', () => {
    expect(() => parseLegalEntitiesConfig({ audiences: [{ key: 'customer' }], documentTypes: [] }, 'test')).toThrow(
      /name/,
    );
  });

  it('throws on an invalid slug key', () => {
    expect(() =>
      parseLegalEntitiesConfig({ audiences: [{ key: 'Not A Slug', name: 'x' }], documentTypes: [] }, 'test'),
    ).toThrow(/slug/);
  });

  it('throws on a wrong type (documentTypes not an array)', () => {
    expect(() => parseLegalEntitiesConfig({ audiences: [], documentTypes: {} }, 'test')).toThrow(
      /Invalid legal-entities config/,
    );
  });

  it('throws on an unknown extra key (strict schema)', () => {
    expect(() =>
      parseLegalEntitiesConfig({ audiences: [], documentTypes: [], extra: true }, 'test'),
    ).toThrow(/Invalid legal-entities config/);
  });
});

describe('loadLegalEntitiesConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legal-entities-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and validates a config file', () => {
    const path = join(dir, 'legal-entities.json');
    writeFileSync(path, JSON.stringify(validConfig));
    const config = loadLegalEntitiesConfig(path);
    expect(config.audiences[0].key).toBe('customer');
    expect(config.documentTypes[0].key).toBe('terms');
  });

  it('throws a clear error when the file is missing', () => {
    expect(() => loadLegalEntitiesConfig(join(dir, 'nope.json'))).toThrow(/Cannot read legal-entities config/);
  });

  it('throws a clear error when the file is not valid JSON', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not json');
    expect(() => loadLegalEntitiesConfig(path)).toThrow(/not valid JSON/);
  });

  it('throws when the file content fails schema validation', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ audiences: [{ key: 'x' }], documentTypes: [] }));
    expect(() => loadLegalEntitiesConfig(path)).toThrow(/name/);
  });
});
