'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { readCentralDirectory, extractEntry } = require('../../../services/agri/zip');
const pinkSheet = require('../../../services/agri/adapters/pink-sheet');
const imfPcps = require('../../../services/agri/adapters/imf-pcps');
const faostatPp = require('../../../services/agri/adapters/faostat-pp');
const faostatSdg = require('../../../services/agri/adapters/faostat-sdg');

/** Build a minimal valid ZIP with STORED (method 0) entries for tests. */
function buildStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(data, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (valid DOS date)
    local.writeUInt32LE(0, 14); // crc (not validated by our reader)
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 4);
    central.writeUInt16LE(0, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(Buffer.concat([local, nameBuf, dataBuf]));
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

describe('agri zip reader', () => {
  test('reads central directory and extracts stored entries', async () => {
    const zip = buildStoredZip([
      { name: 'a.csv', data: 'hello,world\n1,2' },
      { name: 'b/nested.csv', data: 'x\n7' }
    ]);
    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.csv', 'b/nested.csv']);
    expect((await extractEntry(zip, 'a.csv')).toString()).toBe('hello,world\n1,2');
    expect((await extractEntry(zip, 'nested.csv')).toString()).toBe('x\n7'); // suffix match
  });

  test('throws a clear error for missing entries', async () => {
    const zip = buildStoredZip([{ name: 'a.csv', data: 'x' }]);
    await expect(extractEntry(zip, 'missing.csv')).rejects.toThrow('entry not found');
  });
});

describe('pink-sheet adapter', () => {
  // sheet_to_json(header:1) shape: rows of cells; row 4 = date headers
  const rows = [
    [],
    [],
    [],
    [],
    [null, '2026M07', '2026M08'],
    ['Urea ', null, 390],
    ['DAP ', null, 793.5],
    ['Potassium chloride ', null, 386.9],
    ['Chicken ', null, 1.69],
    ['Oil, Brent ', null, 999] // not tracked -> skipped
  ];

  test('maps known commodity rows to keyed monthly docs', () => {
    const { collection, docs } = pinkSheet.normalize(rows);
    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(4);
    const urea = docs.find((d) => d.key === 'WB:UREA');
    expect(urea.date).toBe('2026-08-01');
    expect(urea.value).toBe(390);
    expect(urea.unit).toBe('USD/mt');
    expect(docs.find((d) => d.key === 'WB:CHICKEN_INTL').value).toBe(1.69);
  });

  test('parses Excel serial date headers too', () => {
    const serialRows = [[], [], [], [], [null, null, 46235], ['Urea ', null, 400]];
    const { docs } = pinkSheet.normalize(serialRows);
    expect(docs).toHaveLength(1);
    expect(docs[0].date).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('imf-pcps adapter', () => {
  const rows = [
    ['Commodity', new Date('2026-08-01T00:00:00Z')],
    ['Urea', 232.37],
    ['Potassium chloride', 398.2],
    ['Poultry', 164.9],
    ['Some untracked index', 500]
  ];

  test('maps PCPS rows with Date headers', () => {
    const { collection, docs } = imfPcps.normalize(rows);
    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(3);
    expect(docs.find((d) => d.key === 'IMF:UREA').date).toBe('2026-08-01');
    expect(docs.find((d) => d.key === 'IMF:POULTRY').unit).toBe('index 2016=100');
  });
});

describe('faostat-pp adapter (zip fixture)', () => {
  const csv = [
    '"Area Code","Area","Element Code","Element","Item Code","Item","Year Code","Year","Unit","Value","Flag"',
    '"60","El Salvador","5532","Producer Price (USD/tonne)","0066","Natural honey","2022","2022","USD","3430"," "',
    '"60","El Salvador","5530","Producer Price (SLC/tonne)","0066","Natural honey","2022","2022","SLC","3430"," "',
    '"60","El Salvador","5532","Producer Price (USD/tonne)","0001","Wheat","2023","2023","USD","5000"," "',
    '"97","Honduras","5532","Producer Price (USD/tonne)","0388","Tomatoes","2024","2024","USD","1209"," "',
    '"60","El Salvador","5532","Producer Price (USD/tonne)","0304","Meat of chicken","2018","2018","USD","2500"," "',
    '"222","Brazil","5532","Producer Price (USD/tonne)","0056","Maize (corn)","2023","2023","USD","300"," "' // area 222 untracked
  ].join('\n');

  test('extracts, filters by area/element/item, converts to USD/kg', async () => {
    const zip = buildStoredZip([{ name: 'Prices_E_All_Data_(Normalized).csv', data: csv }]);
    const parsed = await faostatPp.parse(zip);
    const { collection, docs } = await faostatPp.normalize(parsed);

    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(3); // LCU row, untracked item, Brazil excluded
    const honey = docs.find((d) => d.item === 'Natural honey');
    expect(honey.usdPerKg).toBeCloseTo(3.43, 3);
    expect(honey.year).toBe(2022);
    expect(docs.find((d) => d.country === 'Honduras').year).toBe(2024);
  });
});

describe('faostat-sdg adapter (zip fixture)', () => {
  const csv = [
    '"Area Code","Area","Element Code","Item Code","Item","Year","Value","Flag"',
    '"5872","Central America","61281","00125","Food Loss (12.3.1)","2023","16.5","E"',
    '"5873","South America","61281","00125","Food Loss (12.3.1)","2023","11.0","E"',
    '"5872","Central America","61281","00125","Other indicator","2023","99.0"," "'
  ].join('\n');

  test('keeps Central America SDG 12.3.1 rows only', async () => {
    const zip = buildStoredZip([{ name: 'SDG_BulkDownloads_E_All_Data_(Normalized).csv', data: csv }]);
    const rows = await faostatSdg.parse(zip);
    const { collection, docs } = faostatSdg.normalize(rows);
    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(1);
    expect(docs[0].value).toBe(16.5);
    expect(docs[0].key).toBe('FAOSTAT:SDG:Central America');
  });
});
