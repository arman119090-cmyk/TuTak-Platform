import { Global, Module } from '@nestjs/common';
import { LegalConsentController } from './legal-consent.controller';
import { LegalConsentService } from './legal-consent.service';
import { LegalController } from './legal.controller';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './legal-documents.service';

/**
 * Global because registration has to ask the legal package what it requires,
 * and `AuthModule` should not have to import a documents module to be able to
 * refuse a registration that carries no consent.
 */
@Global()
@Module({
  controllers: [LegalController, LegalDocumentsController, LegalConsentController],
  providers: [LegalDocumentsService, LegalConsentService],
  exports: [LegalDocumentsService, LegalConsentService],
})
export class LegalModule {}
