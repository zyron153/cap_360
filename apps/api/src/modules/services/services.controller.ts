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
} from "@nestjs/common";
import { ServicesService } from "./services.service";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  CreateServiceSchema,
  CreateServiceDto,
  UpdateServiceSchema,
  UpdateServiceDto,
} from "@cms/types";

@Controller("services")
@Roles("admin", "receptionist", "doctor", "nurse")
export class ServicesController {
  constructor(private readonly service: ServicesService) {}

  @Get()
  findAll(@Query("includeInactive") includeInactive?: string) {
    return includeInactive === "true" ? this.service.findAllAdmin() : this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(CreateServiceSchema)) dto: CreateServiceDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateServiceSchema)) dto: UpdateServiceDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.softDelete(id);
  }
}
