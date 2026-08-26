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
import { CompaniesService } from "./companies.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import {
  CreateCompanySchema,
  UpdateCompanySchema,
  CreateCompanyDto,
  UpdateCompanyDto,
} from "@cap/types";

@Controller("companies")
@Roles("admin", "corporate_hr")
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}

  @Get()
  findAll(@Query("activeOnly") activeOnly?: string) {
    return this.service.findAll(activeOnly !== "false");
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles("admin")
  create(
    @Body(new ZodValidationPipe(CreateCompanySchema)) dto: CreateCompanyDto
  ) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCompanySchema)) dto: UpdateCompanyDto
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.deactivate(id);
  }
}
