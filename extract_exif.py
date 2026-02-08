#!/usr/bin/env python3
"""
extract_exif.py — Scan the ./images folder, extract GPS coordinates and
Date-Taken from EXIF data, and write photos.json for the travel map.

HEIC images (iPhone) are automatically converted to JPEG for browser display.

Usage:
    pip install Pillow pillow-heif
    python extract_exif.py

Output:
    photos.json  — array of { filename, path, lat, lng, timestamp }
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime
from collections import defaultdict

try:
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
except ImportError:
    sys.exit(
        "Pillow is required.  Install it with:\n"
        "    pip install Pillow pillow-heif\n"
    )

# Register HEIC/HEIF support if available
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIC_SUPPORT = True
except ImportError:
    HEIC_SUPPORT = False
    print("⚠  pillow-heif not installed — HEIC files will be skipped.")
    print("   Install with: pip install pillow-heif\n")

# ── Configuration ────────────────────────────────
IMAGES_DIR    = Path("images")
CONVERTED_DIR = IMAGES_DIR / "converted"   # HEIC → JPEG output
OUTPUT_FILE   = "photos.json"
HEIC_EXTS     = {".heic", ".heif"}
IMAGE_EXTS    = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}
ALL_EXTS      = IMAGE_EXTS | HEIC_EXTS


def dms_to_decimal(dms, ref):
    """Convert EXIF GPS DMS (degrees, minutes, seconds) to decimal degrees."""
    degrees = float(dms[0])
    minutes = float(dms[1])
    seconds = float(dms[2])
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    if ref in ("S", "W"):
        decimal = -decimal
    return round(decimal, 6)


def get_exif_data(image_path):
    """Return a dict of decoded EXIF tags for the image."""
    try:
        img = Image.open(image_path)
        raw = img._getexif()
        if raw is None:
            return {}
        return {TAGS.get(k, k): v for k, v in raw.items()}
    except Exception:
        return {}


def get_gps_info(exif):
    """Extract lat/lng from EXIF GPSInfo, if present."""
    gps_raw = exif.get("GPSInfo")
    if not gps_raw:
        return None, None

    gps = {GPSTAGS.get(k, k): v for k, v in gps_raw.items()}

    try:
        lat = dms_to_decimal(gps["GPSLatitude"], gps["GPSLatitudeRef"])
        lng = dms_to_decimal(gps["GPSLongitude"], gps["GPSLongitudeRef"])
        return lat, lng
    except (KeyError, TypeError, ZeroDivisionError):
        return None, None


def get_date_taken(exif):
    """Parse the DateTimeOriginal or DateTime EXIF field → epoch ms."""
    for tag in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        raw = exif.get(tag)
        if raw:
            try:
                dt = datetime.strptime(str(raw), "%Y:%m:%d %H:%M:%S")
                return int(dt.timestamp() * 1000)
            except ValueError:
                continue
    return None


def convert_heic_to_jpeg(src_path):
    """Convert a HEIC file to JPEG in the converted/ folder. Returns the JPEG Path."""
    CONVERTED_DIR.mkdir(parents=True, exist_ok=True)
    dest = CONVERTED_DIR / (src_path.stem + ".jpg")
    if dest.exists():
        return dest  # already converted
    try:
        img = Image.open(src_path)
        img = img.convert("RGB")
        img.save(dest, "JPEG", quality=85)
        return dest
    except Exception as e:
        print(f"   ⚠  Failed to convert {src_path.name}: {e}")
        return None


def infer_location(timestamp_ms, day_locations):
    """Given a timestamp, find the closest day with known GPS and return its avg location."""
    if not day_locations:
        return None, None, None

    photo_date = datetime.fromtimestamp(timestamp_ms / 1000).date()
    best_day = None
    best_delta = None

    for day in day_locations:
        delta = abs((day - photo_date).days)
        if best_delta is None or delta < best_delta:
            best_delta = delta
            best_day = day

    if best_day is None or best_delta > 3:
        # Only infer if within 3 days of a known location
        return None, None, None

    coords = day_locations[best_day]
    avg_lat = round(sum(c[0] for c in coords) / len(coords), 6)
    avg_lng = round(sum(c[1] for c in coords) / len(coords), 6)
    return avg_lat, avg_lng, best_delta


def scan_images():
    """Walk the images directory and collect photo metadata (two-pass for GPS inference)."""
    if not IMAGES_DIR.is_dir():
        print(f"⚠  '{IMAGES_DIR}' folder not found — creating it for you.")
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        return []

    files = sorted(
        p for p in IMAGES_DIR.rglob("*")
        if p.suffix.lower() in ALL_EXTS and "converted" not in p.parts
    )

    print(f"📂 Found {len(files)} image(s) in '{IMAGES_DIR}/'")

    # ── Pass 1: collect all EXIF data, separate GPS vs no-GPS ──
    geotagged = []
    no_gps    = []
    day_locations = defaultdict(list)  # date → [(lat, lng), ...]

    print(f"\n── Pass 1: Reading EXIF data ──")

    for filepath in files:
        is_heic = filepath.suffix.lower() in HEIC_EXTS

        if is_heic and not HEIC_SUPPORT:
            print(f"   ⏭  Skipping {filepath.name} — no HEIC support")
            continue

        exif = get_exif_data(filepath)
        lat, lng = get_gps_info(exif)
        timestamp = get_date_taken(exif)

        if timestamp is None:
            print(f"   ⏭  Skipping {filepath.name} — no date taken")
            continue

        # Convert HEIC → JPEG for browser display
        if is_heic:
            converted = convert_heic_to_jpeg(filepath)
            if converted is None:
                continue
            serve_path = str(converted)
        else:
            serve_path = str(filepath)

        entry = {
            "filename":  filepath.name,
            "path":      serve_path,
            "timestamp": timestamp,
        }

        if lat is not None and lng is not None:
            entry["lat"] = lat
            entry["lng"] = lng
            entry["approximate"] = False
            geotagged.append(entry)

            photo_date = datetime.fromtimestamp(timestamp / 1000).date()
            day_locations[photo_date].append((lat, lng))

            print(f"   ✅ {filepath.name}  →  ({lat}, {lng})  {datetime.fromtimestamp(timestamp / 1000).isoformat()}")
        else:
            no_gps.append(entry)

    # ── Pass 2: infer locations for photos missing GPS ──
    inferred_count = 0
    still_missing  = 0

    if no_gps:
        print(f"\n── Pass 2: Inferring locations for {len(no_gps)} photos without GPS ──")

        for entry in no_gps:
            lat, lng, day_delta = infer_location(entry["timestamp"], day_locations)

            if lat is not None:
                entry["lat"] = lat
                entry["lng"] = lng
                entry["approximate"] = True
                geotagged.append(entry)
                inferred_count += 1

                delta_str = "same day" if day_delta == 0 else f"±{day_delta}d"
                print(f"   📍 {entry['filename']}  →  ({lat}, {lng})  [{delta_str}]")
            else:
                still_missing += 1
                print(f"   ⏭  {entry['filename']} — no nearby dated GPS reference")

    print(f"\n── Summary ──")
    print(f"   Exact GPS:    {len(geotagged) - inferred_count}")
    print(f"   Inferred:     {inferred_count}")
    print(f"   Still missing: {still_missing}")

    return geotagged


def main():
    print("═" * 50)
    print("  World Photos — EXIF Extractor")
    print("═" * 50)
    print()

    photos = scan_images()

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(photos, f, indent=2, ensure_ascii=False)

    print()
    if photos:
        print(f"✅ Wrote {len(photos)} photo(s) to {OUTPUT_FILE}")
    else:
        print(f"⚠  No geotagged photos found. {OUTPUT_FILE} is empty.")
        print("   Place geotagged images in the 'images/' folder and run again.")
    print()


if __name__ == "__main__":
    main()
