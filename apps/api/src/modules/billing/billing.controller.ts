import {
  Controller,
  Get,
  Post,
  Patch,
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
  CancelInvoiceSchema,
  InvoiceListQuerySchema,
  UpdateInvoiceItemSchema,
  CreateInvoiceDto,
  RecordPaymentDto,
  CancelInvoiceDto,
  InvoiceListQuery,
  UpdateInvoiceItemDto,
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
    return this.service.create(dto, user.roles);
  }

  @Post(":id/payments")
  recordPayment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RecordPaymentSchema)) dto: RecordPaymentDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.recordPayment(id, dto, user.sub);
  }

  @Patch(":id/items/:itemId")
  updateItem(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(UpdateInvoiceItemSchema)) dto: UpdateInvoiceItemDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.updateItem(id, itemId, dto, user.roles);
  }

  @Post(":id/cancel")
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CancelInvoiceSchema)) dto: CancelInvoiceDto
  ) {
    return this.service.cancel(id, dto.reason);
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
