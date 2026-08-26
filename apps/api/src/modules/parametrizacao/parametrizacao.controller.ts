import { Controller, Get, Post, Patch, Delete, Query, Body, Param, ParseIntPipe } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  CreateParametrizacaoSchema, CreateParametrizacaoDto,
  UpdateParametrizacaoSchema, UpdateParametrizacaoDto,
} from "@cap/types";
import { ParametrizacaoService } from "./parametrizacao.service";

@Controller("parametrizacao")
@Roles("admin", "receptionist", "doctor", "nurse", "lab_tech")
export class ParametrizacaoController {
  constructor(private readonly service: ParametrizacaoService) {}

  @Get()
  listGroups() {
    return this.service.listGroups();
  }

  @Get(":nome")
  listByNome(
    @Param("nome") nome: string,
    @Query("includeInactive") includeInactive?: string,
  ) {
    return includeInactive === "true"
      ? this.service.listAdmin(nome)
      : this.service.listByNome(nome);
  }

  @Post()
  @Roles("admin")
  create(@Body(new ZodValidationPipe(CreateParametrizacaoSchema)) dto: CreateParametrizacaoDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Roles("admin")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(UpdateParametrizacaoSchema)) dto: UpdateParametrizacaoDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.softDelete(id);
  }
}
