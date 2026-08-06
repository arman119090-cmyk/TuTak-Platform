import { Decimal } from '@prisma/client/runtime/library';

export type Money = Decimal | number | string;

export const toDecimal = (value: Money): Decimal =>
  value instanceof Decimal ? value : new Decimal(value);

export const isPositive = (value: Money): boolean => toDecimal(value).greaterThan(0);

export const sumDecimals = (values: Money[]): Decimal =>
  values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
