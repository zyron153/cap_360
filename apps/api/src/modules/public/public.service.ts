import { Injectable } from "@nestjs/common";
import { AppointmentsService } from "../appointments/appointments.service";
import { PatientsService } from "../patients/patients.service";
import { ServicesService } from "../services/services.service";
import { StaffService } from "../staff/staff.service";
import { AvailabilityQuery, PublicBookingDto, ActivateInvitationDto } from "@cms/types";

@Injectable()
export class PublicService {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly appointmentsService: AppointmentsService,
    private readonly servicesService: ServicesService,
    private readonly staffService: StaffService,
  ) {}

  getServices() {
    return this.servicesService.findAll();
  }

  getInvitation(token: string) {
    return this.staffService.getPublicInvitation(token);
  }

  activateInvitation(token: string, dto: ActivateInvitationDto) {
    return this.staffService.activateInvitation(token, dto);
  }

  async getStaff() {
    const all = await this.staffService.findAll();
    return all.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      specialtyCode: s.specialtyCode,
      availability: s.availability,
    }));
  }

  getAvailability(query: AvailabilityQuery) {
    return this.appointmentsService.getAvailability(query);
  }

  async createBooking(dto: PublicBookingDto) {
    const patient = await this.patientsService.findOrCreateByPhone({
      fullName: dto.fullName,
      phone: dto.phone,
      dateOfBirth: dto.dateOfBirth,
      email: dto.email,
      gender: dto.gender,
    });

    const appointment = await this.appointmentsService.create({
      patientId: patient.id,
      staffId: dto.staffId,
      serviceId: dto.serviceId,
      scheduledAt: dto.scheduledAt,
      notes: dto.notes,
      source: "web",
    });

    return {
      bookingId: appointment.id,
      bookingReference: appointment.id.slice(0, 8).toUpperCase(),
      patientId: patient.id,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
    };
  }
}
