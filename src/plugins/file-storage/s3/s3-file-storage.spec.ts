import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { S3FileStorage } from './s3-file-storage';

const BUCKET = 'clickwrap-documents';
const REGION = 'eu-central-1';
const CREDENTIALS = { accessKeyId: 'AKIA_TEST', secretAccessKey: 'secret-test' };

/**
 * Minimal stand-in for an S3 GetObject stream body: `retrieve` only calls
 * `transformToByteArray()`, so a stub returning the bytes exercises the exact code path offline.
 */
const streamBody = (buffer: Buffer): GetObjectCommandOutput['Body'] =>
  ({ transformToByteArray: async () => new Uint8Array(buffer) }) as unknown as GetObjectCommandOutput['Body'];

describe('S3FileStorage', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('store issues PutObject with the generated key + contentType and returns the key', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS, keyPrefix: 'docs' });

    const content = Buffer.from('%PDF-1.7 store');
    const { storageKey } = await storage.store(content, { fileName: 'a.pdf', contentType: 'application/pdf' });

    expect(storageKey).toMatch(/^docs\/[0-9a-f-]{36}$/);
    expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: BUCKET,
      Key: storageKey,
      Body: content,
      ContentType: 'application/pdf',
    });
  });

  it('store without a keyPrefix uses a bare uuid key', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS });

    const { storageKey } = await storage.store(Buffer.from('x'), { fileName: 'a.pdf' });

    expect(storageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retrieve returns the object bytes as a Buffer (roundtrip)', async () => {
    const content = Buffer.from('%PDF-1.7 roundtrip  ÿ', 'binary');
    s3Mock.on(GetObjectCommand).resolves({ Body: streamBody(content) });
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS });

    const retrieved = await storage.retrieve('docs/some-key');

    expect(Buffer.isBuffer(retrieved)).toBe(true);
    expect(retrieved.equals(content)).toBe(true);
    expect(s3Mock).toHaveReceivedCommandWith(GetObjectCommand, { Bucket: BUCKET, Key: 'docs/some-key' });
  });

  it('getPresignedUrl returns a 15-minute URL targeting the bucket + key', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS });

    const url = new URL(await storage.getPresignedUrl('docs/the-key'));

    expect(url.href).toContain(BUCKET);
    expect(url.pathname).toContain('docs/the-key');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(s3Mock).toHaveReceivedCommandWith(HeadObjectCommand, { Bucket: BUCKET, Key: 'docs/the-key' });
  });

  it('retrieve rejects unknown keys (NoSuchKey) with a clear DomainError', async () => {
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS });

    await expect(storage.retrieve('docs/missing')).rejects.toThrow(/No PDF/);
  });

  it('getPresignedUrl rejects unknown keys (404 HeadObject) with a clear DomainError', async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects(Object.assign(new Error('not found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
    const storage = new S3FileStorage({ bucket: BUCKET, region: REGION, ...CREDENTIALS });

    await expect(storage.getPresignedUrl('docs/missing')).rejects.toThrow(/No PDF/);
  });

  it('uses path-style addressing when an endpoint is set (S3-compatible like MinIO)', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const storage = new S3FileStorage({
      bucket: BUCKET,
      region: REGION,
      endpoint: 'http://localhost:9000',
      ...CREDENTIALS,
    });

    const url = new URL(await storage.getPresignedUrl('docs/the-key'));

    // Path-style: the bucket is the first path segment (not a virtual-host subdomain).
    expect(url.host).toBe('localhost:9000');
    expect(url.pathname).toBe(`/${BUCKET}/docs/the-key`);
  });
});
