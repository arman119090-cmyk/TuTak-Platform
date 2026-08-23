import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReplacePartnerOfferingsDto } from './replace-partner-offerings.dto';
import { UpdatePartnerAboutDto } from './update-partner-about.dto';

/**
 * The DTO boundary for the partner public profile (about text + offerings),
 * confirmed with Arman 2026-08-23. Neither field has a moderation step
 * behind it — this is the *only* gate before a partner's write reaches
 * every customer reading their page, so it has to actually reject what it
 * claims to.
 */
describe('UpdatePartnerAboutDto', () => {
  const errorsFor = (about: unknown) => {
    const dto = plainToInstance(UpdatePartnerAboutDto, { about });
    return validateSync(dto);
  };

  it('accepts a normal about text', () => {
    expect(errorsFor('We roast our own beans daily.')).toHaveLength(0);
  });

  it('accepts null, clearing the text', () => {
    expect(errorsFor(null)).toHaveLength(0);
  });

  it('accepts undefined (field omitted)', () => {
    const dto = plainToInstance(UpdatePartnerAboutDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts exactly the 2000-character cap', () => {
    expect(errorsFor('a'.repeat(2000))).toHaveLength(0);
  });

  it('rejects text past the 2000-character cap', () => {
    expect(errorsFor('a'.repeat(2001))).toHaveLength(1);
  });

  it('rejects a non-string, non-null value', () => {
    expect(errorsFor(12345)).toHaveLength(1);
  });
});

describe('ReplacePartnerOfferingsDto', () => {
  const errorsFor = (offerings: unknown) => {
    const dto = plainToInstance(ReplacePartnerOfferingsDto, { offerings });
    return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  };

  const valid = { name: 'Espresso', description: 'Double shot', price: '1500' };

  it('accepts a well-formed list', () => {
    expect(errorsFor([valid, { name: 'Latte', price: '2000' }])).toHaveLength(0);
  });

  it('accepts an empty list — clearing every offering', () => {
    expect(errorsFor([])).toHaveLength(0);
  });

  it('accepts an offering with no description', () => {
    expect(errorsFor([{ name: 'Espresso', price: '1500' }])).toHaveLength(0);
  });

  it('rejects a blank name', () => {
    expect(errorsFor([{ ...valid, name: '' }])).toHaveLength(1);
  });

  it('rejects a name past 120 characters', () => {
    expect(errorsFor([{ ...valid, name: 'a'.repeat(121) }])).toHaveLength(1);
  });

  it('rejects a description past 500 characters', () => {
    expect(errorsFor([{ ...valid, description: 'a'.repeat(501) }])).toHaveLength(1);
  });

  it.each([
    ['-100', 'negative'],
    ['0', 'zero — a priced offering must cost something'],
    ['abc', 'not a number'],
    ['1.00005', 'more precision than the money column stores'],
  ])('rejects an invalid price %p (%s)', (price) => {
    expect(errorsFor([{ ...valid, price }])).toHaveLength(1);
  });

  it('rejects more than 50 offerings', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...valid, name: `Item ${i}` }));
    expect(errorsFor(many)).toHaveLength(1);
  });

  it('accepts exactly 50 offerings', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...valid, name: `Item ${i}` }));
    expect(errorsFor(many)).toHaveLength(0);
  });
});
