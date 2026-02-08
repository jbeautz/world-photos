# 🌍 World Photos — Interactive Travel Map

A single-page app that plots your geotagged travel photos on a dark-themed Leaflet map with a chronological timeline slider.

![Leaflet + noUiSlider](https://img.shields.io/badge/Leaflet-1.9-green) ![noUiSlider](https://img.shields.io/badge/noUiSlider-15.7-blue) ![Python](https://img.shields.io/badge/Python-3.8+-yellow)

---

## Features

| Feature | Description |
|---------|-------------|
| 📍 Photo markers | Every geotagged photo appears as a dot on the map |
| 🖼️ Popup preview | Click a marker to see the photo and its date |
| 🕹️ Timeline slider | Drag the range handles to filter photos by date |
| 🌙 Dark theme | CartoDB Dark Matter tiles for a clean look |

## Quick Start

### 1. Add your photos

Place your geotagged `.jpg` / `.jpeg` / `.png` / `.tiff` images into the **`images/`** folder.

### 2. Generate `photos.json`

```bash
pip install Pillow
python extract_exif.py
```

This scans `images/`, reads EXIF GPS coordinates and date-taken timestamps, and writes `photos.json`.

### 3. Serve the site

You need a local HTTP server because the browser fetches `photos.json` via `fetch()`.

**Option A — Python:**

```bash
python -m http.server 8000
```

**Option B — Node (npx):**

```bash
npx serve .
```

**Option C — VS Code Live Server extension**

Then open [http://localhost:8000](http://localhost:8000) in your browser.

## Project Structure

```
world-photos/
├── images/              ← Drop your photos here
├── index.html           ← Main page
├── style.css            ← Styles (dark theme)
├── script.js            ← Map + timeline logic
├── extract_exif.py      ← Python EXIF → JSON utility
├── photos.json          ← Generated data (git-ignored)
└── README.md
```

## Tech Stack

- **Leaflet.js** 1.9 — interactive map
- **noUiSlider** 15.7 — range slider for the timeline
- **CartoDB Dark Matter** — tile layer
- **Pillow** (Python) — EXIF extraction

## Notes

- Only images with **both** GPS coordinates and a date-taken field are included.
- The slider step is 1 day; dragging filters markers in real time.
- For best results, ensure your camera or phone embeds location data in photos.

## License

MIT — use freely for personal or commercial projects.
