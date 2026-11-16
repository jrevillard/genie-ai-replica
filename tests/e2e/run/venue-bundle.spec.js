// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  handlesIn,
  bundleServesHandle,
  parseChunkNaming,
  chunkPaths,
  checkoutDeclaredHandles,
  fetchVenueBundleText
} = require('./venue-bundle');

/**
 * Unit spec for the venue's served bundle read.
 *
 * The read is what tells a stale venue from a product defect (#1895,
 * #1896): a spec waits for a handle the app declares, and the venue's
 * build predates the declaration. A read that says "the venue does not
 * serve it" when it does — or the other way round — files a product bug
 * that is not one, or hides one that is.
 *
 * Every function here is pure or takes its transport as an argument, so
 * the whole contract is pinned here without a browser and without a
 * venue.
 */
test.describe('the handles a source text declares', () => {
  test('a static binding names a handle', () => {
    expect(handlesIn('<div data-testid="chat-history-item">')).toEqual(['chat-history-item']);
    expect(handlesIn('<div data-test-id="upload-files-dialog-confirm">')).toEqual(['upload-files-dialog-confirm']);
  });

  test('a DYNAMIC binding names no handle — its value is not known at build time', () => {
    // A dynamic value cannot be looked up in a bundle, so treating it as
    // a declaration would put a handle in the checkout's set that no
    // build ever carries.
    expect(handlesIn('<div :data-testid="row.kind">')).toEqual([]);
    expect(handlesIn('<div :data-test-id="row.kind">')).toEqual([]);
  });

  test('every declaration in a text is found, in order', () => {
    const source = '<a data-testid="one"></a><b data-test-id="two"></b>';
    expect(handlesIn(source)).toEqual(['one', 'two']);
  });
});

test.describe('the served bundle carries a handle as a QUOTED value', () => {
  test('a bundle that carries the handle serves it', () => {
    expect(bundleServesHandle('...{"data-testid":"chat-history-item"}...', 'chat-history-item')).toBe(true);
  });

  test('a bundle that carries only the LONGER handle does not serve the shorter one', () => {
    // The bare search would say "served" here and hide the stale venue —
    // the exact direction that costs a misfiled product bug.
    const bundle = '{"data-test-id":"upload-files-dialog-confirm"}';
    expect(bundleServesHandle(bundle, 'upload-files-dialog-confirm')).toBe(true);
    expect(bundleServesHandle(bundle, 'upload-files-dialog')).toBe(false);
  });
});

test.describe('the chunk naming the served app bundle carries', () => {
  const SERVED = '...i.u=e=>"js/"+({244:"fm"}[e]||e)+"."+{73:"7f541a03",244:"65fd7075",169:"bcc3c56e"}[e]+".js"...';

  test('the hash map is read, and the name map beside it', () => {
    const naming = parseChunkNaming(SERVED);
    expect(naming.hashes.get('73')).toBe('7f541a03');
    expect(naming.hashes.get('169')).toBe('bcc3c56e');
    expect(naming.names.get('244')).toBe('fm');
  });

  test('a chunk served under another NAME is asked for by that name', () => {
    // The venue serves `fm.<hash>.js`; asking for `244.<hash>.js` would
    // fetch the SPA's fallback page and call the chunk missing.
    expect(chunkPaths(SERVED)).toEqual(['/js/73.7f541a03.js', '/js/fm.65fd7075.js', '/js/169.bcc3c56e.js']);
  });

  test('a bundle with no chunk template names no chunks', () => {
    expect(parseChunkNaming('no template here')).toBe(null);
    expect(chunkPaths('no template here')).toBe(null);
  });

  test('a template with no name map is read by its hash map alone', () => {
    const naming = parseChunkNaming('i.u=e=>"js/"+e+"."+{73:"7f541a03"}[e]+".js"');
    expect(naming.hashes.get('73')).toBe('7f541a03');
    expect(naming.names).toBe(null);
    expect(chunkPaths('i.u=e=>"js/"+e+"."+{73:"7f541a03"}[e]+".js"')).toEqual(['/js/73.7f541a03.js']);
  });
});

test.describe('the walk reads the venue and every chunk it names', () => {
  const INDEX = '<html><script defer src="/js/app.1229e2fc.js"></script></html>';
  const APP = 'i.u=e=>"js/"+({244:"fm"}[e]||e)+"."+{73:"7f541a03",244:"65fd7075"}[e]+".js"';

  const transport = (bodies) => async (_method, url) => {
    const key = Object.keys(bodies).find((candidate) => url.endsWith(candidate));
    if (key === undefined) return { status: 404, data: 'not found' };
    return { status: 200, data: bodies[key] };
  };

  test('the app bundle and every chunk it names are read', async () => {
    const text = await fetchVenueBundleText('https://venue.example:4443', {
      request: transport({
        '/': INDEX,
        '/js/app.1229e2fc.js': APP,
        '/js/73.7f541a03.js': '"chunk-one"',
        '/js/fm.65fd7075.js': '"chunk-two"'
      })
    });
    expect(text).toContain('"chunk-one"');
    expect(text).toContain('"chunk-two"');
    expect(text).toContain('i.u=e=>');
  });

  test('a chunk the venue does not serve makes the walk INCOMPLETE, not "the handle is absent"', async () => {
    // An incomplete walk cannot say a handle is missing — the handle may
    // live in the chunk that failed. The walk throws, and the caller
    // degrades to filing the failures as they are.
    await expect(
      fetchVenueBundleText('https://venue.example:4443', {
        request: transport({
          '/': INDEX,
          '/js/app.1229e2fc.js': APP,
          '/js/73.7f541a03.js': '"chunk-one"'
        })
      })
    ).rejects.toThrow(/fm\.65fd7075\.js/);
  });

  test('a chunk the edge answers with the SPA fallback page is NOT the chunk', async () => {
    // The edge rewrites a missing asset to the SPA's index with HTTP
    // 200 (`proxy_intercept_errors on; error_page 404 = @frontend_spa;`).
    // A walk that believed the status would call itself complete on a
    // chunk it never read, and then report a handle living in that chunk
    // as ABSENT — the direction that hides a real defect behind a
    // stale-venue verdict.
    await expect(
      fetchVenueBundleText('https://venue.example:4443', {
        request: transport({
          '/': INDEX,
          '/js/app.1229e2fc.js': APP,
          '/js/73.7f541a03.js': '<!DOCTYPE html><html><body>the SPA</body></html>'
        })
      })
    ).rejects.toThrow(/SPA fallback/);
  });

  test('a chunk the venue answers EMPTY is not the chunk either', async () => {
    // An empty body is a chunk the walk never read: the walk would call
    // itself complete on it, and a handle living in that chunk would be
    // reported as absent.
    await expect(
      fetchVenueBundleText('https://venue.example:4443', {
        request: transport({
          '/': INDEX,
          '/js/app.1229e2fc.js': APP,
          '/js/73.7f541a03.js': ''
        })
      })
    ).rejects.toThrow(/empty body/);
  });

  test('a venue that serves no app bundle makes the walk incomplete', async () => {
    await expect(
      fetchVenueBundleText('https://venue.example:4443', {
        request: transport({ '/': '<html></html>' })
      })
    ).rejects.toThrow(/no app bundle/);
  });
});

test.describe('the checkout declares its own handles', () => {
  test('the handles the two stale-venue specs assert are declared by the app', () => {
    const declared = checkoutDeclaredHandles();
    expect(declared.get('chat-history-item')).toBe('components/gov-chat-frontend/src/components/ChatFolders.vue');
    expect(declared.get('upload-files-dialog-confirm')).toBe(
      'components/gov-chat-frontend/src/components/UploadFilesDialog.vue'
    );
  });

  test("the frontend's OWN test tree declares no handle — its mocks are not the app", () => {
    // The frontend's Jest tree declares handles its mocks render
    // (`answer-source-card-0` and friends). The app never ships them, so
    // counting them would put handles in the set that no build carries.
    const declared = checkoutDeclaredHandles();
    expect(declared.has('answer-source-card-0')).toBe(false);
  });

  test('every declared handle lives in the app source tree', () => {
    const declared = checkoutDeclaredHandles();
    expect(declared.size).toBeGreaterThan(0);
    for (const source of declared.values()) {
      expect(source.startsWith('components/gov-chat-frontend/src/')).toBe(true);
      expect(path.isAbsolute(source)).toBe(false);
    }
  });
});
