# Auto Content — AI Video Generation Pipeline

## Project Overview
สร้าง video จาก audio file อัตโนมัติ โดยใช้ AI ถอดเสียง → สร้างรูปตามบริบท → compose video พร้อม waveform

## Flow สำหรับ AI (ทำตามลำดับ)

เมื่อ user ให้ไฟล์เสียง (เช่น `my_audio.wav`) ให้ทำตาม flow นี้:

### Step 0: Prerequisites
- ต้องมี text2img API server ทำงานที่ `localhost:3210`
  ```bash
  cd ../text2img && npm start
  ```
- ต้องติดตั้ง: `pip install faster-whisper requests Pillow`
- ต้องมี FFmpeg

### Step 1: Transcribe Audio
```bash
python auto_content.py <audio_file>
```
- ใช้ `faster-whisper` model `large-v3-turbo`, language=`th`, CPU int8
- ผลลัพธ์: `output/segments.json` (cache — ครั้งต่อไปข้ามได้ด้วย `--skip-transcribe`)

### Step 2: สร้าง prompts.json (AI ทำเอง)
**สำคัญมาก**: AI ต้องอ่าน `output/segments.json` แล้ววิเคราะห์เนื้อหาทั้งหมดเพื่อสร้าง `prompts.json`

1. อ่าน segments.json ทั้งหมด
2. ทำความเข้าใจเนื้อหาทั้ง episode (หัวข้อ, อุปมา, case study, บทสรุป)
3. สร้าง `prompts.json` โดยแต่ละ segment ต้องมี prompt ที่:
   - เป็นภาษาอังกฤษ
   - ตรงบริบทเนื้อหา (ไม่ใช่แปลตรงๆ แต่เป็นภาพที่สื่อความหมาย)
   - ปลอดภัยจาก NSFW filter (หลีกเลี่ยงคำว่า zombie, horror, burning, destruction, chains)
   - cinematic style เหมาะทำ video

Format:
```json
[
  {"seg": 0, "prompt": "descriptive English prompt for image generation"},
  {"seg": 1, "prompt": "..."},
  ...
]
```

### Step 3: Generate Images + Compose Video
```bash
python auto_content.py <audio_file> --skip-transcribe
```
- อ่าน prompts.json → สร้างรูปผ่าน text2img API (3 workers parallel)
- Resize ทุกรูปเป็น 120% ของ output (สำหรับ Ken Burns pan)
- Compose video 3 pass:
  - Pass 1: slideshow + audio + Ken Burns → `slideshow.mp4`
  - Pass 2: waveform bars จาก audio → `bars.mp4`
  - Pass 3: overlay bars ลง slideshow → `output.mp4`

### Step 4: ตรวจสอบ + ปรับแก้
- เปิด `output/output.mp4` ให้ user ดู
- ถ้า user อยากแก้ prompt บาง segment → แก้ใน `prompts.json` แล้วลบรูปที่ต้องสร้างใหม่
- รัน `--skip-transcribe` เพื่อข้ามขั้นตอนถอดเสียง

## CLI Reference
```bash
python auto_content.py <audio>                        # full pipeline
python auto_content.py <audio> --skip-transcribe       # ข้าม transcription
python auto_content.py <audio> --skip-images           # ข้ามสร้างรูป
python auto_content.py <audio> --viz spectrum           # ใช้ spectrum แทน waveform
python auto_content.py <audio> --resolution 1920x1080  # เปลี่ยน resolution
python auto_content.py <audio> --style "watercolor"    # เพิ่ม style ให้รูป
python auto_content.py <audio> --prompts my_prompts.json  # ใช้ prompts file อื่น
```

## Architecture Decisions
- **3-pass video composition**: แยก slideshow, waveform, overlay เพราะ single-pass ทำให้ waveform ไม่เคลื่อนไหว
- **Ken Burns ใช้ crop ไม่ใช่ zoompan**: zoompan ทำ timing ของ concat demuxer เพี้ยน
- **รูปสร้าง 120% ขนาด**: เผื่อ margin สำหรับ Ken Burns pan
- **colorkey ลบพื้นดำ waveform**: overlay เฉพาะเส้น waveform ลงบน gradient ดำจาง
- **prompts.json แยกจาก script**: แก้ไข prompt ได้โดยไม่ต้องแก้ code

## File Structure
```
auto-content/
├── CLAUDE.md          # คำสั่งสำหรับ AI (ไฟล์นี้)
├── auto_content.py    # main script
├── prompts.json       # AI-generated image prompts (ต่อ audio file)
├── <audio>.wav        # input audio
└── output/
    ├── segments.json  # transcription cache
    ├── images/        # generated images (seg_0000.png, ...)
    ├── slideshow.mp4  # intermediate: slideshow + audio
    ├── bars.mp4       # intermediate: waveform animation
    └── output.mp4     # final video
```

## Dependencies
- Python: `faster-whisper`, `requests`, `Pillow`
- System: `ffmpeg` (8.0+)
- Service: text2img API at `localhost:3210` (from `../text2img`)
