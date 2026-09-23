import { expect, test } from "@playwright/test";

test.describe("payment callback endpoint", () => {
  test("rejects unsigned and unknown callbacks", async ({ request }) => {
    const res = await request.post("/api/payments/callback/mock", {
      data: { eventId: "x", paymentId: "nope", outcome: "SUCCEEDED", amountAmd: 1 },
    });
    expect(res.status()).toBe(400);
    const unknown = await request.post("/api/payments/callback/unknownprovider", { data: {} });
    expect(unknown.status()).toBe(404);
  });

  test("cron endpoint requires the secret", async ({ request }) => {
    const res = await request.post("/api/cron/expire");
    expect(res.status()).toBe(401);
  });
});
