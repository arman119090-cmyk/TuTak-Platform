"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/admin/forms";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * <form> bound to a Server Action through useActionState, so the action's
 * result (success or validation error) is shown inline.
 *
 * Submission goes through onSubmit + startTransition instead of React's
 * automatic form action, because the automatic path resets the form after
 * every submit — a validation error would wipe what the admin typed.
 * Without JS the plain `action` still works (progressive enhancement).
 */
export function ActionForm({
  action,
  children,
  className,
  inline = false,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  inline?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
      className={className ?? (inline ? "adm-inline-form" : "adm-form")}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "adm-msg adm-msg-ok" : "adm-msg adm-msg-bad"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  confirm,
  name,
  value,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger";
  confirm?: string;
  name?: string;
  value?: string;
  className?: string;
}) {
  const pending = useContext(PendingContext);
  const cls = variant === "primary" ? "btn btn-primary" : variant === "danger" ? "btn adm-btn-danger" : "btn btn-ghost";
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={`${cls} ${className ?? ""}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
