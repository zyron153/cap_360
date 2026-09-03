import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentsRepository } from "./documents.repository";
import { R2Service } from "../../common/services/r2.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsRepository, R2Service],
  exports: [DocumentsService],
})
export class DocumentsModule {}
