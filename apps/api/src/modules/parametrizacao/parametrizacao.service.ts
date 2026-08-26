import { Injectable, NotFoundException } from "@nestjs/common";
import { CreateParametrizacaoDto, UpdateParametrizacaoDto } from "@cap/types";
import { ParametrizacaoRepository } from "./parametrizacao.repository";

@Injectable()
export class ParametrizacaoService {
  constructor(private readonly repo: ParametrizacaoRepository) {}

  listGroups()               { return this.repo.listGroups(); }
  listByNome(nome: string)   { return this.repo.listByNome(nome); }
  listAdmin(nome: string)    { return this.repo.listByNomeAdmin(nome); }
  create(dto: CreateParametrizacaoDto) { return this.repo.create(dto); }

  async update(id: number, dto: UpdateParametrizacaoDto) {
    if (!(await this.repo.findById(id))) throw new NotFoundException(`Parametrizacao ${id} not found`);
    return this.repo.update(id, dto);
  }

  async softDelete(id: number) {
    if (!(await this.repo.findById(id))) throw new NotFoundException(`Parametrizacao ${id} not found`);
    return this.repo.softDelete(id);
  }
}
