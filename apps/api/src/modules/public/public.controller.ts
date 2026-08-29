import { Controller, Get, Post, Query, Body, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  AvailabilityQuery,
  AvailabilityQuerySchema,
  PublicBookingDto,
  PublicBookingSchema,
  ActivateInvitationDto,
  ActivateInvitationSchema,
} from "@cap/types";
import { PublicService } from "./public.service";

// SECURITY.md §5.1: public (unauthenticated) endpoints are limited to 60 req/min per IP —
// looser than the 300/min authenticated default, but never fully unthrottled. These were
// previously @SkipThrottle()'d, almost certainly to dodge local dev friction; that's not a
// tradeoff worth making on routes anyone on the internet can hit without logging in.
const PUBLIC_READ_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

@Public()
@Controller("public")
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Throttle(PUBLIC_READ_THROTTLE)
  @Get("services")
  getServices() {
    return this.svc.getServices();
  }

  @Throttle(PUBLIC_READ_THROTTLE)
  @Get("staff")
  getStaff() {
    return this.svc.getStaff();
  }

  @Throttle(PUBLIC_READ_THROTTLE)
  @Get("availability")
  getAvailability(
    @Query(new ZodValidationPipe(AvailabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    return this.svc.getAvailability(query);
  }

  // Stricter throttle: 10 booking attempts per hour per IP
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("bookings")
  createBooking(
    @Body(new ZodValidationPipe(PublicBookingSchema)) dto: PublicBookingDto,
  ) {
    return this.svc.createBooking(dto);
  }

  @Throttle(PUBLIC_READ_THROTTLE)
  @Get("invitations/:token")
  getInvitation(@Param("token") token: string) {
    return this.svc.getInvitation(token);
  }

  // Stricter throttle: 10 activation attempts per hour per IP — this sets a password
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post("invitations/:token/activate")
  activateInvitation(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(ActivateInvitationSchema)) dto: ActivateInvitationDto,
  ) {
    return this.svc.activateInvitation(token, dto);
  }
}
