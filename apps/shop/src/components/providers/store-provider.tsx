'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { COMPARE_LIMIT } from '@/config/site';

/**
 * Client-side shopping state: cart, wishlist, comparison and recently viewed.
 *
 * The cart holds *what* the customer chose (product id, quantity, option keys)
 * and never a price: totals come from POST /api/cart/quote so the browser can
 * never talk the server into a cheaper order. Everything is mirrored into
 * localStorage, which is what makes the cart survive a reload or a closed tab.
 */

export type CartLine = {
  productId: string;
  quantity: number;
  options: Record<string, string>;
  doorConfig?: Record<string, string>;
  /** Cached for instant rendering before the server quote arrives. */
  preview: { sku: string; slug: string; name: string; image: string; priceMinor: number };
};

export type CompareEntry = { productId: string; categorySlug: string; slug: string };

export type RecentEntry = { productId: string; slug: string; viewedAt: number };

type ToastKind = 'success' | 'error' | 'info';
export type Toast = { id: number; message: string; kind: ToastKind };

type StoreValue = {
  ready: boolean;
  cart: CartLine[];
  cartCount: number;
  addToCart: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  setLineOptions: (index: number, options: Record<string, string>) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  promoCode: string | null;
  setPromoCode: (code: string | null) => void;

  favorites: string[];
  isFavorite: (productId: string) => boolean;
  toggleFavorite: (productId: string) => void;

  compare: CompareEntry[];
  isCompared: (productId: string) => boolean;
  toggleCompare: (entry: CompareEntry) => 'added' | 'removed' | 'limit' | 'category';
  clearCompare: () => void;

  recent: RecentEntry[];
  pushRecent: (entry: Omit<RecentEntry, 'viewedAt'>) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

const KEYS = {
  cart: 'ornata.cart.v1',
  promo: 'ornata.promo.v1',
  favorites: 'ornata.favorites.v1',
  compare: 'ornata.compare.v1',
  recent: 'ornata.recent.v1',
} as const;

const read = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: the app keeps working, it just stops remembering */
  }
};

const sameLine = (a: CartLine, b: CartLine): boolean =>
  a.productId === b.productId &&
  JSON.stringify(a.options) === JSON.stringify(b.options) &&
  JSON.stringify(a.doorConfig ?? {}) === JSON.stringify(b.doorConfig ?? {});

export const StoreProvider = ({
  children,
  isAuthenticated = false,
}: {
  children: ReactNode;
  isAuthenticated?: boolean;
}) => {
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [promoCode, setPromoCodeState] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [compare, setCompare] = useState<CompareEntry[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    setCart(read<CartLine[]>(KEYS.cart, []));
    setPromoCodeState(read<string | null>(KEYS.promo, null));
    setFavorites(read<string[]>(KEYS.favorites, []));
    setCompare(read<CompareEntry[]>(KEYS.compare, []));
    setRecent(read<RecentEntry[]>(KEYS.recent, []));
    setReady(true);
  }, []);

  // A signed-in customer keeps one wishlist across devices: merge on load.
  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/favorites');
        if (!response.ok) return;
        const data = (await response.json()) as { productIds?: string[] };
        if (cancelled || !data.productIds) return;
        setFavorites((current) => {
          const merged = [...new Set([...current, ...data.productIds!])];
          write(KEYS.favorites, merged);
          const missingOnServer = merged.filter((id) => !data.productIds!.includes(id));
          for (const productId of missingOnServer) {
            void fetch('/api/favorites', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ productId, action: 'add' }),
            });
          }
          return merged;
        });
      } catch {
        /* offline: local wishlist still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, isAuthenticated]);

  const persistCart = useCallback((next: CartLine[]) => {
    setCart(next);
    write(KEYS.cart, next);
  }, []);

  const addToCart = useCallback(
    (line: CartLine) => {
      setCart((current) => {
        const index = current.findIndex((entry) => sameLine(entry, line));
        const next =
          index >= 0
            ? current.map((entry, i) =>
                i === index
                  ? { ...entry, quantity: Math.min(20, entry.quantity + line.quantity) }
                  : entry,
              )
            : [...current, line];
        write(KEYS.cart, next);
        return next;
      });
    },
    [],
  );

  const setQuantity = useCallback((index: number, quantity: number) => {
    setCart((current) => {
      const next = current
        .map((entry, i) => (i === index ? { ...entry, quantity: Math.max(0, Math.min(20, quantity)) } : entry))
        .filter((entry) => entry.quantity > 0);
      write(KEYS.cart, next);
      return next;
    });
  }, []);

  const setLineOptions = useCallback((index: number, options: Record<string, string>) => {
    setCart((current) => {
      const next = current.map((entry, i) => (i === index ? { ...entry, options } : entry));
      write(KEYS.cart, next);
      return next;
    });
  }, []);

  const removeFromCart = useCallback((index: number) => {
    setCart((current) => {
      const next = current.filter((_, i) => i !== index);
      write(KEYS.cart, next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    persistCart([]);
    setPromoCodeState(null);
    write(KEYS.promo, null);
  }, [persistCart]);

  const setPromoCode = useCallback((code: string | null) => {
    setPromoCodeState(code);
    write(KEYS.promo, code);
  }, []);

  const toggleFavorite = useCallback(
    (productId: string) => {
      setFavorites((current) => {
        const exists = current.includes(productId);
        const next = exists ? current.filter((id) => id !== productId) : [...current, productId];
        write(KEYS.favorites, next);
        if (isAuthenticated) {
          void fetch('/api/favorites', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ productId, action: exists ? 'remove' : 'add' }),
          });
        }
        return next;
      });
    },
    [isAuthenticated],
  );

  const toggleCompare = useCallback(
    (entry: CompareEntry): 'added' | 'removed' | 'limit' | 'category' => {
      let result: 'added' | 'removed' | 'limit' | 'category' = 'added';
      setCompare((current) => {
        if (current.some((item) => item.productId === entry.productId)) {
          result = 'removed';
          const next = current.filter((item) => item.productId !== entry.productId);
          write(KEYS.compare, next);
          return next;
        }
        // Comparing a sofa against a door is meaningless: same category only.
        if (current.length > 0 && current[0]!.categorySlug !== entry.categorySlug) {
          result = 'category';
          return current;
        }
        if (current.length >= COMPARE_LIMIT) {
          result = 'limit';
          return current;
        }
        const next = [...current, entry];
        write(KEYS.compare, next);
        return next;
      });
      return result;
    },
    [],
  );

  const clearCompare = useCallback(() => {
    setCompare([]);
    write(KEYS.compare, []);
  }, []);

  const pushRecent = useCallback((entry: Omit<RecentEntry, 'viewedAt'>) => {
    setRecent((current) => {
      const next = [
        { ...entry, viewedAt: Date.now() },
        ...current.filter((item) => item.productId !== entry.productId),
      ].slice(0, 12);
      write(KEYS.recent, next);
      return next;
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current.slice(-2), { id, message, kind }]);
      window.setTimeout(() => dismissToast(id), 3200);
    },
    [dismissToast],
  );

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      cart,
      cartCount: cart.reduce((sum, line) => sum + line.quantity, 0),
      addToCart,
      setQuantity,
      setLineOptions,
      removeFromCart,
      clearCart,
      promoCode,
      setPromoCode,
      favorites,
      isFavorite: (productId: string) => favorites.includes(productId),
      toggleFavorite,
      compare,
      isCompared: (productId: string) => compare.some((item) => item.productId === productId),
      toggleCompare,
      clearCompare,
      recent,
      pushRecent,
      toasts,
      toast,
      dismissToast,
    }),
    [
      ready, cart, addToCart, setQuantity, setLineOptions, removeFromCart, clearCart, promoCode,
      setPromoCode, favorites, toggleFavorite, compare, toggleCompare, clearCompare, recent,
      pushRecent, toasts, toast, dismissToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
};

export const useStore = (): StoreValue => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside <StoreProvider>');
  return context;
};
