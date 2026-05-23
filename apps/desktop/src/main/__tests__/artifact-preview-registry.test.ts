/**
 * Tests for the PR-UI-RENDER-3a artifact preview registry.
 *
 * Locks the pure-classifier contract @kenji signed off on
 * (#my-ai:2f91befb msg 2aa3cfc3 + msg adc10d66 + msg 9cf1ca7a). Each
 * test pins one row of the resolution truth table so a future PR
 * adding (say) SVG or HEIC can't silently re-classify existing
 * inputs.
 *
 * Imported via `@maka/ui/artifact-preview-registry` subpath so
 * node:test doesn't load the React barrel.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  IMAGE_PAYLOAD_MAX_BASE64_LENGTH,
  IMAGE_PAYLOAD_MAX_BYTES,
  exceedsImagePayloadCap,
  formatPreviewSize,
  resolvePreviewKind,
} from '@maka/ui/artifact-preview-registry';

describe('resolvePreviewKind — kind gate', () => {
  it('file kind → unsupported(kind_disallowed)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'log.txt', kind: 'file' }),
      { kind: 'unsupported', reason: 'kind_disallowed' },
    );
  });
  it('diff kind → unsupported(kind_disallowed)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'patch.diff', kind: 'diff' }),
      { kind: 'unsupported', reason: 'kind_disallowed' },
    );
  });
  it('html kind → unsupported(kind_disallowed)', () => {
    // PR-RENDER-3a explicitly excludes html. Future PR-RENDER-3c
    // will add it; until then the registry rejects it cleanly.
    assert.deepEqual(
      resolvePreviewKind({ name: 'page.html', kind: 'html', mimeType: 'text/html' }),
      { kind: 'unsupported', reason: 'kind_disallowed' },
    );
  });
  it('pdf kind → unsupported(kind_disallowed)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'doc.pdf', kind: 'pdf', mimeType: 'application/pdf' }),
      { kind: 'unsupported', reason: 'kind_disallowed' },
    );
  });
});

describe('resolvePreviewKind — image MIME match', () => {
  const mimes = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
  ] as const;
  for (const mime of mimes) {
    it(`accepts ${mime}`, () => {
      assert.deepEqual(
        resolvePreviewKind({ name: 'untitled', kind: 'image', mimeType: mime }),
        { kind: 'image', reason: 'mime_match' },
      );
    });
  }
  it('is case-insensitive on MIME', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.png', kind: 'image', mimeType: 'IMAGE/PNG' }),
      { kind: 'image', reason: 'mime_match' },
    );
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.png', kind: 'image', mimeType: 'Image/Png' }),
      { kind: 'image', reason: 'mime_match' },
    );
  });
  it('trims whitespace on MIME', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.png', kind: 'image', mimeType: '  image/png  ' }),
      { kind: 'image', reason: 'mime_match' },
    );
  });
});

describe('resolvePreviewKind — image ext fallback', () => {
  const exts = [
    ['.png', 'shot.png'],
    ['.jpg', 'photo.jpg'],
    ['.jpeg', 'photo.jpeg'],
    ['.gif', 'sticker.gif'],
    ['.webp', 'modern.webp'],
    ['.avif', 'newest.avif'],
  ];
  for (const [ext, name] of exts) {
    it(`accepts ${ext} via filename when no MIME`, () => {
      assert.deepEqual(
        resolvePreviewKind({ name, kind: 'image' }),
        { kind: 'image', reason: 'ext_fallback' },
      );
    });
  }
  it('is case-insensitive on ext', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.PNG', kind: 'image' }),
      { kind: 'image', reason: 'ext_fallback' },
    );
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.JpEg', kind: 'image' }),
      { kind: 'image', reason: 'ext_fallback' },
    );
  });
  it('does NOT fall back to ext when MIME matched', () => {
    // MIME is authoritative: even if ext is `.png`, mime `image/png`
    // is what resolved it.
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.png', kind: 'image', mimeType: 'image/png' }),
      { kind: 'image', reason: 'mime_match' },
    );
  });
});

describe('resolvePreviewKind — disallowed image MIMEs', () => {
  it('image/svg+xml → unsupported(mime_disallowed) [deferred to PR-RENDER-3b]', () => {
    // The SVG defer is the load-bearing PR-RENDER-3a boundary.
    // If this test starts failing it means someone allowed SVG
    // without going through the sanitizer / sandbox PR. Stop them.
    assert.deepEqual(
      resolvePreviewKind({ name: 'icon.svg', kind: 'image', mimeType: 'image/svg+xml' }),
      { kind: 'unsupported', reason: 'mime_disallowed' },
    );
  });
  it('image/heic → unsupported(mime_disallowed)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'photo.heic', kind: 'image', mimeType: 'image/heic' }),
      { kind: 'unsupported', reason: 'mime_disallowed' },
    );
  });
  it('image/bmp → unsupported(mime_disallowed)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'old.bmp', kind: 'image', mimeType: 'image/bmp' }),
      { kind: 'unsupported', reason: 'mime_disallowed' },
    );
  });
  it('disallowed MIME does NOT fall back to ext (MIME is authoritative when present)', () => {
    // Filename says .png but MIME says svg+xml → trust MIME, reject.
    assert.deepEqual(
      resolvePreviewKind({ name: 'tricky.png', kind: 'image', mimeType: 'image/svg+xml' }),
      { kind: 'unsupported', reason: 'mime_disallowed' },
    );
  });
});

describe('resolvePreviewKind — no MIME, no usable ext', () => {
  it('image kind with no MIME and no ext → unsupported(no_mime_no_ext)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'untitled', kind: 'image' }),
      { kind: 'unsupported', reason: 'no_mime_no_ext' },
    );
  });
  it('image kind with non-image ext → unsupported(no_mime_no_ext)', () => {
    // `.heic` is real but disallowed here. Without MIME, we treat
    // it as "no usable ext" rather than mime_disallowed.
    assert.deepEqual(
      resolvePreviewKind({ name: 'photo.heic', kind: 'image' }),
      { kind: 'unsupported', reason: 'no_mime_no_ext' },
    );
  });
  it('empty name → unsupported(no_mime_no_ext)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: '', kind: 'image' }),
      { kind: 'unsupported', reason: 'no_mime_no_ext' },
    );
  });
  it('name with trailing dot only → unsupported(no_mime_no_ext)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'shot.', kind: 'image' }),
      { kind: 'unsupported', reason: 'no_mime_no_ext' },
    );
  });
  it('name with leading dot only (no ext, dotfile) → unsupported(no_mime_no_ext)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: '.hidden', kind: 'image' }),
      { kind: 'unsupported', reason: 'no_mime_no_ext' },
    );
  });
});

describe('resolvePreviewKind — oversize gate', () => {
  it('sizeBytes > cap → unsupported(oversize) BEFORE attempting load', () => {
    assert.deepEqual(
      resolvePreviewKind({
        name: 'huge.png',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: IMAGE_PAYLOAD_MAX_BYTES + 1,
      }),
      { kind: 'unsupported', reason: 'oversize' },
    );
  });
  it('sizeBytes exactly at cap → image (boundary inclusive)', () => {
    assert.deepEqual(
      resolvePreviewKind({
        name: 'edge.png',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: IMAGE_PAYLOAD_MAX_BYTES,
      }),
      { kind: 'image', reason: 'mime_match' },
    );
  });
  it('undefined sizeBytes → no oversize reject (L2 cap kicks in later)', () => {
    assert.deepEqual(
      resolvePreviewKind({ name: 'unknown.png', kind: 'image', mimeType: 'image/png' }),
      { kind: 'image', reason: 'mime_match' },
    );
  });
});

describe('exceedsImagePayloadCap — L2 post-load gate', () => {
  it('returns true on oversize base64', () => {
    // String length comparison is O(1); we never need to actually
    // create a 2MB+ base64 here — just go past the threshold.
    const oversize = 'A'.repeat(IMAGE_PAYLOAD_MAX_BASE64_LENGTH + 1);
    assert.equal(exceedsImagePayloadCap(oversize), true);
  });
  it('returns false at the threshold', () => {
    const atCap = 'A'.repeat(IMAGE_PAYLOAD_MAX_BASE64_LENGTH);
    assert.equal(exceedsImagePayloadCap(atCap), false);
  });
  it('returns false on small payloads', () => {
    assert.equal(exceedsImagePayloadCap(''), false);
    assert.equal(exceedsImagePayloadCap('abcd'), false);
  });
  it('returns true for non-string inputs (fail closed)', () => {
    // @ts-expect-error — intentional bad input
    assert.equal(exceedsImagePayloadCap(null), true);
    // @ts-expect-error — intentional bad input
    assert.equal(exceedsImagePayloadCap(undefined), true);
    // @ts-expect-error — intentional bad input
    assert.equal(exceedsImagePayloadCap(42), true);
  });
});

describe('formatPreviewSize', () => {
  it('handles bytes', () => {
    assert.equal(formatPreviewSize(0), '0 B');
    assert.equal(formatPreviewSize(512), '512 B');
    assert.equal(formatPreviewSize(1023), '1023 B');
  });
  it('handles kilobytes', () => {
    assert.equal(formatPreviewSize(1024), '1.0 KB');
    assert.equal(formatPreviewSize(2048), '2.0 KB');
    assert.equal(formatPreviewSize(1024 * 100), '100.0 KB');
  });
  it('handles megabytes', () => {
    assert.equal(formatPreviewSize(1024 * 1024), '1.0 MB');
    assert.equal(formatPreviewSize(IMAGE_PAYLOAD_MAX_BYTES), '2.0 MB');
  });
  it('returns 未知大小 for undefined / negative / NaN', () => {
    assert.equal(formatPreviewSize(undefined), '未知大小');
    assert.equal(formatPreviewSize(-1), '未知大小');
    assert.equal(formatPreviewSize(NaN), '未知大小');
    assert.equal(formatPreviewSize(Infinity), '未知大小');
  });
});

describe('PR-RENDER-3a boundary lock — explicitly NOT in the registry yet', () => {
  // These tests are documentation as much as assertion. If anyone
  // adds SVG / HTML / Mermaid support to the resolver without an
  // accompanying PR-RENDER-3b/c/d, these tests fail and surface
  // the scope creep.
  it('image/svg+xml is rejected (PR-RENDER-3b boundary)', () => {
    assert.equal(
      resolvePreviewKind({ name: 'icon.svg', kind: 'image', mimeType: 'image/svg+xml' }).kind,
      'unsupported',
    );
  });
  it('html kind is rejected (PR-RENDER-3c boundary)', () => {
    assert.equal(resolvePreviewKind({ name: 'page.html', kind: 'html' }).kind, 'unsupported');
  });
  it('pdf kind is rejected (PR-RENDER-3 future boundary)', () => {
    assert.equal(resolvePreviewKind({ name: 'doc.pdf', kind: 'pdf' }).kind, 'unsupported');
  });
});
