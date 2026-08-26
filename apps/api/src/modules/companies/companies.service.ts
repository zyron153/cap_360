import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { CompaniesRepository } from "./companies.repository";
import { CreateCompanyDto, UpdateCompanyDto } from "@cap/types";

@Injectable()
export class CompaniesService {
  constructor(private readonly repo: CompaniesRepository) {}

  findAll(activeOnly = true) {
    return this.repo.findAll(activeOnly);
  }

  async findById(id: string) {
    const company = await this.repo.findById(id);
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }

  async create(dto: CreateCompanyDto) {
    const existing = await this.repo.findByTaxId(dto.taxId);
    if (existing) throw new ConflictException(`Company with taxId ${dto.taxId} already exists`);
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.findById(id);
    return this.repo.update(id, dto);
  }

  async deactivate(id: string) {
    const found = await this.repo.exists(id);
    if (!found) throw new NotFoundException(`Company ${id} not found`);
    return this.repo.update(id, { active: false });
  }
}
