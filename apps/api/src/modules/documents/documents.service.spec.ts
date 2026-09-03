import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { DocumentsService } from "./documents.service";
import { DocumentsRepository } from "./documents.repository";
import { R2Service } from "../../common/services/r2.service";

const repo = {
  findById: jest.fn(),
  findByPatient: jest.fn(),
  create: jest.fn(),
};
const r2 = { upload: jest.fn(), signedUrl: jest.fn() };

const FILE = { buffer: Buffer.from("pdf-bytes"), mimetype: "application/pdf", originalname: "bi.pdf", size: 1024 };

describe("DocumentsService", () => {
  let service: DocumentsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DocumentsRepository, useValue: repo },
        { provide: R2Service, useValue: r2 },
      ],
    }).compile();
    service = mod.get(DocumentsService);
    jest.clearAllMocks();
  });

  describe("upload", () => {
    it("uploads the file to R2 and creates the PatientDocument row", async () => {
      repo.create.mockResolvedValue({ id: "doc-1" });
      await service.upload("p1", "national_id", FILE, "staff-1");

      expect(r2.upload).toHaveBeenCalledWith(expect.stringContaining("patient-documents/p1/"), FILE.buffer, "application/pdf");
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: "p1", type: "national_id", fileName: "bi.pdf",
          mimeType: "application/pdf", sizeBytes: 1024, uploadedBy: "staff-1",
        })
      );
    });

    it("rejects a file over the 20MB limit without touching R2", async () => {
      await expect(
        service.upload("p1", "national_id", { ...FILE, size: 21 * 1024 * 1024 }, "staff-1")
      ).rejects.toThrow(BadRequestException);
      expect(r2.upload).not.toHaveBeenCalled();
    });
  });

  describe("listByPatient", () => {
    it("delegates to the repository", async () => {
      repo.findByPatient.mockResolvedValue([{ id: "doc-1" }]);
      await expect(service.listByPatient("p1")).resolves.toEqual([{ id: "doc-1" }]);
      expect(repo.findByPatient).toHaveBeenCalledWith("p1");
    });
  });

  describe("findById", () => {
    it("throws NotFoundException for an unknown document", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findById("ghost")).rejects.toThrow(NotFoundException);
    });
  });
});
