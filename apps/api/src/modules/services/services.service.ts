import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { ServicesRepository } from "./services.repository";
import { CreateServiceDto, UpdateServiceDto } from "@cms/types";

@Injectable()
export class ServicesService {
  constructor(private readonly repo: ServicesRepository) {}

  findAll() {
    return this.repo.findAll();
  }

  async findById(id: string) {
    const service = await this.repo.findById(id);
    if (!service) throw new NotFoundException(`Service ${id} not found`);
    return service;
  }

  findAllAdmin() {
    return this.repo.findAllAdmin();
  }

  async create(dto: CreateServiceDto) {
    const existing = await this.repo.findByCode(dto.code);
    if (existing) throw new ConflictException(`Service with code ${dto.code} already exists`);
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateServiceDto) {
    const existing = await this.repo.findByIdAdmin(id);
    if (!existing) throw new NotFoundException(`Service ${id} not found`);
    if (dto.code && dto.code !== existing.code) {
      const dup = await this.repo.findByCode(dto.code);
      if (dup) throw new ConflictException(`Service with code ${dto.code} already exists`);
    }
    return this.repo.update(id, dto);
  }

  async softDelete(id: string) {
    const existing = await this.repo.findByIdAdmin(id);
    if (!existing) throw new NotFoundException(`Service ${id} not found`);
    return this.repo.update(id, { active: false });
  }
}
