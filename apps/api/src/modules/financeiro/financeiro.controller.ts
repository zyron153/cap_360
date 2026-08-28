import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FinanceiroService } from "./financeiro.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  CreateExpenseSchema, CreateExpenseDto,
  UpdateExpenseSchema, UpdateExpenseDto,
  ExpenseDecisionSchema, ExpenseDecisionDto,
  CreateIncomeSchema, CreateIncomeDto,
  UpdateIncomeSchema, UpdateIncomeDto,
  FinanceiroListQuerySchema, FinanceiroListQuery,
} from "@cap/types";

interface UploadedReceipt {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Controller("financeiro")
@Roles("admin", "receptionist")
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  // ── Despesas ─────────────────────────────────────────────
  @Get("despesas")
  listExpenses(@Query(new ZodValidationPipe(FinanceiroListQuerySchema)) query: FinanceiroListQuery) {
    return this.service.listExpenses(query);
  }

  @Post("despesas")
  createExpense(
    @Body(new ZodValidationPipe(CreateExpenseSchema)) dto: CreateExpenseDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.createExpense(dto, user.sub);
  }

  @Patch("despesas/:id")
  updateExpense(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateExpenseSchema)) dto: UpdateExpenseDto,
  ) {
    return this.service.updateExpense(id, dto);
  }

  @Patch("despesas/:id/decision")
  @Roles("admin")
  decideExpense(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExpenseDecisionSchema)) dto: ExpenseDecisionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.decideExpense(id, dto, user.sub);
  }

  @Delete("despesas/:id")
  @Roles("admin")
  deleteExpense(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteExpense(id);
  }

  @Post("despesas/:id/receipt")
  @UseInterceptors(FileInterceptor("file"))
  uploadReceipt(@Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: UploadedReceipt) {
    return this.service.uploadReceipt(id, file);
  }

  @Get("despesas/:id/receipt-url")
  getReceiptUrl(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getReceiptUrl(id);
  }

  // ── Entradas ─────────────────────────────────────────────
  @Get("entradas")
  listIncome(@Query(new ZodValidationPipe(FinanceiroListQuerySchema)) query: FinanceiroListQuery) {
    return this.service.listIncome(query);
  }

  @Post("entradas")
  createIncome(@Body(new ZodValidationPipe(CreateIncomeSchema)) dto: CreateIncomeDto) {
    return this.service.createIncome(dto);
  }

  @Patch("entradas/:id")
  updateIncome(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIncomeSchema)) dto: UpdateIncomeDto,
  ) {
    return this.service.updateIncome(id, dto);
  }

  @Delete("entradas/:id")
  @Roles("admin")
  deleteIncome(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.deleteIncome(id);
  }

  // ── Resumo ───────────────────────────────────────────────
  @Get("summary")
  getSummary(@Query("from") from?: string, @Query("to") to?: string) {
    return this.service.getSummary(from, to);
  }
}
