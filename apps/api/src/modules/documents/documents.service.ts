import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";
import { DocumentsRepository } from "./documents.repository";
import { R2Service } from "../../common/services/r2.service";

const TOKEN_TTL_SECONDS = 3600;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB, matching M5's original design cap

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class DocumentsService {
  private readonly signingKey: string;

  constructor(
    private readonly repo: DocumentsRepository,
    private readonly r2: R2Service,
  ) {
    this.signingKey = process.env.FIELD_ENCRYPTION_KEY ?? randomBytes(32).toString("hex");
  }

  async findById(id: string) {
    const doc = await this.repo.findById(id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  listByPatient(patientId: string) {
    return this.repo.findByPatient(patientId);
  }

  async upload(patientId: string, type: string, file: UploadedFile, uploadedBy: string) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException("O ficheiro excede o tamanho máximo de 20MB");
    }
    const key = `patient-documents/${patientId}/${Date.now()}-${file.originalname}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return this.repo.create({
      patientId,
      type,
      fileName: file.originalname,
      r2Key: key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy,
    });
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
