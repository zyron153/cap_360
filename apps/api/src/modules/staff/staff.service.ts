import { Injectable, NotFoundException } from "@nestjs/common";
import { CreateStaffDto, UpdateStaffDto } from "@cms/types";
import { StaffRepository } from "./staff.repository";

@Injectable()
export class StaffService {
  constructor(private readonly repo: StaffRepository) {}

  findAll() {
    return this.repo.findAll();
  }

  async findById(id: string) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  create(dto: CreateStaffDto) {
    return this.repo.create(dto);
  }

  async findMe(keycloakId: string) {
    const staff = await this.repo.findByKeycloakId(keycloakId);
    // Fallback for dev hardcoded sub that has no real staff record
    return staff ?? { id: null, fullName: "Dev Admin", email: "admin@dev", role: "admin", jobTitle: null, specialtyCode: null, phone: null, availability: [] };
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.repo.findById(id);
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return this.repo.update(id, dto);
  }
}
