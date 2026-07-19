import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSignedUrl: vi.fn().mockResolvedValue("https://signed.example/object?temporary=true") }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = vi.fn(); },
  GetObjectCommand: class { constructor(readonly input: unknown) {} },
  HeadObjectCommand: class { constructor(readonly input: unknown) {} },
  PutObjectCommand: class { constructor(readonly input: unknown) {} },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
}));
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class { done = vi.fn(); } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  mocks.getSignedUrl.mockClear();
});

describe("private R2 media access", () => {
  it("creates short-lived signed read access without exposing storage configuration", async () => {
    process.env.MEDIA_STORAGE = "r2";
    process.env.R2_BUCKET = "whatsimages";
    process.env.R2_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    process.env.R2_REGION = "auto";
    process.env.R2_ACCESS_KEY_ID = "test-access";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";
    const { signedMediaReadUrl } = await import("../lib/media-storage");
    await expect(signedMediaReadUrl("accounts/account/messages/message/object")).resolves.toBe("https://signed.example/object?temporary=true");
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 60 });
  });
});
