import { normalizeArmenianPhone } from '@tutak/shared-types';

describe('normalizeArmenianPhone', () => {
  it.each([
    ['+37491234567', '+37491234567'],
    ['+374 91 23 45 67', '+37491234567'],
    ['091 234567', '+37491234567'],
    ['374-91-234567', '+37491234567'],
    ['0037491234567', '+37491234567'],
    ['(091) 23-45-67', '+37491234567'],
    ['91234567', '+37491234567'],
  ])('reads %s as %s', (typed, expected) => {
    expect(normalizeArmenianPhone(typed)).toBe(expected);
  });

  it.each(['+374', '+3749123456', '+374912345678', '+7 912 345 67 89', ''])(
    'refuses %s',
    (typed) => {
      expect(normalizeArmenianPhone(typed)).toBeNull();
    },
  );
});
