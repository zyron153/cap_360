import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PatientsRepository } from "./patients.repository";
import { RequestContext } from "../../common/context/request-context";
import {
  CreatePatientDto,
  UpdatePatientDto,
  CreatePatientNoteDto,
  PatientSearchQuery,
  TimelineEvent,
} from "@cap/types";

@Injectable()
export class PatientsService {
  constructor(private readonly repo: PatientsRepository) {}

  async findAll(query: PatientSearchQuery) {
    const { q, planFilter, page, limit } = query;
    const skip = (page - 1) * limit;

    const where = {
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q } },
              // nif is encrypted (non-deterministic ciphertext) — only an exact match on its
              // blind-index hash can find it, not a substring `contains`
              { nifHash: this.repo.nifSearchHash(q) },
              { email: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(planFilter === "plan"
        ? { healthPlanId: { not: null } }
        : planFilter === "none"
        ? { healthPlanId: null }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.repo.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fullName: "asc" },
        select: {
          id: true,
          fullName: true,
          dateOfBirth: true,
          gender: true,
          phone: true,
          email: true,
          consentGiven: true,
          healthPlanId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.repo.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const patient = await this.repo.findById(id);
    if (!patient) throw new NotFoundException(`Patient ${id} not found`);
    return patient;
  }

  async create(dto: CreatePatientDto) {
    const normalizedPhone = this.normalizePhone(dto.phone);

    const [existing, existingNif] = await Promise.all([
      this.repo.findByPhone(normalizedPhone),
      dto.nif ? this.repo.findByNif(dto.nif) : null,
    ]);

    if (existing) {
      throw new ConflictException(
        `A patient with phone ${normalizedPhone} already exists`
      );
    }
    if (existingNif) {
      throw new ConflictException(
        `A patient with NIF ${dto.nif} already exists`
      );
    }

    return this.repo.create({
      ...dto,
      phone: normalizedPhone,
      dateOfBirth: new Date(dto.dateOfBirth),
      consentGivenAt: dto.consentGiven ? new Date() : null,
    });
  }

  async update(id: string, dto: UpdatePatientDto) {
    const existing = await this.findById(id);

    const data: Record<string, unknown> = { ...dto };
    if (dto.phone) data.phone = this.normalizePhone(dto.phone);
    if (dto.dateOfBirth) data.dateOfBirth = new Date(dto.dateOfBirth);

    const updated = await this.repo.update(id, data);

    // Only the fields actually submitted in this update — not the whole record — so the diff
    // reads as "what changed" rather than a noisy full dump of an unrelated record.
    const changedKeys = Object.keys(dto) as (keyof typeof existing)[];
    const before = Object.fromEntries(changedKeys.map((k) => [k, existing[k]]));
    const after = Object.fromEntries(changedKeys.map((k) => [k, (updated as Record<string, unknown>)[k]]));
    RequestContext.setAuditDiff(before, after);

    return updated;
  }

  async softDelete(id: string) {
    const existing = await this.findById(id);
    const deleted = await this.repo.softDelete(id);
    RequestContext.setAuditDiff({ deletedAt: existing.deletedAt }, { deletedAt: deleted.deletedAt });
    return deleted;
  }

  async addNote(patientId: string, dto: CreatePatientNoteDto, staffId: string) {
    await this.findById(patientId);
    return this.repo.createNote({
      content: dto.content,
      patient: { connect: { id: patientId } },
      staffAuthor: { connect: { id: staffId } },
    });
  }

  async getTimeline(patientId: string): Promise<TimelineEvent[]> {
    await this.findById(patientId);
    const [appointments, comms, invoices] =
      await this.repo.findTimelineEvents(patientId);

    const events: TimelineEvent[] = [
      ...appointments.map((a) => ({
        id: a.id,
        type: "appointment" as const,
        title: a.service.name,
        description: `${a.staff.fullName} — ${a.status}`,
        date: a.scheduledAt.toISOString(),
        metadata: { status: a.status },
      })),
      ...comms.map((c) => ({
        id: c.id,
        type: "communication" as const,
        title: c.subject ?? `${c.channel} ${c.direction}`,
        date: c.createdAt.toISOString(),
        metadata: { channel: c.channel, direction: c.direction },
      })),
      ...invoices.map((i) => ({
        id: i.id,
        type: "invoice" as const,
        title: `Fatura ${i.invoiceNumber}`,
        description: `${Number(i.total).toFixed(2)} CVE — ${i.status}`,
        date: (i.issuedAt ?? i.createdAt).toISOString(),
        metadata: { status: i.status, total: i.total },
      })),
    ];

    return events.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  async findOrCreateByPhone(dto: {
    fullName: string;
    phone: string;
    dateOfBirth: string;
    email?: string;
    gender: "male" | "female" | "other";
  }) {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const existing = await this.repo.findByPhone(normalizedPhone);
    if (existing) return existing;
    return this.create({
      fullName: dto.fullName,
      phone: dto.phone,
      dateOfBirth: dto.dateOfBirth,
      email: dto.email,
      gender: dto.gender,
      consentGiven: true,
    });
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    return `+${digits}`;
  }
}
