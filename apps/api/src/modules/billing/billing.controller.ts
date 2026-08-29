import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { BillingService } from "./billing.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import {
  CreateInvoiceSchema,
  RecordPaymentSchema,
  InvoiceListQuerySchema,
  CreateInvoiceDto,
  RecordPaymentDto,
  InvoiceListQuery,
} from "@cap/types";

@Controller("invoices")
@Roles("admin", "receptionist")
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  findAll(
    @Query(new ZodValidationPipe(InvoiceListQuerySchema)) query: InvoiceListQuery
  ) {
    return this.service.findAll(query);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Get(":id/receipt")
  getReceipt(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getReceiptUrl(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateInvoiceSchema)) dto: CreateInvoiceDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.create(dto, user.realm_access.roles);
  }

  @Post(":id/payments")
  recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RecordPaymentSchema)) dto: RecordPaymentDto
  ) {
    return this.service.recordPayment(id, dto);
  }

  @Get(":id/efatura")
  getEFaturaStatus(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getEFaturaStatus(id);
  }

  @Post(":id/efatura/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  retryEFatura(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.retryEFatura(id);
  }
}
