"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Client state for the cart chrome only (badge count, drawer open). The
// cart itself lives on the server; the drawer fetches it when opened.

type CartUI = {
  count: number;
  setCount: (n: number) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  // Bumped after every mutation so an open drawer refetches.
  version: number;
  touch: () => void;
};

const Ctx = createContext<CartUI | null>(null);

export function CartUIProvider({ initialCount, children }: { initialCount: number; children: ReactNode }) {
  const [count, setCount] = useState(initialCount);
  const [isOpen, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const touch = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ count, setCount, isOpen, open, close, version, touch }),
    [count, isOpen, open, close, version, touch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCartUI(): CartUI {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCartUI must be used inside CartUIProvider");
  return c;
}
