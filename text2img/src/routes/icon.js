import { Router } from 'express';
import { generateImage } from '../services/image.js';
import {
  enhanceIconPrompt,
  generateIconSet,
  createIconZip,
  ICON_PRESETS,
} from '../services/icon.js';

const router = Router();

const VALID_PRESETS = ['appIcon', 'menuBar', 'favicon', 'all'];

router.post('/', async (req, res, next) => {
  try {
    const {
      prompt,
      preset,
      size = '1024x1024',
      steps = 4,
      guidance = 7.5,
      enhancePrompt: doEnhance = true,
      background = 'transparent',
      cornerRadius = 0.22,
      padding = 0,
      contentFill = 0.85,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────

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

    // ── Generate AI image(s) ─────────────────────────────────────

    const iconOptions = { background, cornerRadius, padding, contentFill };
    let icons = [];
    const enhancedPrompts = {};

    // menuBar uses 512px AI canvas (less detail), others use user-specified size
    const menuBarSize = ICON_PRESETS.menuBar.aiSize || '512x512';

    if (preset === 'all') {
      // Generate 2 images: color @ full size, B&W @ 512px
      const colorPrompt = doEnhance ? enhanceIconPrompt(prompt, 'appIcon') : prompt;
      const monoPrompt = doEnhance ? enhanceIconPrompt(prompt, 'menuBar') : prompt;
      enhancedPrompts.color = colorPrompt;
      enhancedPrompts.menuBar = monoPrompt;

      const [colorResult, monoResult] = await Promise.all([
        generateImage(colorPrompt, { size, steps, guidance, enhancePrompt: false }),
        generateImage(monoPrompt, { size: menuBarSize, steps, guidance, enhancePrompt: false }),
      ]);

      const [appIcons, menuIcons, favIcons] = await Promise.all([
        generateIconSet(colorResult.imageBuffer, 'appIcon', iconOptions),
        generateIconSet(monoResult.imageBuffer, 'menuBar', iconOptions),
        generateIconSet(colorResult.imageBuffer, 'favicon', iconOptions),
      ]);
      icons = [...appIcons, ...menuIcons, ...favIcons];
    } else if (preset === 'menuBar') {
      // menuBar: generate at 512px for simpler details
      const finalPrompt = doEnhance ? enhanceIconPrompt(prompt, 'menuBar') : prompt;
      enhancedPrompts.menuBar = finalPrompt;

      const genResult = await generateImage(finalPrompt, {
        size: menuBarSize, steps, guidance, enhancePrompt: false,
      });
      icons = await generateIconSet(genResult.imageBuffer, 'menuBar', iconOptions);
    } else {
      // appIcon / favicon: generate at user-specified size
      const finalPrompt = doEnhance ? enhanceIconPrompt(prompt, preset) : prompt;
      enhancedPrompts[preset] = finalPrompt;

      const genResult = await generateImage(finalPrompt, {
        size, steps, guidance, enhancePrompt: false,
      });
      icons = await generateIconSet(genResult.imageBuffer, preset, iconOptions);
    }

    // ── Response ────────────────────────────────────────────────

    const format = req.query.format || 'base64';

    if (format === 'zip') {
      const zipBuffer = await createIconZip(icons, preset);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="icons-${preset}.zip"`);
      return res.send(zipBuffer);
    }

    const data = {
      prompt,
      enhancedPrompts,
      preset,
      icons: icons.map(({ buffer, ...meta }) => ({
        ...meta,
        image: buffer.toString('base64'),
      })),
    };

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
