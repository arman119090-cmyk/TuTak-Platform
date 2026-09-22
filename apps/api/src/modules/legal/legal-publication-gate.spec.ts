import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { AppConfig } from '../../config/configuration';
import { LegalDocumentsService } from './legal-documents.service';

/**
 * The gate, against the package that is actually in the repository.
 *
 * This is check 7 of the implementation brief — "никакие документы с
 * `{{...}}`, меткой проекта, неутверждённым переводом или незаполненным
 * реестром не проходят публикационный gate" — and it is deliberately written
 * against the real texts rather than a fixture: the thing worth proving is
 * that *these* documents, as shipped today, cannot reach a customer.
 *
 * It will fail the day someone fills the placeholders and removes the draft
 * marker without also approving the revision, which is the intended alarm.
 */
describe('legal publication gate (real package)', () => {
  const build = (env: Partial<AppConfig['legalDocuments']> = {}) => {
    const config = {
      get: () => ({
        contentDir: null,
        approvedRevision: null,
        previewEnabled: false,
        consentRequired: true,
        ...env,
      }),
    } as unknown as ConfigService<AppConfig, true>;
    return new LegalDocumentsService(config);
  };

  it('refuses to publish the 2026-09-22 package: placeholders, draft markers, no approval', () => {
    const state = build().publicationState();

    expect(state.publishable).toBe(false);
    expect(state.revision).toBe('0.9-draft-2026-09-22');

    const placeholders = state.blockers.filter((blocker) => blocker.startsWith('placeholder:'));
    const draftMarkers = state.blockers.filter((blocker) => blocker.startsWith('draft-marker:'));

    // Every one of the five documents, in both languages, still carries the
    // author's "Проект для согласования" line.
    expect(draftMarkers).toHaveLength(10);
    // And the operator's own registration details are still unfilled.
    expect(placeholders.length).toBeGreaterThan(20);
    expect(state.blockers).toContain('manifest-not-approved-by-owner');
    expect(state.blockers).toContain('effective-date-missing');
    expect(state.blockers).toContain('approved-revision-not-configured');
  });

  it('names the missing field, not just "not ready"', () => {
    const blockers = build().publicationState().blockers;
    expect(blockers).toContain('placeholder:terms:ru:OPERATOR_LEGAL_NAME');
    expect(blockers).toContain('placeholder:privacy:ru:RETENTION_SCHEDULE_URL');
  });

  it('serves nothing while the gate is closed, and marks a draft as a draft in preview', () => {
    expect(build().isVisible()).toBe(false);

    const preview = build({ previewEnabled: true });
    expect(preview.isVisible()).toBe(true);
    expect(preview.isPublished()).toBe(false);
    expect(preview.getCurrent('terms', 'ru')?.isDraft).toBe(true);
  });

  it('cannot be talked into enforcing consent to a text it may not publish', () => {
    // Even with the deployment demanding consent and preview on, an
    // unpublishable package enforces nothing: a consent to a draft is not
    // consent to anything.
    expect(build({ consentRequired: true, previewEnabled: true }).consentEnforced()).toBe(false);
  });

  it('is not approved by naming some other revision', () => {
    const state = build({ approvedRevision: '1.0-whatever' }).publicationState();
    expect(state.publishable).toBe(false);
    expect(state.blockers).toContain('approved-revision-mismatch:1.0-whatever');
  });

  it('publishes the fixture package, which has no placeholders and is approved', () => {
    const service = build({
      contentDir: join(__dirname, '..', '..', '..', 'test', 'fixtures', 'legal'),
      approvedRevision: '1.0-test-2026-09-22',
    });
    const state = service.publicationState();

    expect(state.blockers).toEqual([]);
    expect(state.publishable).toBe(true);
    expect(service.consentEnforced()).toBe(true);
    expect(service.getCurrent('terms', 'ru')?.isDraft).toBe(false);
    expect(service.getCurrent('terms', 'ru')?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
