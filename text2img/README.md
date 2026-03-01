# text2img

Express REST API for AI image generation using Cloudflare Workers AI (FLUX-1-Schnell).

## Features

- Text-to-image generation via Cloudflare Workers AI
- Base64 JSON or binary image response
- Multiple output formats (PNG, JPG, WebP)
- Prompt auto-enhancement with style context
- Responsive image variants generation
- Image resize and optimization
- **Icon Generation** with 4 presets:
  - `appIcon` -- iOS/macOS app icons with auto-trim, content fill, and rounded corners die-cut
  - `menuBar` -- macOS menu bar template images (B&W silhouette die-cut, generated at 512px)
  - `favicon` -- Web icons: favicon.ico, apple-touch-icon, PWA icons
  - `all` -- All presets in one request (2 AI generations in parallel: color + B&W)

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with your Cloudflare credentials:

```
CF_ACCOUNT_ID=your_cloudflare_account_id
CF_AI_TOKEN=your_cloudflare_ai_token
```

### Getting Cloudflare Workers AI Credentials

1. Sign up or log in at [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Account ID** — found in the dashboard URL or on the **Workers & Pages** overview page (right sidebar)
3. **AI API Token** — go to **My Profile > API Tokens > Create Token**
   - Use the **Workers AI** template, or create a custom token with `Account > Workers AI > Read` permission
   - Copy the generated token — it is shown only once

## Usage

```bash
# Development
npm run dev

# Production
npm start
```

### Makefile

```bash
make install   # Install dependencies
make serv      # Start server (background)
make down      # Stop server
```

Server runs on `http://localhost:3210` by default.

## API Endpoints

### Health Check

```
GET /api/health
```

```json
{ "status": "ok", "service": "text2img" }
```

### Generate Image

```
POST /api/generate
```

**Request Body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | string | *required* | Text prompt for image generation |
| `size` | string | `1024x1024` | Image dimensions (WxH) |
| `steps` | integer | `4` | Diffusion steps |
| `guidance` | number | `7.5` | Guidance scale |
| `quality` | integer | `85` | Output quality (1-100) |
| `optimize` | boolean | `false` | Apply image optimizations |
| `outputFormat` | string | `png` | `png`, `jpg`, or `webp` |
| `resize` | string | `null` | Resize dimensions (e.g. `512x512`) |
| `responsive` | boolean | `false` | Generate responsive variants |
| `responsiveSizes` | integer[] | `[480,768,1024,1920]` | Variant widths |
| `enhancePrompt` | boolean | `true` | Auto-enhance prompt |
| `style` | string | — | Style hint: `hero`, `food`, `icon`, `interior`, etc. |

**Query Parameter:** `?format=base64` (default) or `?format=binary`

**Example:**

```bash
# Base64 JSON response
curl -X POST http://localhost:3210/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Thai restaurant interior, modern design"}'

# Binary image file
curl -X POST 'http://localhost:3210/api/generate?format=binary' \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Thai green curry dish", "outputFormat": "jpg", "style": "food"}' \
  -o output.jpg
```

### Generate Icon Set

```
POST /api/generate/icon
```

**Request Body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | string | *required* | Text prompt for icon generation |
| `preset` | string | *required* | `appIcon`, `menuBar`, `favicon`, or `all` |
| `size` | string | `1024x1024` | AI canvas (menuBar always uses 512x512) |
| `steps` | integer | `4` | Diffusion steps (1-20) |
| `guidance` | number | `7.5` | Guidance scale |
| `enhancePrompt` | boolean | `true` | Auto-enhance prompt with icon-specific modifiers |
| `cornerRadius` | number | `0.22` | Corner radius ratio for appIcon (Apple standard) |
| `contentFill` | number | `0.85` | Content fill ratio after auto-trim |
| `padding` | number | `0` | Padding ratio around icon |
| `background` | string | `transparent` | Background color (`transparent` or hex) |

**Query Parameter:** `?format=base64` (default) or `?format=zip`

**Icon Output Sizes:**

| Preset | Sizes | Format |
|--------|-------|--------|
| `appIcon` | 1024, 512, 256, 128, 64, 32, 16 | PNG (rounded corners) |
| `menuBar` | 512, 256, 128, 64, 32(@2x), 16 | PNG (B&W silhouette) |
| `favicon` | 16, 32, 48, 180, 192, 512 + .ico | PNG + ICO |

**Examples:**

```bash
# App Icon (7 icons, rounded corners die-cut)
curl -X POST http://localhost:3210/api/generate/icon \
  -H "Content-Type: application/json" \
  -d '{"prompt":"cute orange printer with chef hat","preset":"appIcon"}'

# Menu Bar (6 icons, B&W silhouette die-cut)
curl -X POST http://localhost:3210/api/generate/icon \
  -H "Content-Type: application/json" \
  -d '{"prompt":"printer with chef hat","preset":"menuBar"}'

# Favicon (6 PNGs + favicon.ico)
curl -X POST http://localhost:3210/api/generate/icon \
  -H "Content-Type: application/json" \
  -d '{"prompt":"cute orange printer with chef hat","preset":"favicon"}'

# All presets (20 icons, 2 AI calls in parallel)
curl -X POST http://localhost:3210/api/generate/icon \
  -H "Content-Type: application/json" \
  -d '{"prompt":"cute orange printer with chef hat","preset":"all"}'

# Download as ZIP
curl -X POST "http://localhost:3210/api/generate/icon?format=zip" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"cute orange printer with chef hat","preset":"all"}' \
  -o icons.zip
```

## API Docs

- OpenAPI 3.0 spec: [`docs/openapi.yaml`](docs/openapi.yaml)
- Postman collection: [`collection.json`](collection.json) -- import into Postman or Insomnia

## Project Structure

```
text2img/
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   ├── generate.js        # POST /api/generate route
│   │   └── icon.js            # POST /api/generate/icon route
│   └── services/
│       ├── image.js           # Cloudflare AI API, prompt enhancement, Sharp processing
│       └── icon.js            # Icon pipelines, presets, auto-trim, die-cut, ZIP packaging
├── docs/openapi.yaml          # OpenAPI 3.0 specification
├── collection.json            # Postman Collection v2.1
└── .env.example               # Environment variables template
```

## License

ISC
