import { Controller, Get, Post, Patch, Body, Param, ParseUUIDPipe, Req } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { Roles } from "../../common/decorators/roles.decorator";
import { CreateStaffSchema, CreateStaffDto, UpdateStaffSchema, UpdateStaffDto } from "@cms/types";

@Controller("staff")
@Roles("admin", "receptionist", "doctor", "nurse")
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get("me")
  findMe(@Req() req: { user: { sub: string } }) {
    return this.service.findMe(req.user.sub);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(CreateStaffSchema)) dto: CreateStaffDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateStaffSchema)) dto: UpdateStaffDto,
  ) {
    return this.service.update(id, dto);
  }
}
