'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import type {
  CreatePartnerPromoRequestDto,
  PartnerPromoAdminDto,
  PartnerPromoDestination,
  PartnerPromoLocale,
  PartnerPromoTranslationsDto,
} from '@tutak/shared-types';
import { partnersApi } from '@/lib/api/partnersApi';
import { promosApi } from '@/lib/api/promosApi';
import { LoadFailed } from '@/components/LoadFailed';

/**
 * Home "Partner Spotlight" — the curated strip of partner offers on every
 * customer's Home screen.
 *
 * ## What this page is for
 *
 * Writing the cards. A card is a partner, its words in up to three
 * languages, a photograph and a window. The app shows whatever is live, in
 * its own interface language, in priority order, at most five; when nothing
 * is live the strip is absent. There is no partner-side entry to this: a
 * business cannot put itself on every Home screen, an administrator puts it
 * there.
 *
 * ## Languages
 *
 * A card needs at least one complete language (title + benefit). The app
 * asks in the customer's language and the API falls back requested → RU →
 * first filled, so a card with only Russian *does* show on an Armenian
 * phone — in Russian. The form says which languages are filled, so that is
 * a decision an administrator makes knowingly, not by accident.
 *
 * ## Why every row says whether it is live
 *
 * `live` is computed on the server by the same rule the app's query uses,
 * so "why is my card not showing" is answered here rather than by reading a
 * phone: switched off, not started, expired, no language, or the partner is
 * not trading.
 *
 * ## The two numbers
 *
 * Impressions and opens are event counters on the card — one impression
 * each time a card was actually on a screen (≥ 60 % visible for half a
 * second, once per app session), one open per tap. They are not people,
 * not unique viewers and not a funnel; the rate is the plain ratio of the
 * two and nothing more.
 */

export const LOCALES: Array<{ code: PartnerPromoLocale; label: string }> = [
  { code: 'hy', label: 'HY · Հայերեն' },
  { code: 'ru', label: 'RU · Русский' },
  { code: 'en', label: 'EN · English' },
];

type CopyForm = { title: string; subtitle: string; benefitLabel: string };
type CopyByLocale = Record<PartnerPromoLocale, CopyForm>;

type FormState = {
  partnerId: string;
  copy: CopyByLocale;
  destination: PartnerPromoDestination;
  sponsored: boolean;
  active: boolean;
  priority: string;
  startAt: string;
  endAt: string;
};

const EMPTY_COPY: CopyForm = { title: '', subtitle: '', benefitLabel: '' };

const EMPTY: FormState = {
  partnerId: '',
  copy: { hy: { ...EMPTY_COPY }, ru: { ...EMPTY_COPY }, en: { ...EMPTY_COPY } },
  destination: 'PARTNER',
  sponsored: false,
  active: false,
  priority: '0',
  startAt: '',
  endAt: '',
};

/** `datetime-local` speaks local wall-clock without a zone; the API wants ISO. */
function toIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A language is filled when it has a title and a benefit — the API's rule. */
export function isCopyFilled(copy: CopyForm): boolean {
  return copy.title.trim().length > 0 && copy.benefitLabel.trim().length > 0;
}

/** A language with something typed but not enough to show. */
export function isCopyPartial(copy: CopyForm): boolean {
  const any = copy.title.trim() || copy.subtitle.trim() || copy.benefitLabel.trim();
  return !!any && !isCopyFilled(copy);
}

function formFrom(promo: PartnerPromoAdminDto): FormState {
  const copy = { ...EMPTY.copy };
  for (const { code } of LOCALES) {
    const c = promo.translations[code];
    copy[code] = c
      ? { title: c.title ?? '', subtitle: c.subtitle ?? '', benefitLabel: c.benefitLabel ?? '' }
      : { ...EMPTY_COPY };
  }
  return {
    partnerId: promo.partnerId,
    copy,
    destination: promo.destination,
    sponsored: promo.sponsored,
    active: promo.active,
    priority: String(promo.priority),
    startAt: toLocal(promo.startAt),
    endAt: toLocal(promo.endAt),
  };
}

/** Only filled languages are sent; a partial one is a validation error the form shows first. */
export function translationsFrom(copy: CopyByLocale): PartnerPromoTranslationsDto {
  const out: PartnerPromoTranslationsDto = {};
  for (const { code } of LOCALES) {
    const c = copy[code];
    if (!isCopyFilled(c)) continue;
    out[code] = { title: c.title.trim(), subtitle: c.subtitle.trim() || null, benefitLabel: c.benefitLabel.trim() };
  }
  return out;
}

function payloadFrom(form: FormState): CreatePartnerPromoRequestDto {
  return {
    partnerId: form.partnerId,
    translations: translationsFrom(form.copy),
    destination: form.destination,
    sponsored: form.sponsored,
    active: form.active,
    priority: Number(form.priority) || 0,
    startAt: toIso(form.startAt),
    endAt: toIso(form.endAt),
  };
}

/** Why a card is not on customers' screens, in the words an admin needs. */
export function statusOf(
  promo: PartnerPromoAdminDto,
  now = new Date(),
): { label: string; tone: 'available' | 'pending' | 'neutral' | 'danger' } {
  if (promo.live) return { label: 'Live', tone: 'available' };
  if (!promo.active) return { label: 'Off', tone: 'neutral' };
  if (promo.availableLocales.length === 0) return { label: 'No language filled', tone: 'danger' };
  if (promo.startAt && new Date(promo.startAt) > now) return { label: 'Scheduled', tone: 'pending' };
  if (promo.endAt && new Date(promo.endAt) <= now) return { label: 'Expired', tone: 'neutral' };
  return { label: 'Partner not trading', tone: 'danger' };
}

/** "opens / impressions" as a plain percentage — nothing about people. */
export function openRate(promo: Pick<PartnerPromoAdminDto, 'impressionCount' | 'openCount'>): string {
  if (promo.impressionCount === 0) return '—';
  return `${((promo.openCount / promo.impressionCount) * 100).toFixed(1)}%`;
}

export default function PromosPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin-promos'], queryFn: promosApi.list });
  const { data: partners } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });

  const [editing, setEditing] = useState<PartnerPromoAdminDto | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [previewLocale, setPreviewLocale] = useState<PartnerPromoLocale>('ru');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-promos'] });

  const partialLocales = LOCALES.filter(({ code }) => isCopyPartial(form.copy[code]));
  const filledLocales = LOCALES.filter(({ code }) => isCopyFilled(form.copy[code]));

  const save = useMutation({
    mutationFn: async () => {
      if (partialLocales.length > 0) {
        throw new Error(`Finish or clear: ${partialLocales.map((l) => l.code.toUpperCase()).join(', ')}`);
      }
      if (filledLocales.length === 0) {
        throw new Error('At least one language needs a title and a benefit.');
      }
      const payload = payloadFrom(form);
      if (editing) {
        const { partnerId: _partnerId, ...rest } = payload;
        void _partnerId;
        return promosApi.update(editing.id, rest);
      }
      return promosApi.create(payload);
    },
    onSuccess: () => {
      setError(null);
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      void invalidate();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error && e.message ? e.message : 'Could not save this placement. Check the fields and try again.'),
  });

  const toggle = useMutation({
    mutationFn: (promo: PartnerPromoAdminDto) => promosApi.update(promo.id, { active: !promo.active }),
    onSuccess: () => void invalidate(),
  });

  const artwork = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => promosApi.setArtwork(id, file),
    onSuccess: () => void invalidate(),
    onError: () => setError('Could not upload the artwork. JPEG/PNG/WebP up to 5 MB.'),
  });

  const startEdit = (promo: PartnerPromoAdminDto) => {
    setEditing(promo);
    setForm(formFrom(promo));
    setPreviewLocale(promo.availableLocales[0] ?? 'ru');
    setOpen(true);
    setError(null);
  };

  const startNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen((v) => !v);
    setError(null);
  };

  const setCopy = (locale: PartnerPromoLocale, patch: Partial<CopyForm>) =>
    setForm((f) => ({ ...f, copy: { ...f.copy, [locale]: { ...f.copy[locale], ...patch } } }));

  const tradingPartners = (partners ?? []).filter((p) => p.isActive && p.status === 'ACTIVE');
  const previewPartner =
    (partners ?? []).find((p) => p.id === form.partnerId)?.displayName ?? editing?.partnerName ?? 'Partner';
  const previewCopy = form.copy[previewLocale];

  return (
    <>
      <PageHeader
        title="Partner Spotlight"
        description="The strip of partner offers on every customer's Home screen, in the customer's language. At most five live cards, highest priority first; when nothing is live the strip is not shown."
        actions={
          <Button onClick={startNew} variant={open && !editing ? 'tertiary' : 'primary'}>
            {open && !editing ? 'Cancel' : 'New placement'}
          </Button>
        }
      />

      {open ? (
        <Surface className="mb-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Partner" hint={editing ? 'A card stays with the partner it was made for.' : undefined}>
                <Select
                  required
                  disabled={!!editing}
                  value={form.partnerId}
                  onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                >
                  <option value="">Choose a partner…</option>
                  {tradingPartners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tap lands on">
                <Select
                  value={form.destination}
                  onChange={(e) => setForm({ ...form, destination: e.target.value as PartnerPromoDestination })}
                >
                  <option value="PARTNER">The partner's page</option>
                  <option value="PARTNERS_MAP">The whole map</option>
                </Select>
              </Field>

              {LOCALES.map(({ code, label }) => {
                const copy = form.copy[code];
                const state = isCopyFilled(copy) ? 'filled' : isCopyPartial(copy) ? 'partial' : 'empty';
                return (
                  <fieldset key={code} className="rounded-tutak-md border border-line p-4 sm:col-span-2" data-testid={`copy-${code}`}>
                    <legend className="flex items-center gap-2 px-1 text-[13px] font-medium text-ink">
                      {label}
                      <Badge tone={state === 'filled' ? 'available' : state === 'partial' ? 'danger' : 'neutral'}>
                        {state === 'filled' ? 'Filled' : state === 'partial' ? 'Incomplete' : 'Empty'}
                      </Badge>
                    </legend>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Field label={`Title (${code.toUpperCase()})`}>
                        <Input maxLength={80} value={copy.title} onChange={(e) => setCopy(code, { title: e.target.value })} />
                      </Field>
                      <Field label={`Subtitle (${code.toUpperCase()})`} hint="Optional.">
                        <Input maxLength={120} value={copy.subtitle} onChange={(e) => setCopy(code, { subtitle: e.target.value })} />
                      </Field>
                      <Field label={`Benefit (${code.toUpperCase()})`} hint="10% քեշբեք · 10% кешбэк · 10% cashback">
                        <Input maxLength={24} value={copy.benefitLabel} onChange={(e) => setCopy(code, { benefitLabel: e.target.value })} />
                      </Field>
                    </div>
                  </fieldset>
                );
              })}
              <p className="text-[12px] text-faint sm:col-span-2">
                The app asks in the customer's language and falls back RU → first filled language. A language with only
                some fields typed is not saved until it is finished or cleared.
              </p>

              <Field label="Priority" hint="Higher shows first.">
                <Input inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              </Field>
              <div />
              <Field label="Starts" hint="Empty = from now.">
                <Input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
              </Field>
              <Field label="Ends" hint="Empty = until switched off. An ended card is never shown.">
                <Input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
              </Field>
              <div className="flex flex-wrap items-center gap-6 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.sponsored} onChange={(e) => setForm({ ...form, sponsored: e.target.checked })} />
                  Paid placement (shows a small &quot;Promo&quot; mark)
                </label>
              </div>
              {error ? <p className="text-[13px] text-danger-text sm:col-span-2">{error}</p> : null}
              <div className="flex gap-3 sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {editing ? 'Save changes' : 'Create placement'}
                </Button>
                {editing ? (
                  <Button type="button" variant="tertiary" onClick={startNew}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted">Preview</span>
                <div className="flex gap-1">
                  {LOCALES.map(({ code }) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setPreviewLocale(code)}
                      className={`rounded-full px-2.5 py-1 text-[12px] ${
                        previewLocale === code ? 'bg-brand text-white' : 'bg-canvas text-muted'
                      }`}
                    >
                      {code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <CardPreview
                partnerName={previewPartner}
                title={previewCopy.title || `Title (${previewLocale.toUpperCase()})`}
                subtitle={previewCopy.subtitle}
                benefitLabel={previewCopy.benefitLabel || 'Benefit'}
                sponsored={form.sponsored}
                artworkUrl={editing?.artwork?.url ?? null}
              />
              <p className="mt-2 text-[12px] text-faint">
                As on the phone: the app sets the text, the photograph is only a photograph.
                {editing ? '' : ' Upload artwork from the row after creating the placement.'}
              </p>
            </div>
          </form>
        </Surface>
      ) : null}

      {isLoading ? (
        <Surface>
          <p className="text-[13px] text-muted">Loading…</p>
        </Surface>
      ) : isError ? (
        <Surface>
          <LoadFailed what="placements" onRetry={() => refetch()} />
        </Surface>
      ) : !data || data.length === 0 ? (
        <Surface>
          <EmptyState
            title="No placements yet"
            message="Create one above. Customers see nothing until a placement is active, inside its window, has at least one language, and its partner is trading."
          />
        </Surface>
      ) : (
        <Surface padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Card</Th>
                <Th>Partner</Th>
                <Th>Languages</Th>
                <Th>Status</Th>
                <Th>Window</Th>
                <Th>Priority</Th>
                <Th>Impressions</Th>
                <Th>Opens</Th>
                <Th>Open rate</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {data.map((promo) => (
                <PromoRow
                  key={promo.id}
                  promo={promo}
                  busy={toggle.isPending || artwork.isPending}
                  onEdit={() => startEdit(promo)}
                  onToggle={() => toggle.mutate(promo)}
                  onArtwork={(file) => artwork.mutate({ id: promo.id, file })}
                />
              ))}
            </tbody>
          </Table>
        </Surface>
      )}
    </>
  );
}

function PromoRow({
  promo,
  busy,
  onEdit,
  onToggle,
  onArtwork,
}: {
  promo: PartnerPromoAdminDto;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onArtwork: (file: File) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const status = statusOf(promo);
  const window =
    promo.startAt || promo.endAt
      ? `${promo.startAt ? new Date(promo.startAt).toLocaleString() : '…'} → ${promo.endAt ? new Date(promo.endAt).toLocaleString() : '…'}`
      : 'Open';

  return (
    <Tr>
      <Td>
        <div className="flex items-center gap-3">
          <div className="h-10 w-16 shrink-0 overflow-hidden rounded-tutak-sm bg-canvas">
            {promo.artwork ? (
              <img src={promo.artwork.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-ink">{promo.title || '— no language filled —'}</div>
            <div className="text-[12px] text-muted">
              {promo.benefitLabel}
              {promo.sponsored ? ' · Promo' : ''}
            </div>
          </div>
        </div>
      </Td>
      <Td>{promo.partnerName}</Td>
      <Td>
        <div className="flex gap-1">
          {LOCALES.map(({ code }) => (
            <Badge key={code} tone={promo.availableLocales.includes(code) ? 'available' : 'neutral'}>
              {code.toUpperCase()}
            </Badge>
          ))}
        </div>
      </Td>
      <Td>
        <Badge tone={status.tone}>{status.label}</Badge>
      </Td>
      <Td>
        <span className="text-[12px] text-muted">{window}</span>
      </Td>
      <Td>{promo.priority}</Td>
      <Td>{promo.impressionCount}</Td>
      <Td>{promo.openCount}</Td>
      <Td>{openRate(promo)}</Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label={`Artwork for ${promo.title || promo.id}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onArtwork(file);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="tertiary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {promo.artwork ? 'Replace artwork' : 'Upload artwork'}
          </Button>
          <Button size="sm" variant="tertiary" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant={promo.active ? 'destructive' : 'secondary'} disabled={busy} onClick={onToggle}>
            {promo.active ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

/**
 * The card as the phone draws it: a 16:10 photograph, a benefit chip at the
 * top left, the small "Promo" mark at the top right when paid, and the
 * partner, title and subtitle set over a scrim at the bottom. The same
 * proportions as `PartnerSpotlight` in the app, so an administrator sees
 * whether a title wraps before a customer does — in each language.
 */
function CardPreview({
  partnerName,
  title,
  subtitle,
  benefitLabel,
  sponsored,
  artworkUrl,
}: {
  partnerName: string;
  title: string;
  subtitle: string;
  benefitLabel: string;
  sponsored: boolean;
  artworkUrl: string | null;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-[16px] text-white"
      style={{
        aspectRatio: '16 / 10',
        background: artworkUrl
          ? `url(${artworkUrl}) center / cover no-repeat`
          : 'linear-gradient(135deg, #073c26, #0b5d3b)',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(6,18,12,0) 30%, rgba(6,18,12,0.35) 62%, rgba(6,18,12,0.82) 100%)',
        }}
      />
      <div className="absolute left-4 right-4 top-4 flex items-center justify-between">
        <span className="rounded-full bg-white/95 px-3 py-1 text-[13px] font-semibold text-brand">{benefitLabel}</span>
        {sponsored ? <span className="text-[12px] text-white/70">Promo</span> : null}
      </div>
      <div className="absolute bottom-4 left-4 right-4">
        <div className="text-[12px] text-white/80">{partnerName}</div>
        <div className="mt-1 line-clamp-2 text-[17px] font-semibold leading-6">{title}</div>
        {subtitle ? <div className="mt-1 truncate text-[12px] text-white/70">{subtitle}</div> : null}
      </div>
    </div>
  );
}
