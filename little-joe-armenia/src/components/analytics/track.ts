// Client-side analytics dispatch. GA4 event names are used as the canonical
// vocabulary and mapped to Meta Pixel / TikTok equivalents. Nothing is sent
// until the visitor consents (the tags are not even loaded before that).

export type AnalyticsEvent =
  | "view_item"
  | "view_item_list"
  | "search"
  | "add_to_cart"
  | "remove_from_cart"
  | "begin_checkout"
  | "add_payment_info"
  | "purchase";

export type AnalyticsItem = { item_id: string; item_name: string; price?: number; quantity?: number; item_category?: string };
export type AnalyticsParams = {
  currency?: "AMD";
  value?: number;
  items?: AnalyticsItem[];
  search_term?: string;
  item_list_name?: string;
  transaction_id?: string;
  payment_type?: string;
  shipping?: number;
};

type W = Window & {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (name: string, params?: Record<string, unknown>) => void };
  __ljConsent?: boolean;
};

const META: Partial<Record<AnalyticsEvent, string>> = {
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "Purchase",
};
const TIKTOK: Partial<Record<AnalyticsEvent, string>> = {
  view_item: "ViewContent",
  search: "Search",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  purchase: "CompletePayment",
};

export function track(event: AnalyticsEvent, params: AnalyticsParams = {}) {
  if (typeof window === "undefined") return;
  const w = window as W;
  if (!w.__ljConsent) return;
  try {
    w.gtag?.("event", event, params);
    const meta = META[event];
    if (meta && w.fbq) {
      w.fbq("track", meta, {
        currency: params.currency,
        value: params.value,
        content_ids: params.items?.map((i) => i.item_id),
        content_type: "product",
        search_string: params.search_term,
      });
    }
    const tt = TIKTOK[event];
    if (tt && w.ttq) {
      w.ttq.track(tt, {
        currency: params.currency,
        value: params.value,
        contents: params.items?.map((i) => ({ content_id: i.item_id, content_name: i.item_name, quantity: i.quantity, price: i.price })),
      });
    }
  } catch {
    // Analytics must never break the shop.
  }
  if (process.env.NODE_ENV !== "production") {
    (w as unknown as { __ljEvents?: unknown[] }).__ljEvents ??= [];
    (w as unknown as { __ljEvents: unknown[] }).__ljEvents.push({ event, params });
  }
}
