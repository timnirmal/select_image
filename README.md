# Photo Selector Desktop App

A simple Tkinter app to browse images in a folder, quickly like/reject and rate them (1-5), and save results to CSV in the same folder.

## Requirements
- Python 3.9+
- macOS, Windows, or Linux

## Setup
```bash
cd /Users/timnirmal/Desktop/my/select_images
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt  # or: pip install pillow
```

## Run
```bash
python main.py
```

## Usage
- Click "Open Folder" and select a directory containing images.
- Gallery view: click any thumbnail to open the viewer.
- Viewer controls:
  - Left/Right arrows: previous/next
  - Space: like/unlike
  - 1..5: set score (default 5)
  - n: reject (clears like)
  - g: back to gallery
  - F11 or toolbar button: toggle fullscreen
  - Escape: exit fullscreen, or return to gallery
- Click "Save CSV" to write selections to `image_selections.csv` in the opened folder.

## CSV Format
Columns: `filename,path,liked,rejected,score` where liked/rejected are 1/0, score is 1-5.

## Supported Image Types
.jpeg, .jpg, .png, .bmp, .gif, .tiff, .webp

## Notes
- Changes are kept in memory until saved. You’ll be prompted to save on exit if there are unsaved changes.
- Large folders may take a moment to load thumbnails.
