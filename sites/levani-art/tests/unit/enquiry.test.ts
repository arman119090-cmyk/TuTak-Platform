import { describe, expect, it } from 'vitest';
import { normalizeEnquiry, validateEnquiry } from '@/lib/enquiry';

const valid = {
  name: 'Anna',
  email: 'anna@example.com',
  message: 'Is the Tatev painting available?',
  consent: true,
};

describe('enquiry validation', () => {
  it('accepts a complete enquiry', () => {
    expect(validateEnquiry(normalizeEnquiry(valid))).toEqual({});
  });
  it('requires name, email, message and consent', () => {
    expect(validateEnquiry(normalizeEnquiry({}))).toEqual({
      name: 'required',
      email: 'required',
      message: 'required',
      consent: 'consent',
    });
  });
  it('rejects a malformed email and over-long fields', () => {
    const e = validateEnquiry(normalizeEnquiry({ ...valid, email: 'anna@', message: 'x'.repeat(4001) }));
    expect(e).toEqual({ email: 'email', message: 'tooLong' });
  });
  it('normalises untrusted input: trims, drops unknown reasons, needs literal true for consent', () => {
    const n = normalizeEnquiry({ ...valid, name: '  Anna  ', reason: 'hack', consent: 'yes' });
    expect(n.name).toBe('Anna');
    expect(n.reason).toBe('');
    expect(n.consent).toBe(false);
    expect(normalizeEnquiry(null).name).toBe('');
  });
});
