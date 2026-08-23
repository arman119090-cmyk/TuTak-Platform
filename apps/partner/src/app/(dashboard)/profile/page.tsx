'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerOfferingDto } from '@tutak/shared-types';
import { Button, Field, PageHeader, Surface, Table, Td, Textarea, Th, Tr, Input } from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerOwner, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';

/**
 * The partner's public profile — "о себе" plus an optional priced
 * products/services list, confirmed with Arman 2026-08-23. Shown to a
 * customer on the partner's own page in the mobile app.
 *
 * Unlike `/branding`, there is no review step here: what an owner saves on
 * this page is what a customer sees the instant the request completes. The
 * page says that up front rather than implying a wait, and there is no
 * "pending" state to render because none exists — a string carries no
 * impersonation risk the way an uploaded image does, so it does not need
 * one.
 *
 * OWNER-only, mirroring `/branding` and the API's own
 * `assertPartnerOwner` on both `PATCH :id/about` and `PUT :id/offerings`. A
 * MANAGER or STAFF operator gets an explanation rather than a button that
 * would only 403.
 *
 * This is deliberately not a marketplace editor: there is no stock,
 * category, image, or "publish"/"unpublish" toggle per item — just a name,
 * an optional description, and a price, because that is all the confirmed
 * scope asked for. See `docs/PARTNER_PROFILE_2026-08-23.md`.
 */
export default function ProfilePage() {
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const isOwner = isPartnerOwner(user, partnerId);

  const { data, isLoading } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => partnerApi.get(partnerId!),
    enabled: !!partnerId && isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <Header />
        <Surface>
          <p className="text-[13px] text-muted">
            Only the partner owner can change your public profile. Ask your owner account to manage
            this.
          </p>
        </Surface>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="space-y-4">
        <AboutCard partnerId={partnerId ?? ''} about={data?.about ?? null} loading={isLoading} />
        <OfferingsCard
          partnerId={partnerId ?? ''}
          offerings={data?.offerings ?? []}
          loading={isLoading}
        />
      </div>
    </>
  );
}

function Header() {
  return (
    <PageHeader
      title="Public profile"
      description="What a customer sees on your page in the app: a short description and, if you want, a priced list of what you offer. Saved changes go live immediately — there is no review step."
    />
  );
}

function AboutCard({
  partnerId,
  about,
  loading,
}: {
  partnerId: string;
  about: string | null;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Seeded once, the first time the server value arrives — not on every
  // refetch, which would blow away whatever the owner is mid-typing.
  useEffect(() => {
    if (!seeded && !loading) {
      setText(about ?? '');
      setSeeded(true);
    }
  }, [seeded, loading, about]);

  const save = useMutation({
    mutationFn: () => partnerApi.updateAbout(partnerId, text.trim() || null),
    onSuccess: (partner) => {
      setText(partner.about ?? '');
      setSavedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: ['partner', partnerId] });
    },
  });

  return (
    <Surface>
      <div className="text-[15px] font-semibold text-ink">About</div>
      <p className="mt-1 max-w-2xl text-[13px] text-muted">
        A short description of your business, in your own words. Shown on your page in the app.
        Leave it empty to show nothing.
      </p>

      <div className="mt-4">
        <Field label="About your business" hint={`${text.length}/2000`}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="We roast our own beans daily…"
            disabled={loading}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={loading}>
          Save
        </Button>
        {savedAt && !save.isPending ? <span className="text-[13px] text-muted">Saved.</span> : null}
        {save.isError ? (
          <span className="text-[13px] text-danger-text">Could not save. Please try again.</span>
        ) : null}
      </div>
    </Surface>
  );
}

/** A row being edited — `price` stays a raw string while typing so a partial
 * entry ("15") isn't fought by number coercion, and is only validated on
 * save. */
interface DraftOffering {
  key: string;
  name: string;
  description: string;
  price: string;
}

let draftKeySeq = 0;
const newDraftKey = () => `draft-${++draftKeySeq}`;

function toDrafts(offerings: PartnerOfferingDto[]): DraftOffering[] {
  return offerings.map((o) => ({
    key: o.id,
    name: o.name,
    description: o.description ?? '',
    price: o.price,
  }));
}

function OfferingsCard({
  partnerId,
  offerings,
  loading,
}: {
  partnerId: string;
  offerings: PartnerOfferingDto[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DraftOffering[]>([]);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!seededRef.current && !loading) {
      setRows(toDrafts(offerings));
      seededRef.current = true;
    }
    // Only seeds once, the first time data arrives — same reasoning as
    // `AboutCard`. Deliberately excludes `offerings` from the deps list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const save = useMutation({
    mutationFn: () =>
      partnerApi.replaceOfferings(
        partnerId,
        rows.map((r) => ({
          name: r.name.trim(),
          description: r.description.trim() || undefined,
          price: r.price.trim(),
        })),
      ),
    onSuccess: (saved) => {
      setRows(toDrafts(saved));
      void queryClient.invalidateQueries({ queryKey: ['partner', partnerId] });
    },
  });

  const updateRow = (key: string, patch: Partial<DraftOffering>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const addRow = () =>
    setRows((prev) => [...prev, { key: newDraftKey(), name: '', description: '', price: '' }]);

  const priceValid = (value: string) => /^\d{1,14}(\.\d{1,4})?$/.test(value) && Number(value) > 0;
  const rowsValid = rows.every((r) => r.name.trim().length > 0 && priceValid(r.price));

  return (
    <Surface>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[15px] font-semibold text-ink">Products & services</div>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Optional. A priced list a customer can browse on your page — not a store: nothing here
            can be bought through the app yet, it is only shown.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={addRow} disabled={loading || rows.length >= 50}>
          Add item
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-faint">Nothing listed yet.</p>
      ) : (
        <div className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Description</Th>
                <Th align="right">Price (AMD)</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.key}>
                  <Td>
                    <Input
                      value={row.name}
                      onChange={(e) => updateRow(row.key, { name: e.target.value })}
                      maxLength={120}
                      placeholder="Espresso"
                    />
                  </Td>
                  <Td>
                    <Input
                      value={row.description}
                      onChange={(e) => updateRow(row.key, { description: e.target.value })}
                      maxLength={500}
                      placeholder="Optional"
                    />
                  </Td>
                  <Td align="right">
                    <Input
                      value={row.price}
                      onChange={(e) => updateRow(row.key, { price: e.target.value })}
                      inputMode="decimal"
                      placeholder="1500"
                      className="text-right"
                    />
                  </Td>
                  <Td align="right">
                    <Button size="sm" variant="tertiary" onClick={() => removeRow(row.key)}>
                      Remove
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={loading || !rowsValid}
        >
          Save changes
        </Button>
        {!rowsValid && rows.length > 0 ? (
          <span className="text-[13px] text-danger-text">
            Every item needs a name and a price greater than zero.
          </span>
        ) : save.isError ? (
          <span className="text-[13px] text-danger-text">Could not save. Please try again.</span>
        ) : save.isSuccess && !save.isPending ? (
          <span className="text-[13px] text-muted">Saved.</span>
        ) : null}
      </div>
    </Surface>
  );
}
