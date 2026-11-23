import { maskPhone, normalizeIndianMobile } from './phone.util';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected);
  });

  it.each([
    '',
    '12345',
    '5876543210',
    '98765432101',
    '+1 415 555 0100',
    'abcdefghij',
  ])('rejects %s', (input) => {
    expect(normalizeIndianMobile(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('hides the middle digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
  });
});
