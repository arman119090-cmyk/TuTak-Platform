import { parseRoster } from '../lib/roster';

describe('roster paste parsing', () => {
  it('reads phone, profile id and names from comma-, semicolon- or tab-separated lines', () => {
    expect(
      parseRoster(
        '+37491000001, abc123, Ara, Sargsyan\n+37491000002;def456\n+37491000003\tghi789\tNarek',
      ),
    ).toEqual([
      {
        phone: '+37491000001',
        externalProfileId: 'abc123',
        firstName: 'Ara',
        lastName: 'Sargsyan',
      },
      { phone: '+37491000002', externalProfileId: 'def456' },
      { phone: '+37491000003', externalProfileId: 'ghi789', firstName: 'Narek' },
    ]);
  });

  it('skips blank lines and a header, and trims cells', () => {
    expect(parseRoster('phone,profile\n\n  +37491000001 ,  abc123  \n')).toEqual([
      { phone: '+37491000001', externalProfileId: 'abc123' },
    ]);
  });

  it('keeps an incomplete row so the API can report it by number', () => {
    expect(parseRoster('+37491000001')).toEqual([{ phone: '+37491000001', externalProfileId: '' }]);
  });
});
