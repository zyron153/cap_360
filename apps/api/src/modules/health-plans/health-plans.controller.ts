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
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { HealthPlansService } from "./health-plans.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CreateHealthPlanProductSchema,
  UpdateHealthPlanProductSchema,
  CreateHealthPlanSchema,
  CreateHealthPlanProductDto,
  UpdateHealthPlanProductDto,
  CreateHealthPlanDto,
} from "@cap/types";

@Controller("health-plans")
@Roles("admin", "receptionist", "corporate_hr")
export class HealthPlansController {
  constructor(private readonly service: HealthPlansService) {}

  // ─── Products ──────────────────────────────────────────────────────────────

  @Get("products")
  @Roles("admin", "receptionist", "doctor", "corporate_hr")
  findAllProducts(@Query("activeOnly") activeOnly?: string) {
    return this.service.findAllProducts(activeOnly !== "false");
  }

  @Get("products/:id")
  @Roles("admin", "receptionist", "doctor", "corporate_hr")
  findProduct(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findProductById(id);
  }

  @Post("products")
  @Roles("admin")
  createProduct(
    @Body(new ZodValidationPipe(CreateHealthPlanProductSchema))
    dto: CreateHealthPlanProductDto
  ) {
    return this.service.createProduct(dto);
  }

  @Patch("products/:id")
  @Roles("admin")
  updateProduct(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateHealthPlanProductSchema))
    dto: UpdateHealthPlanProductDto
  ) {
    return this.service.updateProduct(id, dto);
  }

  @Delete("products/:id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivateProduct(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.deactivateProduct(id);
  }

  // ─── Plans ─────────────────────────────────────────────────────────────────

  @Get()
  @Roles("admin", "receptionist", "corporate_hr")
  findAllPlans(@Query("companyId") companyId?: string) {
    return this.service.findAllPlans(companyId);
  }

  @Get(":id")
  @Roles("admin", "receptionist", "corporate_hr")
  findPlan(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findPlanById(id);
  }

  @Post()
  @Roles("admin", "receptionist")
  createPlan(
    @Body(new ZodValidationPipe(CreateHealthPlanSchema))
    dto: CreateHealthPlanDto
  ) {
    return this.service.createPlan(dto);
  }
}
