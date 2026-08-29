import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { Prisma } from "@cap/database";

type MaybeNif = { nif?: string | null };

@Injectable()
export class PatientsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** nif is stored encrypted; nifHash is a deterministic blind index for exact-match lookups. */
  private nifFieldsFor(nif: string | null | undefined) {
    if (!nif) return { nif: nif ?? null, nifHash: null };
    return { nif: this.encryption.encrypt(nif), nifHash: this.encryption.blindIndex(nif) };
  }

  private decrypted<T extends MaybeNif>(patient: T): T {
    // nifHash is an internal lookup detail with no client-side use — never return it, since it's
    // brute-forceable in practice given how small the NIF keyspace is.
    const { nifHash: _nifHash, ...rest } = patient as MaybeNif & { nifHash?: unknown };
    if (!rest.nif) return rest as T;
    return { ...rest, nif: this.encryption.decrypt(rest.nif) } as T;
  }

  private decryptedList<T extends MaybeNif>(patients: T[]): T[] {
    return patients.map((p) => this.decrypted(p));
  }

  async findMany(args: Prisma.PatientFindManyArgs) {
    const rows = await this.prisma.patient.findMany(args);
    return this.decryptedList(rows as MaybeNif[]) as typeof rows;
  }

  count(args: Prisma.PatientCountArgs) {
    return this.prisma.patient.count(args);
  }

  async findById(id: string) {
    const patient = await this.prisma.patient.findFirst({ where: { id, deletedAt: null } });
    return patient && this.decrypted(patient);
  }

  findByPhone(phone: string) {
    return this.prisma.patient.findFirst({ where: { phone, deletedAt: null } });
  }

  async findByNif(nif: string) {
    const nifHash = this.encryption.blindIndex(nif);
    const patient = await this.prisma.patient.findFirst({ where: { nifHash, deletedAt: null } });
    return patient && this.decrypted(patient);
  }

  /** Blind-index hash for an exact-match NIF search predicate — see PatientsService.findAll. */
  nifSearchHash(nif: string) {
    return this.encryption.blindIndex(nif);
  }

  async create(data: Prisma.PatientCreateInput) {
    const { nif, ...rest } = data as Prisma.PatientCreateInput & MaybeNif;
    const patient = await this.prisma.patient.create({
      data: { ...rest, ...this.nifFieldsFor(nif) },
    });
    return this.decrypted(patient);
  }

  async update(id: string, data: Prisma.PatientUpdateInput) {
    const { nif, ...rest } = data as Prisma.PatientUpdateInput & MaybeNif;
    const patch = "nif" in data ? { ...rest, ...this.nifFieldsFor(nif as string | null | undefined) } : rest;
    const patient = await this.prisma.patient.update({ where: { id }, data: patch });
    return this.decrypted(patient);
  }

  softDelete(id: string) {
    return this.prisma.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  createNote(data: Prisma.PatientNoteCreateInput) {
    return this.prisma.patientNote.create({ data });
  }

  findNotesForPatient(patientId: string) {
    return this.prisma.patientNote.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    });
  }

  findTimelineEvents(patientId: string) {
    return Promise.all([
      this.prisma.appointment.findMany({
        where: { patientId, deletedAt: null },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          service: { select: { name: true } },
          staff: { select: { fullName: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take: 20,
      }),
      this.prisma.communicationLog.findMany({
        where: { patientId },
        select: {
          id: true,
          channel: true,
          direction: true,
          subject: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.invoice.findMany({
        where: { patientId },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          status: true,
          issuedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
  }
}
