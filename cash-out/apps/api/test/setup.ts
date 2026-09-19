/** Money is BigInt everywhere; make it printable in assertions and snapshots. */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

jest.setTimeout(30_000);
