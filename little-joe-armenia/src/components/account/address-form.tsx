"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addAddressAction } from "@/app/actions/account";
import { useI18n } from "@/i18n/provider";
import { REGION_CODES } from "@/lib/armenia";

export function AddressForm() {
  const { m } = useI18n();
  const router = useRouter();
  const [state, action, pending] = useActionState(addAddressAction, { ok: false });
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="grid gap-3">
      <label>
        <span className="label">{m.checkout.region}</span>
        <select name="region" className="field" defaultValue="ER">
          {REGION_CODES.map((r) => (
            <option key={r} value={r}>
              {m.regions[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">{m.checkout.city}</span>
        <input name="city" className="field" required maxLength={80} />
      </label>
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <label>
          <span className="label">{m.checkout.street}</span>
          <input name="street" className="field" required maxLength={120} />
        </label>
        <label>
          <span className="label">{m.checkout.building}</span>
          <input name="building" className="field" required maxLength={20} />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label>
          <span className="label">{m.checkout.apartment}</span>
          <input name="apartment" className="field" maxLength={20} />
        </label>
        <label>
          <span className="label">{m.checkout.entrance}</span>
          <input name="entrance" className="field" maxLength={10} />
        </label>
        <label>
          <span className="label">{m.checkout.floor}</span>
          <input name="floor" className="field" maxLength={10} />
        </label>
      </div>
      <button type="submit" className="btn btn-primary justify-self-start" disabled={pending}>
        {m.common.save}
      </button>
    </form>
  );
}
