import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LegalConsentAction } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/types/request-user.type';
import { UpdateOptionalConsentDto } from './dto/legal-consent.dto';
import { LegalConsentService } from './legal-consent.service';
import { LegalDocumentsService } from './legal-documents.service';

/**
 * What this account was asked and what it answered, and the one place a
 * voluntary consent is turned on or off.
 *
 * Mandatory consents are not here on purpose: they are collected once, at
 * registration, against a named revision, and a later "accept" for them is
 * not a settings toggle but a re-consent flow that does not exist yet (and
 * must not be invented silently for accounts that registered before these
 * texts existed — package §2, "нельзя автоматически переписать старое
 * согласие текущей версией").
 */
@ApiTags('legal')
@ApiBearerAuth()
@Controller('legal/consents')
export class LegalConsentController {
  constructor(
    private readonly consents: LegalConsentService,
    private readonly documents: LegalDocumentsService,
  ) {}

  @Get('me')
  async mine(@CurrentUser() user: RequestUser) {
    const state = await this.consents.currentState(user.id);
    return {
      currentRevision: this.documents.revision,
      published: this.documents.isPublished(),
      consentEnforced: this.documents.consentEnforced(),
      requiredPurposes: this.consents.requiredPurposes(),
      consents: state,
    };
  }

  @Post()
  @HttpCode(200)
  async update(@CurrentUser() user: RequestUser, @Body() dto: UpdateOptionalConsentDto) {
    await this.consents.record({
      userId: user.id,
      purpose: dto.purpose,
      action: dto.action === 'ACCEPT' ? LegalConsentAction.ACCEPT : LegalConsentAction.REVOKE,
      language: dto.language ?? this.documents.languages()[0] ?? 'ru',
      context: 'settings',
      appVersion: dto.appVersion ?? null,
    });
    return { purpose: dto.purpose, action: dto.action, granted: dto.action === 'ACCEPT' };
  }
}
