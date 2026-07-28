import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";

function mediaConfig() {
  const required = ["R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
  for (const key of required) if (!process.env[key]) throw new Error(`${key} es obligatorio.`);
  if (process.env.MEDIA_STORAGE !== "r2") throw new Error("MEDIA_STORAGE debe ser r2.");
  return {
    bucket: process.env.R2_BUCKET!,
    endpoint: process.env.R2_ENDPOINT!,
    region: process.env.R2_REGION || "auto",
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  };
}

let client: S3Client | undefined;
function r2() {
  if (!client) {
    const config = mediaConfig();
    client = new S3Client({ region: config.region, endpoint: config.endpoint, credentials: config.credentials });
  }
  return client;
}

export async function uploadMediaStream(objectKey: string, body: Readable, mimeType: string) {
  const config = mediaConfig();
  const upload = new Upload({ client: r2(), params: { Bucket: config.bucket, Key: objectKey, Body: body, ContentType: mimeType, CacheControl: "private, no-store" }, leavePartsOnError: false });
  await upload.done();
}

export async function mediaObjectExists(objectKey: string) {
  try {
    const config = mediaConfig();
    await r2().send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirms that the configured private bucket accepts an authenticated read
 * request without creating or listing any object. A missing sentinel object
 * is the expected successful outcome; credentials and endpoint are never
 * returned to callers or logs.
 */
export async function verifyMediaStorageAccess() {
  const config = mediaConfig();
  try {
    await r2().send(new HeadObjectCommand({ Bucket: config.bucket, Key: "__whatsappbusiness_healthcheck__/missing" }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: unknown } })?.$metadata?.httpStatusCode;
    if (status === 404) return true;
    throw error;
  }
}

export async function signedMediaReadUrl(objectKey: string) {
  const config = mediaConfig();
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: config.bucket, Key: objectKey, ResponseCacheControl: "private, no-store" }), { expiresIn: 60 });
}

export async function deleteMediaObject(objectKey: string) {
  const config = mediaConfig();
  await r2().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
}
