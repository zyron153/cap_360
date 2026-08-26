import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from "@nestjs/common";
import { AppointmentsService } from "./appointments.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CreateAppointmentSchema,
  UpdateAppointmentStatusSchema,
  RescheduleAppointmentSchema,
  AvailabilityQuerySchema,
  AppointmentCalendarQuerySchema,
  JoinWaitlistSchema,
  CreateAppointmentDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
  AvailabilityQuery,
  AppointmentCalendarQuery,
  JoinWaitlistDto,
} from "@cap/types";

@Controller("appointments")
@Roles("admin", "receptionist", "doctor", "nurse")
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Get("availability")
  getAvailability(
    @Query(new ZodValidationPipe(AvailabilityQuerySchema)) query: AvailabilityQuery
  ) {
    return this.service.getAvailability(query);
  }

  @Get()
  findCalendar(
    @Query(new ZodValidationPipe(AppointmentCalendarQuerySchema))
    query: AppointmentCalendarQuery
  ) {
    return this.service.findCalendar(query);
  }

  @Get("waitlist")
  getWaitlist(@Query("serviceId") serviceId?: string) {
    return this.service.getWaitlist(serviceId);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateAppointmentSchema))
    dto: CreateAppointmentDto
  ) {
    return this.service.create(dto);
  }

  @Post("waitlist")
  joinWaitlist(
    @Body(new ZodValidationPipe(JoinWaitlistSchema)) dto: JoinWaitlistDto
  ) {
    return this.service.joinWaitlist(dto);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateAppointmentStatusSchema))
    dto: UpdateAppointmentStatusDto
  ) {
    return this.service.updateStatus(id, dto);
  }

  @Patch(":id/reschedule")
  reschedule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RescheduleAppointmentSchema))
    dto: RescheduleAppointmentDto
  ) {
    return this.service.reschedule(id, dto);
  }
}
