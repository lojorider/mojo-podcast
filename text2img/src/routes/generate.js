import { Router } from 'express';
import { generateImage, processImage } from '../services/image.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const {
      prompt,
      size = '1024x1024',
      steps = 4,
      guidance = 7.5,
      quality = 85,
      optimize = false,
      outputFormat,
      resize = null,
      responsive = false,
      responsiveSizes = [480, 768, 1024, 1920],
      enhancePrompt = true,
      style,
    } = req.body;

    // Validate required field
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required and must be a non-empty string',
      });
    }

    // Validate outputFormat (if specified)
    const validFormats = ['png', 'jpg', 'jpeg', 'webp'];
    if (outputFormat && !validFormats.includes(outputFormat.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `outputFormat must be one of: ${validFormats.join(', ')}`,
      });
    }

    // Generate image
    const genResult = await generateImage(prompt, {
      size,
      steps,
      guidance,
      enhancePrompt,
      style,
    });

    // Process image
    const processed = await processImage(genResult.imageBuffer, {
      outputFormat,
      quality,
      optimize,
      resize,
      responsive,
      responsiveSizes,
    });

    // Determine response format
    const format = req.query.format || 'base64';

    if (format === 'binary') {
      res.set('Content-Type', processed.mimeType);
      res.set('Content-Disposition', `inline; filename="generated.${processed.format}"`);
      return res.send(processed.buffer);
    }

    // Default: base64 JSON response
    const data = {
      image: processed.buffer.toString('base64'),
      format: processed.format,
      width: genResult.width,
      height: genResult.height,
      originalSize: processed.originalSize,
      optimizedSize: processed.optimizedSize,
      savings: processed.savings,
      prompt,
      enhancedPrompt: genResult.enhancedPrompt,
      variants: [],
    };

    if (processed.variants) {
      data.variants = processed.variants.map((v) => ({
        width: v.width,
        image: v.buffer.toString('base64'),
      }));
    }

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
