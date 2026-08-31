import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { DocumentsService } from "./documents.service";
import { Roles } from "../../common/decorators/roles.decorator";

@Controller("documents")
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // Staff-only auth — there is no patient-facing login, so the old "patient can only download
  // their own document" branch was unreachable code and has been removed along with it.
  @Get(":id/download-url")
  @Roles("admin", "doctor", "nurse", "receptionist", "lab_tech")
  async getDownloadUrl(@Param("id", ParseUUIDPipe) id: string) {
    const doc = await this.service.findById(id);
    return this.service.generateDownloadUrl(doc);
  }
}
