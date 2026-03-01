import { Router } from 'express';
import multer from 'multer';
import { optimizeImage, getMimeType } from '../services/optimize.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    upload.single('image')(req, res, (err) => {
      if (err) return next(err);
      handleOptimize(req, res, next);
    });
  } else {
    handleOptimize(req, res, next);
  }
});

async function handleOptimize(req, res, next) {
  try {
    // Extract image buffer from multipart or JSON
    let imageBuffer;

    if (req.file) {
      imageBuffer = req.file.buffer;
    } else if (req.body?.image) {
      imageBuffer = Buffer.from(req.body.image, 'base64');
    } else {
      return res.status(400).json({
        success: false,
        error: 'image is required (file upload or base64 string)',
      });
    }

    // Parse options
    const options = {};

    // Resize
    let resize = req.body?.resize;
    if (typeof resize === 'string') {
      try { resize = JSON.parse(resize); } catch { /* ignore */ }
    }
    if (resize && (resize.width || resize.height)) {
      options.resize = {
        width: parseInt(resize.width) || undefined,
        height: parseInt(resize.height) || undefined,
      };
    }

    // Format
    const format = req.file ? (req.body?.format || 'png') : (req.body?.format || 'png');
    options.format = format;

    // Quality
    if (req.body?.quality) {
      options.quality = parseInt(req.body.quality);
    }

    // Fit
    if (req.body?.fit) {
      options.fit = req.body.fit;
    }

    const result = await optimizeImage(imageBuffer, options);

    // Response format
    const responseFormat = req.query.format || 'base64';

    if (responseFormat === 'binary') {
      res.set('Content-Type', getMimeType(result.metadata.format));
      res.set('Content-Disposition', `inline; filename="optimized.${result.metadata.format}"`);
      return res.send(result.buffer);
    }

    // Default: base64 JSON response
    res.json({
      success: true,
      data: {
        image: result.buffer.toString('base64'),
        ...result.metadata,
      },
    });
  } catch (err) {
    next(err);
  }
}

export default router;
