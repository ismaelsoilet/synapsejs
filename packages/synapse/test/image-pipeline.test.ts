import { describe, expect, it } from 'bun:test';
import { optimizeImage } from '../src/core/image-optimizer';

/**
 * The image pipeline, exercised against a real PNG.
 *
 * The framework deliberately treats `sharp` as optional: when it is present the
 * pipeline resizes and converts, and when it is absent the documented behaviour is a
 * byte-identical passthrough. Both branches are real shipped behaviour, so the test
 * asserts the branch that actually ran instead of passing against a stub — and it
 * states which one it was.
 */

/** A 1×1 red PNG, built by hand so the test does not depend on a fixture binary. */
function onePixelPng(): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData) >>> 0, 0);

    return Buffer.concat([length, typeAndData, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.from([0x00, 0xff, 0x00, 0x00]);
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([header, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

describe('image optimization pipeline', () => {
  it('resizes and converts when the conversion engine is present, and passes bytes through when it is not', async () => {
    const png = onePixelPng();

    const result = await optimizeImage(png, 'image/png', { width: 32, height: 32, format: 'webp' });

    if (result.engine === 'sharp') {
      // A real conversion: the bytes changed and the content type follows the format.
      expect(result.contentType).toBe('image/webp');
      expect(result.data.byteLength).toBeGreaterThan(0);
      expect(Buffer.compare(Buffer.from(result.data), png)).not.toBe(0);
      return;
    }

    // Documented fallback: unaltered bytes, original content type, and it says so.
    expect(result.engine).toBe('passthrough');
    expect(result.contentType).toBe('image/png');
    expect(Buffer.compare(Buffer.from(result.data), png)).toBe(0);
  });

  it('is deterministic for the same input and options', async () => {
    const png = onePixelPng();

    const first = await optimizeImage(png, 'image/png', { width: 16, format: 'png' });
    const second = await optimizeImage(png, 'image/png', { width: 16, format: 'png' });

    expect(first.engine).toBe(second.engine);
    expect(first.contentType).toBe(second.contentType);
    expect(first.data.byteLength).toBe(second.data.byteLength);
  });
});
