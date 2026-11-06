// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// saveBlob — the blob → file hand-off.
//
// WHY THIS SUITE EXISTS: the download path for a protected file runs through
// the authenticated client (the browser cannot navigate to the route — it
// sends no Authorization header). The content arrives as a Blob and this
// helper is what turns it into a file on the user's disk. Two things are
// load-bearing and therefore pinned here:
//
//   1. the anchor is CLICKED — a blob that is never handed to the browser
//      downloads nothing, and the failure is silent;
//   2. the object URL is revoked on the NEXT task, not in this one —
//      revoking it in the same task as the click can cancel the browser's
//      asynchronous blob snapshot and the download arrives empty
//      (the house pattern, okfRepoOps.exportRepoZip, round 16 / #80128).

import { saveBlob } from '@/utils/fileDownload';

describe('saveBlob', () => {
  let createObjectURL;
  let revokeObjectURL;
  let clicked;
  let anchor;

  beforeEach(() => {
    clicked = [];
    anchor = { href: '', download: '', click: jest.fn(), remove: jest.fn() };
    createObjectURL = jest.fn(() => 'blob:mock-url');
    revokeObjectURL = jest.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    // The anchor's click is what starts the download.
    anchor.click = jest.fn(() => clicked.push(anchor.href));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('it hands the blob to the browser under the given file name', () => {
    const blob = { size: 2 };
    const name = saveBlob(blob, 'kenya-v18.zip');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('kenya-v18.zip');
    expect(clicked).toEqual(['blob:mock-url']);
    expect(name).toBe('kenya-v18.zip');
  });

  test('it falls back to a generic name when none is given', () => {
    saveBlob({ size: 1 });
    expect(anchor.download).toBe('download');
  });

  test('it refuses a missing blob (the caller must not save nothing)', () => {
    expect(() => saveBlob(null, 'x.zip')).toThrow();
  });

  test('the object URL is revoked on the NEXT task, not in this one', async () => {
    saveBlob({ size: 1 }, 'x.zip');
    // Not yet — revoking now can cancel the browser's blob snapshot.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
