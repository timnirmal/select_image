I need to make a photo viewing and selecting application.. this should include gallery view and full screen view.

through arrow keys i need to move
through spacebar images will be liked. ( selected )
default score will be 5 ( 1,2,3,4,5)

also from presssing 1,2,3,4,5 we can give value..
button n to reject 

save the result in csv file in folder path

create good UI 

---

Done so far
- Basic Electron app scaffolded with gallery and viewer.
- Keyboard controls: Arrow keys navigate, Space toggles like, 1..5 set score, N rejects, G toggles gallery.
- CSV is created and updated in the chosen folder (`image_selections.csv`).
- Loads images (incl. RAW via embedded previews) into memory for fast viewing.
- Thumbnails generated and cached per folder to `.thumbnails`.
- Zoom in viewer via mouse wheel/trackpad (Ctrl/Cmd + wheel adjusts zoom; preset zooms via dropdown).
- Panning when zoomed: drag with mouse to move image; two‑finger scroll pans.

Next steps (to improve usability)
- Add Windows Explorer integration: context menu or "Open in Explorer" button for current image/folder.
- Add file browser sidebar to pick folders within the app (recents, favorites).
- Smooth zoom to cursor position (zoom centers under mouse pointer).
- Double‑click to toggle between Fit and 100% zoom.
- Better viewer controls: on‑screen zoom in/out, reset, and next/prev buttons.
- Fullscreen mode (F11) and optional borderless viewer.
- Optional EXIF overlay (camera, lens, shutter, ISO) in viewer.
- Filtering/sorting in gallery (liked, rejected, score range).
- Batch operations on multi‑select (set score/reject, export selection list).
- Performance: progressive image decoding and worker thread for heavy RAW preview extraction.
- Settings persistence (last opened folder, UI prefs, thumbnail size).
- Export selected/accepted images to a subfolder or copy/move operations.