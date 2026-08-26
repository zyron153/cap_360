import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateParametrizacaoDto, UpdateParametrizacaoDto } from "@cap/types";

@Injectable()
export class ParametrizacaoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listGroups() {
    const rows = await this.prisma.parametrizacao.groupBy({
      by: ["nome"],
      where: { deletedAt: null },
      _count: { id: true },
      orderBy: { nome: "asc" },
    });
    return rows.map(r => ({ nome: r.nome, count: r._count.id }));
  }

  listByNome(nome: string) {
    return this.prisma.parametrizacao.findMany({
      where: { nome, ativo: true, deletedAt: null },
      orderBy: [{ ordem: "asc" }, { valor: "asc" }],
    });
  }

  listByNomeAdmin(nome: string) {
    return this.prisma.parametrizacao.findMany({
      where: { nome, deletedAt: null },
      orderBy: [{ ordem: "asc" }, { valor: "asc" }],
    });
  }

  async create(dto: CreateParametrizacaoDto) {
    const agg = await this.prisma.parametrizacao.aggregate({
      where: { nome: dto.nome, deletedAt: null },
      _max: { ordem: true },
    });
    const ordem = dto.ordem ?? (agg._max.ordem ?? -10) + 10;
    return this.prisma.parametrizacao.create({
      data: {
        nome: dto.nome,
        valor: dto.valor,
        codigo: dto.codigo ?? null,
        descricao: dto.descricao ?? null,
        ordem,
        ativo: dto.ativo ?? true,
      },
    });
  }

  update(id: number, dto: UpdateParametrizacaoDto) {
    return this.prisma.parametrizacao.update({
      where: { id },
      data: {
        ...(dto.valor     !== undefined && { valor: dto.valor }),
        ...(dto.codigo    !== undefined && { codigo: dto.codigo }),
        ...(dto.descricao !== undefined && { descricao: dto.descricao }),
        ...(dto.ordem     !== undefined && { ordem: dto.ordem }),
        ...(dto.ativo     !== undefined && { ativo: dto.ativo }),
      },
    });
  }

  softDelete(id: number) {
    return this.prisma.parametrizacao.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  findById(id: number) {
    return this.prisma.parametrizacao.findFirst({ where: { id, deletedAt: null } });
  }
}
