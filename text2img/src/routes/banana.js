import { Router } from 'express';
import { generateBananaImage, editBananaImage } from '../services/banana.js';
import multer from 'multer';
import { processImage } from '../services/image.js';
import sharp from 'sharp';
import {
  enhanceIconPrompt,
  generateIconSet,
  createIconZip,
  ICON_PRESETS,
} from '../services/icon.js';

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
const VALID_PRESETS = ['appIcon', 'menuBar', 'favicon', 'all'];

router.post('/', async (req, res, next) => {
  try {
    const {
      prompt,
      quality = 85,
      outputFormat,
      resize = null,
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

    // Generate image via Gemini
    const genResult = await generateBananaImage(prompt);

    // Process image (format conversion, resize)
    const processed = await processImage(genResult.imageBuffer, {
      outputFormat,
      quality,
      resize,
    });

    // Determine response format
    const format = req.query.format || 'base64';

    if (format === 'binary') {
      res.set('Content-Type', processed.mimeType);
      res.set('Content-Disposition', `inline; filename="banana.${processed.format}"`);
      return res.send(processed.buffer);
    }

    // Default: base64 JSON response
    res.json({
      success: true,
      data: {
        image: processed.buffer.toString('base64'),
        format: processed.format,
        prompt,
        text: genResult.text || null,
        originalSize: processed.originalSize,
        optimizedSize: processed.optimizedSize,
        savings: processed.savings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Icon Generation via Gemini ─────────────────────────────────────

router.post('/generate/icon', async (req, res, next) => {
  try {
    const {
      prompt,
      preset,
      enhancePrompt: doEnhance = true,
      background = 'transparent',
      cornerRadius = 0.22,
      padding = 0,
      contentFill = 0.85,
    } = req.body;

    // Validate
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required and must be a non-empty string',
      });
    }

    if (!preset || !VALID_PRESETS.includes(preset)) {
      return res.status(400).json({
        success: false,
        error: `preset is required and must be one of: ${VALID_PRESETS.join(', ')}`,
      });
    }

    const iconOptions = { background, cornerRadius, padding, contentFill };
    let icons = [];
    const enhancedPrompts = {};

    if (preset === 'all') {
      const colorPrompt = doEnhance ? enhanceIconPrompt(prompt, 'appIcon') : prompt;
      const monoPrompt = doEnhance ? enhanceIconPrompt(prompt, 'menuBar') : prompt;
      enhancedPrompts.color = colorPrompt;
      enhancedPrompts.menuBar = monoPrompt;

      const [colorResult, monoResult] = await Promise.all([
        generateBananaImage(colorPrompt),
        generateBananaImage(monoPrompt),
      ]);

      const [appIcons, menuIcons, favIcons] = await Promise.all([
        generateIconSet(colorResult.imageBuffer, 'appIcon', iconOptions),
        generateIconSet(monoResult.imageBuffer, 'menuBar', iconOptions),
        generateIconSet(colorResult.imageBuffer, 'favicon', iconOptions),
      ]);
      icons = [...appIcons, ...menuIcons, ...favIcons];
    } else {
      const finalPrompt = doEnhance ? enhanceIconPrompt(prompt, preset) : prompt;
      enhancedPrompts[preset] = finalPrompt;

      const genResult = await generateBananaImage(finalPrompt);
      icons = await generateIconSet(genResult.imageBuffer, preset, iconOptions);
    }

    // Response
    const format = req.query.format || 'base64';

    if (format === 'zip') {
      const zipBuffer = await createIconZip(icons, preset);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="icons-${preset}.zip"`);
      return res.send(zipBuffer);
    }

    res.json({
      success: true,
      data: {
        prompt,
        enhancedPrompts,
        preset,
        icons: icons.map(({ buffer, ...meta }) => ({
          ...meta,
          image: buffer.toString('base64'),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Edit Image via Gemini (send ref image + prompt) ────────────────

router.post('/edit', upload.single('image'), async (req, res, next) => {
  try {
    // Accept image from file upload or base64 in JSON body
    let imageBuffer;
    let inputMime = 'image/png';

    if (req.file) {
      imageBuffer = req.file.buffer;
      inputMime = req.file.mimetype;
    } else if (req.body.image) {
      imageBuffer = Buffer.from(req.body.image, 'base64');
      inputMime = req.body.mimeType || 'image/png';
    } else {
      return res.status(400).json({
        success: false,
        error: 'image is required (upload file or send base64 in body)',
      });
    }

    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required and must be a non-empty string',
      });
    }

    const result = await editBananaImage(imageBuffer, prompt, { mimeType: inputMime });

    // Optional post-processing
    const { outputFormat, quality = 85, resize } = req.body;
    const processed = await processImage(result.imageBuffer, {
      outputFormat,
      quality: parseInt(quality),
      resize,
    });

    const format = req.query.format || 'base64';

    if (format === 'binary') {
      res.set('Content-Type', processed.mimeType);
      res.set('Content-Disposition', `inline; filename="edited.${processed.format}"`);
      return res.send(processed.buffer);
    }

    res.json({
      success: true,
      data: {
        image: processed.buffer.toString('base64'),
        format: processed.format,
        prompt,
        text: result.text || null,
        originalSize: processed.originalSize,
        optimizedSize: processed.optimizedSize,
        savings: processed.savings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Remove Background via Gemini ───────────────────────────────────

router.post('/remove-bg', upload.single('image'), async (req, res, next) => {
  try {
    // Accept image from file upload or base64 in JSON body
    let imageBuffer;
    let inputMime = 'image/png';

    if (req.file) {
      imageBuffer = req.file.buffer;
      inputMime = req.file.mimetype;
    } else if (req.body.image) {
      imageBuffer = Buffer.from(req.body.image, 'base64');
      inputMime = req.body.mimeType || 'image/png';
    } else {
      return res.status(400).json({
        success: false,
        error: 'image is required (upload file or send base64 in body)',
      });
    }

    // Ask Gemini to remove background
    const result = await editBananaImage(
      imageBuffer,
      'Remove the background from this image completely. Replace the background with a solid bright green color (#00FF00). Keep only the main subject with clean precise edges. The green must be exactly #00FF00.',
      { mimeType: inputMime }
    );

    // Use Sharp to chroma-key the green background → transparent
    const { data, info } = await sharp(result.imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Sample corners to detect actual bg color Gemini used
    const w = info.width;
    const corners = [0, (w - 1) * 4, (w * (info.height - 1)) * 4, (w * info.height - 1) * 4];
    let bgR = 0, bgG = 0, bgB = 0, count = 0;
    for (const idx of corners) {
      if (idx + 2 < data.length) {
        bgR += data[idx]; bgG += data[idx + 1]; bgB += data[idx + 2];
        count++;
      }
    }
    bgR = Math.round(bgR / count);
    bgG = Math.round(bgG / count);
    bgB = Math.round(bgB / count);

    const tolerance = 90;
    for (let i = 0; i < data.length; i += 4) {
      const dr = Math.abs(data[i] - bgR);
      const dg = Math.abs(data[i + 1] - bgG);
      const db = Math.abs(data[i + 2] - bgB);
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < tolerance) {
        data[i + 3] = 0; // fully transparent
      } else if (dist < tolerance + 30) {
        // Soft edge — partial transparency for antialiasing
        data[i + 3] = Math.round(255 * (dist - tolerance) / 30);
      }
    }

    const finalBuffer = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const format = req.query.format || 'base64';

    if (format === 'binary') {
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', 'inline; filename="removed-bg.png"');
      return res.send(finalBuffer);
    }

    res.json({
      success: true,
      data: {
        image: finalBuffer.toString('base64'),
        format: 'png',
        text: result.text || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
