import { describe, expect, it } from "vitest";
import {
  canTransition,
  isTerminal,
  nextStatuses,
  ORDER_STATUSES,
  stockEffect,
  type OrderStatus,
  type TransitionActor,
} from "@/lib/domain/order-state";

const ACTORS: TransitionActor[] = ["system", "payment", "admin"];

describe("order transitions", () => {
  it.each([
    ["PENDING", "CONFIRMED", "admin"],
    ["PENDING", "CANCELLED", "admin"],
    ["PENDING", "CANCELLED", "system"],
    ["AWAITING_PAYMENT", "PAID", "payment"],
    ["AWAITING_PAYMENT", "PAYMENT_FAILED", "payment"],
    ["AWAITING_PAYMENT", "PAYMENT_FAILED", "system"],
    ["AWAITING_PAYMENT", "CANCELLED", "admin"],
    ["PAID", "CONFIRMED", "admin"],
    ["PAID", "CONFIRMED", "system"],
    ["PAID", "REFUNDED", "admin"],
    ["PAYMENT_FAILED", "PAID", "payment"],
    ["PAYMENT_FAILED", "AWAITING_PAYMENT", "system"],
    ["PAYMENT_FAILED", "CANCELLED", "admin"],
    ["CONFIRMED", "PACKING", "admin"],
    ["CONFIRMED", "CANCELLED", "admin"],
    ["PACKING", "SHIPPED", "admin"],
    ["PACKING", "CANCELLED", "admin"],
    ["SHIPPED", "DELIVERED", "admin"],
    ["DELIVERED", "REFUNDED", "admin"],
  ] as [OrderStatus, OrderStatus, TransitionActor][])("allows %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it("admin can never set PAID or PAYMENT_FAILED from any status", () => {
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, "PAID", "admin")).toBe(false);
      expect(canTransition(from, "PAYMENT_FAILED", "admin")).toBe(false);
      expect(nextStatuses(from, "admin")).not.toContain("PAID");
      expect(nextStatuses(from, "admin")).not.toContain("PAYMENT_FAILED");
    }
  });

  it("payment actor can never confirm, ship or cancel", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ["CONFIRMED", "PACKING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as OrderStatus[]) {
        expect(canTransition(from, to, "payment")).toBe(false);
      }
    }
  });

  it.each([
    ["PENDING", "PAID", "payment"],
    ["PENDING", "SHIPPED", "admin"],
    ["AWAITING_PAYMENT", "CONFIRMED", "admin"],
    ["CONFIRMED", "PENDING", "admin"],
    ["SHIPPED", "CANCELLED", "admin"],
    ["DELIVERED", "CANCELLED", "admin"],
    ["PAID", "CANCELLED", "admin"],
    ["PAID", "REFUNDED", "system"],
    ["PAYMENT_FAILED", "AWAITING_PAYMENT", "admin"],
    ["CONFIRMED", "PACKING", "system"],
  ] as [OrderStatus, OrderStatus, TransitionActor][])("forbids %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });

  it("no self-transitions", () => {
    for (const s of ORDER_STATUSES) for (const a of ACTORS) expect(canTransition(s, s, a)).toBe(false);
  });

  it("terminal states are exactly CANCELLED and REFUNDED and have no exits", () => {
    expect(ORDER_STATUSES.filter(isTerminal)).toEqual(["CANCELLED", "REFUNDED"]);
    for (const s of ["CANCELLED", "REFUNDED"] as OrderStatus[]) {
      for (const a of ACTORS) {
        expect(nextStatuses(s, a)).toEqual([]);
        for (const to of ORDER_STATUSES) expect(canTransition(s, to, a)).toBe(false);
      }
    }
  });

  it("nextStatuses lists what the admin UI may offer", () => {
    expect(nextStatuses("PENDING", "admin")).toEqual(["CONFIRMED", "CANCELLED"]);
    expect(nextStatuses("AWAITING_PAYMENT", "admin")).toEqual(["CANCELLED"]);
    expect(nextStatuses("AWAITING_PAYMENT", "payment")).toEqual(["PAID", "PAYMENT_FAILED"]);
  });
});

describe("stockEffect", () => {
  const table: [OrderStatus, "RESERVED" | "COMMITTED" | "RELEASED", string][] = [
    // RESERVED
    ["CONFIRMED", "RESERVED", "COMMIT"],
    ["PAID", "RESERVED", "COMMIT"],
    ["CANCELLED", "RESERVED", "RELEASE"],
    ["PAYMENT_FAILED", "RESERVED", "RELEASE"],
    ["AWAITING_PAYMENT", "RESERVED", "NONE"],
    ["PACKING", "RESERVED", "NONE"],
    ["SHIPPED", "RESERVED", "NONE"],
    ["DELIVERED", "RESERVED", "NONE"],
    ["REFUNDED", "RESERVED", "NONE"],
    ["PENDING", "RESERVED", "NONE"],
    // RELEASED
    ["PAID", "RELEASED", "COMMIT"],
    ["AWAITING_PAYMENT", "RELEASED", "RESERVE"],
    ["CANCELLED", "RELEASED", "NONE"],
    ["CONFIRMED", "RELEASED", "NONE"],
    ["PAYMENT_FAILED", "RELEASED", "NONE"],
    ["REFUNDED", "RELEASED", "NONE"],
    // COMMITTED
    ["CANCELLED", "COMMITTED", "RESTOCK"],
    ["REFUNDED", "COMMITTED", "NONE"],
    ["CONFIRMED", "COMMITTED", "NONE"],
    ["PACKING", "COMMITTED", "NONE"],
    ["SHIPPED", "COMMITTED", "NONE"],
    ["DELIVERED", "COMMITTED", "NONE"],
    ["PAID", "COMMITTED", "NONE"],
  ];
  it.each(table)("entering %s from stock %s → %s", (to, state, effect) => {
    expect(stockEffect(to, state)).toBe(effect);
  });
});
