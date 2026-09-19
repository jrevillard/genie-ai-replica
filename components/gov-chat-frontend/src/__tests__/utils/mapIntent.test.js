'use strict';

const { isBareMapIntent, parseMapPlace } = require('../../utils/mapIntent');

// Same cases as the mobile `geo_utils_test.dart` (isBareMapIntent / parseMapIntent).
describe('isBareMapIntent', () => {
  it.each([
    'show me the map',
    'Show me the map.',
    'show map',
    'open the map',
    'please show me the map',
    'manchitro dekhao',
    'মানচিত্র দেখাও',
    'আমার মানচিত্র দেখান',
    'ম্যাপ দেখাও।'
  ])('matches the bare form %p', (text) => {
    expect(isBareMapIntent(text)).toBe(true);
  });

  it.each([
    'show me the map Rangpur',
    'মানচিত্র দেখাও রংপুর',
    'map my field',
    'What is the weather this week?',
    'show me the map of the world please explain'
  ])('does not match %p', (text) => {
    expect(isBareMapIntent(text)).toBe(false);
  });
});

describe('parseMapPlace', () => {
  it('extracts the place from the English, Banglish and Bengali forms', () => {
    expect(parseMapPlace('show me the map Rangpur')).toBe('Rangpur');
    expect(parseMapPlace("Show Me The Map  Cox's Bazar ")).toBe("Cox's Bazar");
    expect(parseMapPlace('manchitro dekhao Sylhet')).toBe('Sylhet');
    expect(parseMapPlace('মানচিত্র দেখাও রংপুর')).toBe('রংপুর');
    expect(parseMapPlace('রংপুর এর মানচিত্র দেখাও')).toBe('রংপুর');
    expect(parseMapPlace('ঢাকা মানচিত্র দেখান')).toBe('ঢাকা');
  });

  it('returns null for ordinary questions and the bare form', () => {
    expect(parseMapPlace('What is the weather this week in Dhaka?')).toBeNull();
    expect(parseMapPlace('show me the map')).toBeNull();
    expect(parseMapPlace('delineate fields around Bogra')).toBeNull();
  });
});
