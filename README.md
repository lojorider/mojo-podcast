# Auto Content

สร้าง video จาก audio file อัตโนมัติ — ถอดเสียง, สร้างรูปด้วย AI, compose video พร้อม waveform animation

## Flow

```
Audio File (.wav)
      │
      ▼
┌─────────────┐
│ 1. Transcribe│  faster-whisper (large-v3-turbo)
│    Audio     │  → output/segments.json
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 2. AI สร้าง  │  Claude/AI อ่าน segments แล้วสร้าง
│  prompts.json│  image prompt ตรงบริบทเนื้อหา
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 3. Generate  │  text2img API (localhost:3210)
│    Images    │  3 workers parallel + retry + fallback
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 4. Resize    │  120% ของ output size
│    Images    │  cover crop สำหรับ Ken Burns
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│ 5. Compose Video (3 pass)           │
│                                     │
│  Pass 1: slideshow + audio          │
│          + Ken Burns pan            │
│          → slideshow.mp4            │
│                                     │
│  Pass 2: showwaves (cline)          │
│          จาก audio                  │
│          → bars.mp4                 │
│                                     │
│  Pass 3: overlay bars               │
│          + gradient ดำจาง            │
│          + colorkey ลบพื้นดำ         │
│          → output.mp4               │
└─────────────────────────────────────┘
```

## Setup

```bash
# Python dependencies
pip install faster-whisper requests Pillow

# text2img API server (bundled — auto-start/stop โดย script)
cd text2img && npm install
```

## Usage

### Full Pipeline
```bash
python auto_content.py audio.wav
```

### ทีละขั้น
```bash
# 1. Transcribe เท่านั้น (สร้าง segments.json)
python auto_content.py audio.wav
# แล้วกด Ctrl+C หลัง transcribe เสร็จ หรือรอจบ

# 2. ให้ AI สร้าง prompts.json (ใช้ Claude)
# AI จะอ่าน output/segments.json แล้วสร้าง prompts.json

# 3. สร้างรูป + video (ข้าม transcribe)
python auto_content.py audio.wav --skip-transcribe

# 4. สร้าง video อย่างเดียว (ข้ามรูปด้วย)
python auto_content.py audio.wav --skip-transcribe --skip-images
```

### Options
| Flag | Description |
|------|-------------|
| `--viz waveform` | waveform แบบ cline (default) |
| `--viz spectrum` | spectrum แบบ fire scroll |
| `--skip-transcribe` | ข้าม transcription ใช้ cache |
| `--skip-images` | ข้ามสร้างรูป ใช้ที่มีอยู่ |
| `--resolution 1920x1080` | เปลี่ยน resolution |
| `--style "cyberpunk"` | เพิ่ม style ให้รูป |
| `--prompts file.json` | ใช้ prompts file อื่น |
| `--output-dir ./out` | เปลี่ยน output directory |
| `--no-auto-server` | ไม่ auto-start text2img server |

## Output Files

```
output/
├── segments.json   # subtitle segments (cached)
├── images/         # AI-generated images
│   ├── seg_0000.png
│   ├── seg_0001.png
│   └── ...
├── slideshow.mp4   # intermediate: slides + audio
├── bars.mp4        # intermediate: waveform
└── output.mp4      # final video
```

## prompts.json Format

```json
[
  {"seg": 0, "prompt": "podcast host at microphone in dark studio, neon blue lighting"},
  {"seg": 1, "prompt": "server room with warning lights, dramatic atmosphere"},
  ...
]
```

### Guidelines สำหรับเขียน prompt
- ภาษาอังกฤษ
- บรรยายภาพที่สื่อบริบทเนื้อหา (ไม่ใช่แปลตรงตัว)
- หลีกเลี่ยงคำ NSFW: zombie, horror, burning, destruction, chains, violence
- เน้น cinematic, descriptive, visual
- **รูปแรก (seg 0) ต้องเป็นรูปปก** — ภาพสวยสื่อหัวข้อ episode, ห้ามมีตัวหนังสือ
- **ตัวละครคนต้องเป็นคนไทย** — ระบุ "Thai" ใน prompt เสมอเมื่อมีคน
- **แต่ละรูปต้องแสดงอย่างน้อย 4 วินาที** — group segments สั้นๆ ที่ติดกันให้ใช้ prompt เดียวกัน

## Tech Stack
- **Transcription**: faster-whisper (CTranslate2, large-v3-turbo)
- **Image Generation**: text2img API (Cloudflare FLUX-1-Schnell)
- **Video Composition**: FFmpeg (H.264 + AAC)
- **Ken Burns**: FFmpeg `crop` filter with sin/cos animation
- **Waveform**: FFmpeg `showwaves` mode=cline + `colorkey` overlay
