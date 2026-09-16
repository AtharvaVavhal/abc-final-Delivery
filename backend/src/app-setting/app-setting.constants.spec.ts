import {
  getAdminSettingDefinition,
  isPublicSettingKey,
  normalizeAdminSettingValue,
} from './app-setting.constants';

describe('app-setting constants — public allowlist & store identity', () => {
  it('exposes storeName to the public storefront read surface', () => {
    expect(isPublicSettingKey('storeName')).toBe(true);
  });

  it('does NOT expose storeAdminName publicly — it is store-owner information', () => {
    expect(isPublicSettingKey('storeAdminName')).toBe(false);
  });

  it('keeps internal keys non-public', () => {
    expect(isPublicSettingKey('order_number_counter')).toBe(false);
    expect(isPublicSettingKey('tax.ratePercent')).toBe(false);
    expect(isPublicSettingKey('invoice.sellerGstin')).toBe(false);
  });

  it('exposes navbar seller identity to the public storefront', () => {
    for (const key of [
      'sellerLegalName',
      'sellerLocality',
      'sellerGstin',
      'sellerPaymentProtected',
    ]) {
      expect(isPublicSettingKey(key)).toBe(true);
      expect(getAdminSettingDefinition(key)?.ownership).toBe('STORE');
    }
    expect(getAdminSettingDefinition('sellerLegalName')).toMatchObject({
      default: 'Identica',
    });
    expect(getAdminSettingDefinition('sellerGstin')).toMatchObject({
      default: '27ARLPM5978P1ZL',
    });
    expect(getAdminSettingDefinition('sellerPaymentProtected')).toMatchObject({
      kind: 'boolean',
      default: 'true',
    });
  });

  it('accepts a valid navbar GSTIN and rejects a malformed one', () => {
    expect(normalizeAdminSettingValue('sellerGstin', '27ARLPM5978P1ZL')).toEqual({
      valid: true,
      value: '27ARLPM5978P1ZL',
    });
    expect(normalizeAdminSettingValue('sellerGstin', 'NOT-A-GSTIN').valid).toBe(
      false,
    );
  });

  it('exposes whatsappNumber to the public storefront read surface', () => {
    expect(isPublicSettingKey('whatsappNumber')).toBe(true);
    expect(getAdminSettingDefinition('whatsappNumber')).toMatchObject({
      kind: 'text',
      default: '',
      ownership: 'STORE',
    });
  });

  it('exposes optional contact, brand story, and featured media publicly', () => {
    for (const key of [
      'storeContactEmail',
      'storeContactPhone',
      'storeAddress',
      'brand_story',
      'featured_media',
    ]) {
      expect(isPublicSettingKey(key)).toBe(true);
      expect(getAdminSettingDefinition(key)).toMatchObject({
        kind: 'text',
        default: '',
        ownership: 'STORE',
      });
    }
  });

  it('exposes storeLogo to the public storefront read surface', () => {
    expect(isPublicSettingKey('storeLogo')).toBe(true);
    expect(getAdminSettingDefinition('storeLogo')).toMatchObject({
      kind: 'text',
      default: '/catalog/logo.png',
      ownership: 'STORE',
    });
  });

  it('accepts a same-origin logo path and an https URL', () => {
    expect(normalizeAdminSettingValue('storeLogo', '/catalog/logo.png')).toEqual({
      valid: true,
      value: '/catalog/logo.png',
    });
    expect(
      normalizeAdminSettingValue('storeLogo', '  https://res.cloudinary.com/demo/image.png  '),
    ).toEqual({
      valid: true,
      value: 'https://res.cloudinary.com/demo/image.png',
    });
  });

  it('rejects a javascript: logo URL', () => {
    expect(normalizeAdminSettingValue('storeLogo', 'javascript:alert(1)').valid).toBe(
      false,
    );
  });

  it('exposes hero_slides as a STORE-owned administrable public setting', () => {
    expect(isPublicSettingKey('hero_slides')).toBe(true);
    expect(getAdminSettingDefinition('hero_slides')).toMatchObject({
      kind: 'text',
      default: '',
      ownership: 'STORE',
    });
  });

  it('normalizes a valid hero slide list', () => {
    const result = normalizeAdminSettingValue(
      'hero_slides',
      JSON.stringify([
        {
          imageUrl: '/catalog/hero-3.jpg',
          headline: 'Acrylic caricatures',
          subtext: 'Made to order',
          ctaText: 'Shop',
          ctaLink: '/products',
        },
      ]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(JSON.parse(result.value)).toEqual([
        {
          imageUrl: '/catalog/hero-3.jpg',
          headline: 'Acrylic caricatures',
          subtext: 'Made to order',
          ctaText: 'Shop',
          ctaLink: '/products',
        },
      ]);
    }
  });

  it('rejects a hero slide without a headline', () => {
    const result = normalizeAdminSettingValue(
      'hero_slides',
      JSON.stringify([{ imageUrl: '/catalog/hero-3.jpg', headline: '' }]),
    );
    expect(result.valid).toBe(false);
  });

  it('declares storeName with the "AB Creations" default and storeAdminName blank', () => {
    expect(getAdminSettingDefinition('storeName')).toMatchObject({
      kind: 'text',
      default: 'AB Creations',
    });
    expect(getAdminSettingDefinition('storeAdminName')).toMatchObject({
      kind: 'text',
      default: '',
    });
  });

  it('normalizes featured media URLs from newlines into JSON', () => {
    const result = normalizeAdminSettingValue(
      'featured_media',
      'https://cdn.example/a.jpg\n/images/studio.jpg',
    );
    expect(result).toEqual({
      valid: true,
      value: JSON.stringify(['https://cdn.example/a.jpg', '/images/studio.jpg']),
    });
  });

  it('rejects a fabricated-looking featured media path that is not a URL or site path', () => {
    const result = normalizeAdminSettingValue('featured_media', 'not a url');
    expect(result.valid).toBe(false);
  });
});
