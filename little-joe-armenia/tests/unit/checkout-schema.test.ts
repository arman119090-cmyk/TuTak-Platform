import { describe, expect, it } from "vitest";
import { checkoutSchema, type CheckoutInput } from "@/lib/validation/checkout";

const valid: CheckoutInput = {
  idempotencyKey: "abcDEF1234567890_-",
  name: "  Ani Petrosyan ",
  phone: "091 23 45 67",
  email: " Ani@Example.AM ",
  region: "ER",
  city: "Yerevan",
  street: "Abovyan",
  building: "12",
  apartment: "",
  deliveryMethod: "courier-yerevan",
  payment: "CASH_ON_DELIVERY",
};

function codes(input: unknown) {
  const r = checkoutSchema.safeParse(input);
  expect(r.success).toBe(false);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("checkoutSchema", () => {
  it("accepts valid input and normalises phone, email, whitespace and empty optionals", () => {
    const r = checkoutSchema.parse(valid);
    expect(r.phone).toBe("+37491234567");
    expect(r.email).toBe("ani@example.am");
    expect(r.name).toBe("Ani Petrosyan");
    expect(r.apartment).toBeUndefined();
    expect(r.region).toBe("ER");
  });

  it("email is optional", () => {
    expect(checkoutSchema.parse({ ...valid, email: undefined }).email).toBeUndefined();
    expect(checkoutSchema.parse({ ...valid, email: "" }).email).toBeUndefined();
  });

  it("invalid email → emailInvalid", () => {
    expect(codes({ ...valid, email: "not-an-email" })).toMatchObject({ email: "emailInvalid" });
  });

  it("invalid phone → phoneInvalid", () => {
    expect(codes({ ...valid, phone: "12345" })).toMatchObject({ phone: "phoneInvalid" });
    expect(codes({ ...valid, phone: "+7 912 345 67 89" })).toMatchObject({ phone: "phoneInvalid" });
  });

  it("invalid region → regionInvalid", () => {
    expect(codes({ ...valid, region: "XX" })).toMatchObject({ region: "regionInvalid" });
  });

  it("other field codes", () => {
    expect(codes({ ...valid, name: "A" })).toMatchObject({ name: "nameInvalid" });
    expect(codes({ ...valid, city: "   " })).toMatchObject({ city: "required" });
    expect(codes({ ...valid, payment: "PAYPAL" })).toMatchObject({ payment: "paymentInvalid" });
    expect(codes({ ...valid, comment: "x".repeat(501) })).toMatchObject({ comment: "tooLong" });
    expect(codes({ ...valid, idempotencyKey: "short" })).toHaveProperty("idempotencyKey");
  });
});
