/**
 * SynapseJS - On-Demand Image Optimizer
 *
 * Provides dynamic, safe image resizing and format conversion.
 * Uses dynamic import for `sharp` so Docker Alpine environments without
 * heavy native C/C++ compilation overhead fall back gracefully to passthrough
 * without crashing or breaking the runtime.
 */

export interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
}

export interface ImageOptimizationResult {
  data: Uint8Array;
  contentType: string;
  isOptimized: boolean;
  engine: 'sharp' | 'passthrough';
}

/**
 * Optimizes an image buffer on-demand.
 * If `sharp` is available in node_modules, resizes/converts formats.
 * If `sharp` is absent (Air-Gap mode / minimal container), returns input unaltered.
 */
export async function optimizeImage(
  input: Uint8Array | ArrayBuffer | Buffer,
  contentType: string,
  options: ImageOptimizationOptions = {}
): Promise<ImageOptimizationResult> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input as Uint8Array);

  try {
    // Dynamic import: if sharp is not installed, does not throw unhandled exception
    const sharpPkg = 'sharp';
    // biome-ignore lint/suspicious/noExplicitAny: optional native module boundary
    const sharpModule: any = await import(sharpPkg).then((m) => m.default || m).catch(() => null);

    if (sharpModule) {
      let pipeline = sharpModule(buf);

      if (options.width || options.height) {
        pipeline = pipeline.resize({
          width: options.width,
          height: options.height,
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      const targetFormat = options.format || 'webp';
      if (targetFormat === 'webp') {
        pipeline = pipeline.webp({ quality: options.quality || 80 });
      } else if (targetFormat === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: options.quality || 80 });
      } else if (targetFormat === 'png') {
        pipeline = pipeline.png({ quality: options.quality || 80 });
      } else if (targetFormat === 'avif') {
        pipeline = pipeline.avif({ quality: options.quality || 80 });
      }

      const optimizedBuffer = await pipeline.toBuffer();
      return {
        data: new Uint8Array(optimizedBuffer),
        contentType: `image/${targetFormat}`,
        isOptimized: true,
        engine: 'sharp'
      };
    }
  } catch {
    // Fall back to passthrough if native binary fails to execute
  }

  return {
    data: new Uint8Array(buf),
    contentType: contentType || 'application/octet-stream',
    isOptimized: false,
    engine: 'passthrough'
  };
}
