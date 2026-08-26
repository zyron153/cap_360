import { Injectable, NotFoundException } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";
import { DocumentsRepository } from "./documents.repository";

const TOKEN_TTL_SECONDS = 3600;

@Injectable()
export class DocumentsService {
  private readonly signingKey: string;

  constructor(private readonly repo: DocumentsRepository) {
    this.signingKey = process.env.FIELD_ENCRYPTION_KEY ?? randomBytes(32).toString("hex");
  }

  async findById(id: string) {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  generateDownloadUrl(doc: { id: string; r2Key: string; fileName: string }) {
    const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = `${doc.id}:${doc.r2Key}:${expiresAt}`;
    const signature = createHmac("sha256", this.signingKey).update(payload).digest("hex");
    const token = Buffer.from(`${payload}:${signature}`).toString("base64url");

    // Phase 1: return a token-based URL; Phase 2 replaces with R2 presigned URL
    const baseUrl = process.env.R2_PUBLIC_URL ?? "https://files.cap.cv";
    return {
      url: `${baseUrl}/download/${token}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      fileName: doc.fileName,
    };
  }

  verifyDownloadToken(token: string): { documentId: string; r2Key: string } | null {
    try {
      const decoded = Buffer.from(token, "base64url").toString();
      const parts = decoded.split(":");
      if (parts.length !== 4) return null;

      const [id, r2Key, expiresAtStr, signature] = parts;
      const expiresAt = Number(expiresAtStr);
      if (Math.floor(Date.now() / 1000) > expiresAt) return null;

      const payload = `${id}:${r2Key}:${expiresAt}`;
      const expected = createHmac("sha256", this.signingKey).update(payload).digest("hex");
      if (expected !== signature) return null;

      return { documentId: id, r2Key };
    } catch {
      return null;
    }
  }
}
