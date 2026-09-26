/**
 * The customer's payment split on a TuTak checkout — one pure function shared
 * by the mobile app and TuTak Web Checkout, so both show exactly what the
 * API will accept (the API re-validates everything; this only mirrors it).
 *
 * Q13 (Arman, 2026-09-26): the minimum prepayment is real financial
 * security, so only the TuTak-money part counts toward it. The discount
 * (green) balance lowers the price but never covers the prepayment.
 */
export interface CheckoutSplitInput {
  total: number;
  discountAvailable: number;
  /** The partner's cap for this order (maxBonusPaymentPercent of the total). */
  maxDiscountAmount: number;
  moneyBalance: number;
  prepaymentRequired: number;
  discountInput: number;
  moneyInput: number;
}

export interface CheckoutSplit {
  discount: number;
  money: number;
  external: number;
  /** TuTak money the customer chose but does not have (top-up needed). */
  missingMoney: number;
  /** How much more TuTak money the prepayment still needs. */
  prepaymentShort: number;
  canConfirm: boolean;
}

/** Whole AMD only: nothing a customer types at checkout ever needs fractions. */
export function parseCheckoutAmount(raw: string): number {
  const n = Number(raw.replace(/\s/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function computeCheckoutSplit(input: CheckoutSplitInput): CheckoutSplit {
  const maxDiscount = Math.max(Math.min(input.maxDiscountAmount, input.discountAvailable, input.total), 0);
  const discount = Math.min(Math.max(input.discountInput, 0), maxDiscount);
  const money = Math.min(Math.max(input.moneyInput, 0), Math.max(input.total - discount, 0));
  const external = Math.max(input.total - discount - money, 0);
  const missingMoney = Math.max(money - input.moneyBalance, 0);
  const prepaymentShort = Math.max(input.prepaymentRequired - money, 0);
  return { discount, money, external, missingMoney, prepaymentShort, canConfirm: missingMoney === 0 && prepaymentShort === 0 };
}
