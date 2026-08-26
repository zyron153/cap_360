import { Injectable } from "@nestjs/common";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PrismaService } from "../../prisma/prisma.service";

interface R2Config { accountId: string; accessKeyId: string; secretAccessKey: string; bucket?: string }

@Injectable()
export class R2Service {
  private s3: S3Client | null = null;
  private bucket = process.env.R2_BUCKET_NAME ?? "cap-files";

  constructor(private readonly prisma: PrismaService) {
    // env-var bootstrap: if all three vars are present and non-placeholder, init now
    const accountId = process.env.R2_ACCOUNT_ID ?? "";
    if (accountId && !accountId.startsWith("your-")) this.initFromEnv(accountId);
  }

  private initFromEnv(accountId: string) {
    this.s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });
  }

  private buildClient(cfg: R2Config): S3Client {
    if (cfg.bucket) this.bucket = cfg.bucket;
    return new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  // lazy: read DB config on first use if env bootstrap didn't fire
  private async client(): Promise<S3Client> {
    if (this.s3) return this.s3;

    const row = await this.prisma.setting.findUnique({ where: { key: "integration_cloudflare_r2" } });
    if (!row) throw new Error("R2 not configured");
    const cfg = row.value as unknown as R2Config;
    if (!cfg?.accountId) throw new Error("R2 not configured");

    this.s3 = this.buildClient(cfg);
    return this.s3;
  }

  isConfigured(): boolean {
    return !!this.s3;
  }

  // re-init when settings page saves new R2 config
  async reconfigure(cfg: R2Config) {
    this.s3 = this.buildClient(cfg);
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const s3 = await this.client();
    await s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async signedUrl(key: string, expiresIn = 3600): Promise<string> {
    const s3 = await this.client();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
  }
}
