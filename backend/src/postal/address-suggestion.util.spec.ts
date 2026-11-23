import { suggestAddressLines } from './address-suggestion.util';

describe('suggestAddressLines', () => {
  it('puts house number + road on line 1 and the area on line 2', () => {
    expect(
      suggestAddressLines({
        house_number: '12/3',
        road: 'Kondhwa Main Road',
        neighbourhood: 'Bhairoba Nagar',
        suburb: 'Kondhwa',
      }),
    ).toEqual({
      addressLine1: '12/3 Kondhwa Main Road',
      addressLine2: 'Bhairoba Nagar',
    });
  });

  it('leads with a building name when there is one', () => {
    expect(
      suggestAddressLines({
        building: 'Sai Heights',
        road: 'MG Road',
        suburb: 'Camp',
      }),
    ).toEqual({ addressLine1: 'Sai Heights, MG Road', addressLine2: 'Camp' });
  });

  it('falls back to the area as line 1 when there is no road', () => {
    expect(suggestAddressLines({ suburb: 'Kondhwa Budruk' })).toEqual({
      addressLine1: 'Kondhwa Budruk',
      addressLine2: null,
    });
  });

  it('returns nulls when the point has nothing usable (or no address at all)', () => {
    expect(
      suggestAddressLines({ country_code: 'in', postcode: '411048' }),
    ).toEqual({
      addressLine1: null,
      addressLine2: null,
    });
    expect(suggestAddressLines(undefined)).toEqual({
      addressLine1: null,
      addressLine2: null,
    });
  });

  it('ignores non-string values and trims whitespace', () => {
    expect(
      suggestAddressLines({
        road: '  MG Road ',
        house_number: 42,
        suburb: null,
      }),
    ).toEqual({ addressLine1: 'MG Road', addressLine2: null });
  });

  it('never exceeds the form field limit', () => {
    const long = 'x'.repeat(500);
    expect(suggestAddressLines({ road: long }).addressLine1).toHaveLength(200);
  });
});
