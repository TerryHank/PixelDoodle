<p align="center">
  <img src="docs/logo.png" width="200" alt="Pixel Doodle Logo">
</p>

<h1 align="center">Pixel Doodle</h1>

<p align="center">
  像素豆绘 - Perler Bead Pattern Generator<br>
  Convert any image into a Perler/Artkal bead pattern with 64x64 LED Matrix display support.
</p>

<p align="center">
  <strong>Version: 1.26.316</strong>
</p>

## Features

- 🎨 **Image to Bead Pattern**: Convert any photo/illustration to pixel-perfect bead layout
- 📱 **Mobile Friendly**: Responsive UI with touch support
- 🔌 **Hardware Support**: ESP32 LED Matrix (64x64) display via Serial/Bluetooth
- 🌐 **Multi-language**: Chinese and English UI
- 📤 **Export**: PNG and PDF export with color codes and coordinates

## Project Structure

```
PixelDoodle/
├── main.py                 # FastAPI backend entry
├── core/                   # Backend logic
│   ├── color_match.py      # Color matching (CIE Lab)
│   ├── quantizer.py        # Image quantization
│   ├── serial_export.py    # Serial communication
│   └── ble_export.py       # BLE communication
├── firmware/               # ESP32 firmware
│   ├── src/main.cpp        # Firmware entry
│   ├── lib/beadcraft-receiver/  # Serial receiver library
│   └── tools/              # Chinese pixel generator
├── static/                 # Frontend JS/CSS
├── templates/              # HTML templates
└── data/                   # Color palette data
```

## Tech Stack

- **Backend**: Python 3.8+ / FastAPI / Uvicorn
- **Image Processing**: Pillow / NumPy
- **Color Matching**: CIE Lab color space (Euclidean distance)
- **Export**: Pillow (PNG) / ReportLab (PDF)
- **Frontend**: Vanilla JS + Jinja2 templates
- **ESP32 Firmware**: PlatformIO / Arduino framework

## Quick Start

### Backend (Web Application)

```bash
cd PixelDoodle
pip install -r requirements.txt
python main.py
# Server runs at http://localhost:8000
```

### ESP32 Firmware

Requirements:
- [PlatformIO](https://platformio.org/) installed
- ESP32 development board
- 64x64 HUB75 LED Matrix

```bash
cd PixelDoodle/firmware
pio run -t upload
```

**Dependencies** (auto-downloaded by PlatformIO):
- [ESP32-HUB75-MatrixPanel-I2S-DMA](https://github.com/mrfaptastic/ESP32-HUB75-MatrixPanel-I2S-DMA) - LED Matrix driver
- [Adafruit GFX Library](https://github.com/adafruit/Adafruit-GFX-Library) - Graphics primitives

## Examples

### Cartoon / Illustration (96x96 grid, background removed)

| Original | Mosaic Preview | Bead Pattern |
|:--------:|:--------------:|:------------:|
| <img src="docs/examples/luoxiaohei_thumb.png" width="200"> | <img src="docs/examples/luoxiaohei_mosaic.png" width="200"> | <img src="docs/examples/luoxiaohei_pattern.png" width="200"> |
| <img src="docs/examples/pony_thumb.png" width="200"> | <img src="docs/examples/pony_mosaic.png" width="200"> | <img src="docs/examples/pony_pattern.png" width="200"> |

### Photography (72x96 grid)

| Original | Mosaic Preview | Bead Pattern |
|:--------:|:--------------:|:------------:|
| <img src="docs/examples/meili_thumb.png" width="200"> | <img src="docs/examples/meili_mosaic.png" width="200"> | <img src="docs/examples/meili_pattern.png" width="200"> |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Main web UI |
| GET | `/api/palette` | Full palette data + presets |
| POST | `/api/generate` | Upload image, return bead pattern |
| POST | `/api/export/png` | Export pattern as PNG |
| POST | `/api/export/pdf` | Export pattern as PDF |

Interactive API docs at `/docs`.

## License

MIT License
