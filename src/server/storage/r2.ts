import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { BlobStorage, StoredObject } from "./index";
import { assertSafeKey } from "./keys";

/** Cloudflare R2 via its S3-compatible API. The bucket must stay PRIVATE (no public access, no r2.dev URL). */
export class R2Storage implements BlobStorage {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(opts: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    this.bucket = opts.bucket;
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    assertSafeKey(key);
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const type = assertSafeKey(key);
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return { body: await res.Body.transformToByteArray(), contentType: res.ContentType ?? type };
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
