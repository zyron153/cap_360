import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.patientDocument.findUnique({ where: { id } });
  }

  findByPatient(patientId: string) {
    return this.prisma.patientDocument.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    });
  }

  create(data: {
    patientId: string;
    type: string;
    fileName: string;
    r2Key: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
  }) {
    return this.prisma.patientDocument.create({
      // Prisma's generated DocumentType enum type doesn't structurally match the plain `string`
      // this repository method takes (kept loose so the caller doesn't need a @cap/database
      // import) — the value is already validated against the same enum by UploadPatientDocumentSchema.
      data: data as never,
    });
  }
}
