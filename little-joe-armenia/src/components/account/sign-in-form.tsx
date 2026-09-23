"use client";

import { useActionState, useState } from "react";
import { requestCodeAction, verifyCodeAction, type AuthState } from "@/app/actions/account";
import { fmt } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";

export function SignInForm({ phoneAvailable }: { phoneAvailable: boolean }) {
  const { m, locale } = useI18n();
  const [channel, setChannel] = useState<"EMAIL" | "PHONE">("EMAIL");
  const [requestState, requestAction, requesting] = useActionState<AuthState, FormData>(requestCodeAction, { step: "request" });
  const [verifyState, verifyAction, verifying] = useActionState<AuthState, FormData>(
    (prev, form) => verifyCodeAction(prev.step === "verify" ? prev : requestState, form),
    requestState,
  );
  const state = verifyState.step === "verify" ? verifyState : requestState;

  if (state.step === "verify") {
    return (
      <form action={verifyAction} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <p className="text-ink-2" role="status">
          {fmt(m.account.codeSent, { target: state.target })}
        </p>
        {state.screenCode ? (
          <p className="rounded-2xl bg-warn/10 px-4 py-3 font-mono text-sm text-warn" data-testid="demo-code">
            {fmt(m.account.demoCode, { code: state.screenCode })}
          </p>
        ) : null}
        <label>
          <span className="label">{m.account.code}</span>
          <input
            name="code"
            className="field text-center font-mono text-2xl tracking-[0.5em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            aria-invalid={Boolean(state.error)}
          />
        </label>
        {state.error ? (
          <p role="alert" className="text-sm text-bad">
            {state.error === "rateLimited" ? m.common.rateLimited : m.account.codeInvalid}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={verifying}>
          {m.account.verify}
        </button>
      </form>
    );
  }

  const error = state.error;
  return (
    <form action={requestAction} className="grid gap-4">
      <input type="hidden" name="channel" value={channel} />
      {phoneAvailable ? (
        <div className="flex gap-2" role="radiogroup" aria-label={m.account.signIn}>
          {(["EMAIL", "PHONE"] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} className="chip" onClick={() => setChannel(c)}>
              {c === "EMAIL" ? m.account.byEmail : m.account.byPhone}
            </button>
          ))}
        </div>
      ) : null}
      <label>
        <span className="label">{channel === "EMAIL" ? m.checkout.email : m.checkout.phone}</span>
        <input
          key={channel}
          name="target"
          className="field"
          type={channel === "EMAIL" ? "email" : "tel"}
          inputMode={channel === "EMAIL" ? "email" : "tel"}
          autoComplete={channel === "EMAIL" ? "email" : "tel"}
          required
          maxLength={120}
          aria-invalid={Boolean(error)}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error === "rateLimited"
            ? m.common.rateLimited
            : error === "unavailable"
              ? m.account.smsUnavailable
              : error === "invalid"
                ? channel === "EMAIL"
                  ? m.validation.emailInvalid
                  : m.validation.phoneInvalid
                : m.common.genericError}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={requesting}>
        {m.account.sendCode}
      </button>
    </form>
  );
}
