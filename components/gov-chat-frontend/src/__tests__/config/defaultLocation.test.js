import {
  DISTRICT_CACHE_KEY,
  fillLocationPlaceholder,
  getDefaultLocation,
  getResolvedDistrict
} from '@/config/defaultLocation';

describe('defaultLocation', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.APP_CONFIG;
  });

  it('falls back to the built-in Dhaka default when nothing is configured', () => {
    expect(getDefaultLocation()).toEqual({ name: 'Dhaka', lat: 23.8103, lon: 90.4125 });
  });

  it('reads DEFAULT_LOCATION / LAT / LON from window.APP_CONFIG', () => {
    window.APP_CONFIG = { defaultLocation: 'Naogaon', defaultLat: '24.8033', defaultLon: '88.9347' };
    expect(getDefaultLocation()).toEqual({ name: 'Naogaon', lat: 24.8033, lon: 88.9347 });
  });

  it('ignores malformed coordinates but keeps the configured name', () => {
    window.APP_CONFIG = { defaultLocation: 'Naogaon', defaultLat: 'north', defaultLon: '999' };
    expect(getDefaultLocation()).toEqual({ name: 'Naogaon', lat: 23.8103, lon: 90.4125 });
  });

  it('prefers the fresh geolocation-resolved district over the default', () => {
    window.APP_CONFIG = { defaultLocation: 'Naogaon' };
    localStorage.setItem(DISTRICT_CACHE_KEY, JSON.stringify({ district: 'Rangpur', at: Date.now() }));
    expect(getResolvedDistrict()).toBe('Rangpur');
  });

  it('ignores a stale cached district', () => {
    window.APP_CONFIG = { defaultLocation: 'Naogaon' };
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISTRICT_CACHE_KEY, JSON.stringify({ district: 'Rangpur', at: twoDaysAgo }));
    expect(getResolvedDistrict()).toBe('Naogaon');
  });

  it('fills every {{location}} placeholder in a hidden prompt', () => {
    window.APP_CONFIG = { defaultLocation: 'Naogaon' };
    expect(fillLocationPlaceholder('Drought in {{location}}? Flood map for {{location}}.')).toBe(
      'Drought in Naogaon? Flood map for Naogaon.'
    );
  });

  it('returns non-string or placeholder-free input unchanged', () => {
    expect(fillLocationPlaceholder(null)).toBeNull();
    expect(fillLocationPlaceholder('Weather in Dhaka')).toBe('Weather in Dhaka');
  });
});
