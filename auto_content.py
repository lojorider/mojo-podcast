#!/usr/bin/env python3
"""auto_content.py — สร้าง video จาก audio file ภาษาไทย

Pipeline:
  1. Transcribe audio → segments.json (faster-whisper)
  1.5 Load image prompts จาก prompts.json (สร้างโดย AI)
  2. Generate images จาก contextual prompts (text2img API)
  3. Resize images ให้ขนาดเท่ากัน
  4. Compose video ด้วย FFmpeg (Ken Burns + audio bar visualization)
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TEXT2IMG_URL = "http://localhost:3210/api/generate"
DEFAULT_RESOLUTION = (1280, 720)
MAX_RETRIES = 3
IMAGE_WORKERS = 3


# ---------------------------------------------------------------------------
# Step 1: Transcribe
# ---------------------------------------------------------------------------
def transcribe_audio(audio_path: str, output_dir: str) -> list[dict]:
    """Transcribe Thai audio using faster-whisper large-v3-turbo."""
    from faster_whisper import WhisperModel

    cache_path = os.path.join(output_dir, "segments.json")
    if os.path.exists(cache_path):
        print(f"  ⏩ ใช้ cache จาก {cache_path}")
        with open(cache_path) as f:
            return json.load(f)

    print("  📥 กำลังโหลด model large-v3-turbo (ครั้งแรกจะ download)...")
    model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")

    print(f"  🎙️ กำลัง transcribe {audio_path} ...")
    raw_segments, info = model.transcribe(
        audio_path,
        language="th",
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ),
    )

    segments = []
    for seg in raw_segments:
        segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
        })
        print(f"    [{seg.start:7.2f}–{seg.end:7.2f}] {seg.text.strip()}")

    print(f"  ✅ พบ {len(segments)} segments (ภาษา: {info.language}, prob: {info.language_probability:.2f})")

    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(segments, f, ensure_ascii=False, indent=2)

    return segments


# ---------------------------------------------------------------------------
# Step 1.5: Load AI-generated prompts from config
# ---------------------------------------------------------------------------
def load_prompts(prompts_path: str, num_segments: int) -> list[str]:
    """Load image generation prompts จาก prompts.json config."""
    if not os.path.exists(prompts_path):
        print(f"  ⚠️ ไม่พบ {prompts_path} — ใช้ generic prompt แทน")
        return [None] * num_segments

    with open(prompts_path, encoding="utf-8") as f:
        prompts_data = json.load(f)

    # สร้าง lookup dict จาก seg index
    lookup = {item["seg"]: item["prompt"] for item in prompts_data}

    prompts = []
    for i in range(num_segments):
        prompts.append(lookup.get(i))

    found = sum(1 for p in prompts if p is not None)
    print(f"  📋 โหลด {found}/{num_segments} prompts จาก {prompts_path}")
    return prompts


# ---------------------------------------------------------------------------
# Step 2: Generate Images
# ---------------------------------------------------------------------------
def generate_single_image(
    idx: int, prompt: str, images_dir: str, resolution: tuple[int, int], style: str | None
) -> str:
    """Generate หรือ skip รูปเดียว กลับ path."""
    filename = f"seg_{idx:04d}.png"
    filepath = os.path.join(images_dir, filename)

    if os.path.exists(filepath):
        return filepath  # resume support

    w, h = resolution
    # สร้างรูปใหญ่กว่า output 20% สำหรับ Ken Burns zoom
    gen_w = int(w * 1.2)
    gen_h = int(h * 1.2)

    final_prompt = prompt
    if style:
        final_prompt += f", {style} style"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(
                TEXT2IMG_URL,
                json={
                    "prompt": final_prompt,
                    "size": f"{gen_w}x{gen_h}",
                    "steps": 4,
                    "quality": 90,
                    "outputFormat": "png",
                    "enhancePrompt": True,
                    "style": style or "",
                },
                timeout=60,
            )
            data = resp.json()
            if data.get("success"):
                img_bytes = base64.b64decode(data["data"]["image"])
                with open(filepath, "wb") as f:
                    f.write(img_bytes)
                return filepath
            raise RuntimeError(data.get("error", "unknown API error"))
        except Exception as e:
            if attempt < MAX_RETRIES:
                wait = 2 ** attempt
                print(f"    ⚠️ seg {idx} attempt {attempt} failed: {e}. Retry in {wait}s...")
                time.sleep(wait)
            else:
                print(f"    ❌ seg {idx} failed after {MAX_RETRIES} attempts, using fallback")
                return create_fallback_image(filepath, prompt, (gen_w, gen_h))

    return filepath


def create_fallback_image(filepath: str, text: str, resolution: tuple[int, int]) -> str:
    """สร้างรูปดำ + text ด้วย Pillow เมื่อ API fail."""
    from PIL import Image, ImageDraw, ImageFont

    w, h = resolution
    img = Image.new("RGB", (w, h), (20, 20, 30))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", 28)
    except OSError:
        font = ImageFont.load_default()

    max_chars = w // 16
    lines = [text[i:i + max_chars] for i in range(0, len(text), max_chars)]
    y = h // 2 - len(lines) * 18
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((w - tw) // 2, y), line, fill=(200, 200, 220), font=font)
        y += 36

    img.save(filepath, "PNG")
    return filepath


def generate_images(
    segments: list[dict],
    prompts: list[str],
    output_dir: str,
    resolution: tuple[int, int],
    style: str | None,
) -> list[str]:
    """Generate images สำหรับทุก segment แบบ parallel."""
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    paths = [None] * len(segments)
    print(f"  🎨 กำลังสร้างรูป {len(segments)} รูป (workers={IMAGE_WORKERS})...")

    with ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as pool:
        futures = {}
        for i, seg in enumerate(segments):
            prompt = prompts[i] if prompts[i] else f"cinematic scene: {seg['text']}"
            future = pool.submit(generate_single_image, i, prompt, images_dir, resolution, style)
            futures[future] = i

        for future in as_completed(futures):
            idx = futures[future]
            paths[idx] = future.result()
            done = sum(1 for p in paths if p is not None)
            print(f"    [{done}/{len(segments)}] seg_{idx:04d}.png ✓")

    print(f"  ✅ สร้างรูปครบ {len(paths)} รูป")
    return paths


# ---------------------------------------------------------------------------
# Step 3: Resize Images (สำหรับ Ken Burns ต้องใหญ่กว่า output)
# ---------------------------------------------------------------------------
def resize_images(image_paths: list[str], resolution: tuple[int, int]) -> list[str]:
    """Resize ทุกรูปให้ขนาด 120% ของ output สำหรับ Ken Burns zoom."""
    from PIL import Image

    # Ken Burns ต้องการรูปใหญ่กว่า output เพื่อ zoom/pan
    w = int(resolution[0] * 1.2)
    h = int(resolution[1] * 1.2)
    resized = []
    print(f"  📐 Resize รูปเป็น {w}x{h} (120% สำหรับ Ken Burns)...")

    for path in image_paths:
        img = Image.open(path)
        if img.size == (w, h):
            resized.append(path)
            continue

        src_w, src_h = img.size
        scale = max(w / src_w, h / src_h)
        new_w = int(src_w * scale)
        new_h = int(src_h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)

        left = (new_w - w) // 2
        top = (new_h - h) // 2
        img = img.crop((left, top, left + w, top + h))
        img.save(path, "PNG")
        resized.append(path)

    print(f"  ✅ Resize เสร็จ {len(resized)} รูป")
    return resized


# ---------------------------------------------------------------------------
# Step 4: Create Video with FFmpeg
# ---------------------------------------------------------------------------
def create_concat_file(
    segments: list[dict], image_paths: list[str], output_dir: str, resolution: tuple[int, int]
) -> str:
    """สร้าง FFmpeg concat demuxer file พร้อม duration ตาม timestamps."""
    concat_path = os.path.join(output_dir, "concat.txt")
    # Ken Burns images are 120% size
    w = int(resolution[0] * 1.2)
    h = int(resolution[1] * 1.2)

    with open(concat_path, "w") as f:
        for i, (seg, img_path) in enumerate(zip(segments, image_paths)):
            if i == 0 and seg["start"] > 0.1:
                black_path = os.path.join(output_dir, "images", "black.png")
                if not os.path.exists(black_path):
                    from PIL import Image
                    Image.new("RGB", (w, h), (0, 0, 0)).save(black_path, "PNG")
                f.write(f"file '{os.path.abspath(black_path)}'\n")
                f.write(f"duration {seg['start']:.3f}\n")

            f.write(f"file '{os.path.abspath(img_path)}'\n")
            if i < len(segments) - 1:
                duration = segments[i + 1]["start"] - seg["start"]
            else:
                duration = seg["end"] - seg["start"] + 0.5
            f.write(f"duration {duration:.3f}\n")

        if image_paths:
            f.write(f"file '{os.path.abspath(image_paths[-1])}'\n")

    return concat_path


def create_video(
    segments: list[dict],
    image_paths: list[str],
    audio_path: str,
    output_dir: str,
    resolution: tuple[int, int],
    viz_mode: str,
) -> str:
    """Compose final video แบบ 2 pass: slideshow ก่อน แล้ว overlay waveform."""
    w, h = resolution
    viz_h = h // 5
    viz_y = h - viz_h
    slideshow_path = os.path.join(output_dir, "slideshow.mp4")
    bars_path = os.path.join(output_dir, "bars.mp4")
    output_path = os.path.join(output_dir, "output.mp4")

    concat_path = create_concat_file(segments, image_paths, output_dir, resolution)

    # --- Pass 1: Slideshow + Audio + Ken Burns ---
    print(f"  🎬 Pass 1: สร้าง slideshow + audio...")
    margin_x = int(w * 0.2)
    margin_y = int(h * 0.2)
    cx = margin_x // 2
    cy = margin_y // 2
    kenburns = (
        f"[0:v]crop={w}:{h}"
        f":'{cx}+sin(t/6)*{cx}'"
        f":'{cy}+cos(t/8)*{cy}'"
        f"[outv]"
    )
    cmd1 = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", concat_path,
        "-i", audio_path,
        "-filter_complex", kenburns,
        "-map", "[outv]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        "-r", "25", "-pix_fmt", "yuv420p",
        "-shortest",
        slideshow_path,
    ]
    r1 = subprocess.run(cmd1, capture_output=True, text=True)
    if r1.returncode != 0:
        print(f"  ❌ Pass 1 error:\n{r1.stderr[-2000:]}")
        sys.exit(1)
    size1 = os.path.getsize(slideshow_path) / (1024 * 1024)
    print(f"  ✅ slideshow.mp4 ({size1:.1f} MB)")

    # --- Pass 2: สร้าง waveform bars แยก ---
    print(f"  🎵 Pass 2: สร้าง waveform bars...")
    if viz_mode == "spectrum":
        viz_filter = (
            f"[0:a]showspectrum=s={w}x{viz_h}:slide=scroll:mode=combined"
            f":color=fire:scale=sqrt:fscale=log[v]"
        )
    else:
        viz_filter = (
            f"[0:a]showwaves=s={w}x{viz_h}:mode=cline:rate=25"
            f":colors=cyan:scale=sqrt[v]"
        )
    cmd2 = [
        "ffmpeg", "-y",
        "-i", audio_path,
        "-filter_complex", viz_filter,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "28",
        "-r", "25", "-pix_fmt", "yuv420p",
        bars_path,
    ]
    r2 = subprocess.run(cmd2, capture_output=True, text=True)
    if r2.returncode != 0:
        print(f"  ❌ Pass 2 error:\n{r2.stderr[-2000:]}")
        sys.exit(1)
    size2 = os.path.getsize(bars_path) / (1024 * 1024)
    print(f"  ✅ bars.mp4 ({size2:.1f} MB)")

    # --- Pass 3: Overlay bars ลงบน slideshow ---
    print(f"  🔗 Pass 3: overlay waveform ลง slideshow...")
    overlay_filter = (
        f"color=black@0.5:s={w}x{viz_h}:r=25[grad];"
        f"[0:v][grad]overlay=0:{viz_y}[with_grad];"
        f"[1:v]colorkey=black:0.12:0.12[bars_t];"
        f"[with_grad][bars_t]overlay=0:{viz_y}:shortest=1[outv]"
    )
    cmd3 = [
        "ffmpeg", "-y",
        "-i", slideshow_path,
        "-i", bars_path,
        "-filter_complex", overlay_filter,
        "-map", "[outv]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "26",
        "-c:a", "copy",
        "-r", "25", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    r3 = subprocess.run(cmd3, capture_output=True, text=True)
    if r3.returncode != 0:
        print(f"  ❌ Pass 3 error:\n{r3.stderr[-2000:]}")
        sys.exit(1)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  ✅ Video สร้างเสร็จ: {output_path} ({size_mb:.1f} MB)")
    return output_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_resolution(s: str) -> tuple[int, int]:
    parts = s.lower().split("x")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"Invalid resolution: {s} (ใช้ format WxH เช่น 1280x720)")
    return int(parts[0]), int(parts[1])


def main():
    parser = argparse.ArgumentParser(
        description="สร้าง video จาก audio file ภาษาไทย"
    )
    parser.add_argument("audio", help="path ไปยัง audio file (เช่น code.wav)")
    parser.add_argument("--viz", choices=["waveform", "spectrum"], default="waveform",
                        help="โหมด audio visualization (default: waveform แบบแท่ง)")
    parser.add_argument("--skip-transcribe", action="store_true",
                        help="ข้าม transcription ใช้ segments.json ที่มีอยู่")
    parser.add_argument("--skip-images", action="store_true",
                        help="ข้าม image generation ใช้รูปที่มีอยู่")
    parser.add_argument("--resolution", type=parse_resolution, default=DEFAULT_RESOLUTION,
                        help="ความละเอียด video (default: 1280x720)")
    parser.add_argument("--style", type=str, default=None,
                        help="style hint สำหรับ image generation (เช่น cyberpunk, watercolor)")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="output directory (default: ./output)")
    parser.add_argument("--prompts", type=str, default=None,
                        help="path ไปยัง prompts.json (default: ./prompts.json)")
    args = parser.parse_args()

    audio_path = os.path.abspath(args.audio)
    if not os.path.exists(audio_path):
        print(f"❌ ไม่พบไฟล์ audio: {audio_path}")
        sys.exit(1)

    output_dir = args.output_dir or os.path.join(os.path.dirname(audio_path), "output")
    prompts_path = args.prompts or os.path.join(os.path.dirname(audio_path), "prompts.json")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(os.path.join(output_dir, "images"), exist_ok=True)

    print("=" * 60)
    print("🎬 Auto Content — Video Generation Pipeline")
    print("=" * 60)
    print(f"  Audio:      {audio_path}")
    print(f"  Prompts:    {prompts_path}")
    print(f"  Output:     {output_dir}")
    print(f"  Resolution: {args.resolution[0]}x{args.resolution[1]}")
    print(f"  Viz mode:   {args.viz} (bar style)")
    if args.style:
        print(f"  Style:      {args.style}")
    print()

    # Step 1: Transcribe
    print("📝 Step 1: Transcribe Audio")
    if args.skip_transcribe:
        cache_path = os.path.join(output_dir, "segments.json")
        if not os.path.exists(cache_path):
            print(f"  ❌ --skip-transcribe แต่ไม่พบ {cache_path}")
            sys.exit(1)
        with open(cache_path) as f:
            segments = json.load(f)
        print(f"  ⏩ ข้าม transcription, ใช้ cache ({len(segments)} segments)")
    else:
        segments = transcribe_audio(audio_path, output_dir)
    print()

    if not segments:
        print("❌ ไม่พบ segments จาก transcription")
        sys.exit(1)

    # Step 1.5: Load AI prompts
    print("📋 Step 1.5: Load AI Prompts")
    prompts = load_prompts(prompts_path, len(segments))
    print()

    # Step 2: Generate Images
    print("🎨 Step 2: Generate Images")
    if args.skip_images:
        images_dir = os.path.join(output_dir, "images")
        image_paths = sorted(
            [os.path.join(images_dir, f) for f in os.listdir(images_dir)
             if f.startswith("seg_") and f.endswith(".png")]
        )
        if len(image_paths) < len(segments):
            print(f"  ⚠️ มีรูปแค่ {len(image_paths)}/{len(segments)} — สร้างรูปที่ขาด...")
            image_paths = generate_images(segments, prompts, output_dir, args.resolution, args.style)
        else:
            print(f"  ⏩ ข้าม image generation, ใช้รูปที่มี ({len(image_paths)} รูป)")
    else:
        image_paths = generate_images(segments, prompts, output_dir, args.resolution, args.style)
    print()

    # Step 3: Resize
    print("📐 Step 3: Resize Images")
    image_paths = resize_images(image_paths, args.resolution)
    print()

    # Step 4: Create Video
    print("🎬 Step 4: Create Video")
    output_path = create_video(
        segments, image_paths, audio_path, output_dir, args.resolution, args.viz
    )
    print()

    print("=" * 60)
    print(f"🎉 เสร็จสมบูรณ์! Video อยู่ที่: {output_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
