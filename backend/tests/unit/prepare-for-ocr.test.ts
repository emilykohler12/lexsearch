import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareForOcr } from '../../src/modules/ocr/tesseract-ocr-engine.js';

const colorImage = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();

describe('prepareForOcr', () => {
  it('returns a grayscale PNG', async () => {
    const prepared = await prepareForOcr(await colorImage(1600, 1200));
    const meta = await sharp(prepared).metadata();
    expect(meta.format).toBe('png');
    expect(meta.channels).toBe(1);
    expect(meta.width).toBe(1600);
  });

  it('enlarges small images and shrinks huge phone photos', async () => {
    expect((await sharp(await prepareForOcr(await colorImage(600, 400))).metadata()).width).toBe(1200);
    expect((await sharp(await prepareForOcr(await colorImage(4000, 3000))).metadata()).width).toBe(3000);
  });

  it('applies the rotation recorded by the phone camera', async () => {
    // A landscape picture taken with the phone held upright (EXIF orientation 6 = rotate 90°).
    const rotated = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(await prepareForOcr(rotated)).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
  });
});
