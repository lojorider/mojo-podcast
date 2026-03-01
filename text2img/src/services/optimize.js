import sharp from 'sharp';

const VALID_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];
const VALID_FITS = ['cover', 'contain', 'fill', 'inside', 'outside'];

export async function optimizeImage(buffer, options = {}) {
  const format = (options.format || 'png').toLowerCase();
  const quality = Math.min(100, Math.max(1, parseInt(options.quality) || 80));
  const fit = VALID_FITS.includes(options.fit) ? options.fit : 'cover';

  if (!VALID_FORMATS.includes(format)) {
    const err = new Error(`format must be one of: ${VALID_FORMATS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const originalSize = buffer.length;
  let processor = sharp(buffer);

  // Resize if requested
  if (options.resize) {
    const { width, height } = options.resize;
    if (width || height) {
      processor = processor.resize(width || null, height || null, {
        fit,
        withoutEnlargement: true,
      });
    }
  }

  // Apply format conversion + quality
  switch (format) {
    case 'webp':
      processor = processor.webp({ quality });
      break;
    case 'avif':
      processor = processor.avif({ quality });
      break;
    case 'jpg':
    case 'jpeg':
      processor = processor.jpeg({ quality, progressive: true });
      break;
    case 'png':
    default:
      processor = processor.png({ compressionLevel: 9 });
      break;
  }

  const outputBuffer = await processor.toBuffer();
  const metadata = await sharp(outputBuffer).metadata();

  const optimizedSize = outputBuffer.length;
  const savings = originalSize > 0
    ? ((1 - optimizedSize / originalSize) * 100).toFixed(1)
    : '0.0';

  return {
    buffer: outputBuffer,
    metadata: {
      format: format === 'jpeg' ? 'jpg' : format,
      width: metadata.width,
      height: metadata.height,
      originalSize,
      optimizedSize,
      savings: `${savings}%`,
    },
  };
}

function getMimeType(format) {
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
  };
  return map[format] || 'image/png';
}

export { getMimeType, VALID_FORMATS, VALID_FITS };
