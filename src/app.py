import os
import csv
import sys
import io
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from PIL import Image, ImageTk
from typing import List, Optional

try:
    import rawpy  # type: ignore
    HAS_RAWPY = True
except Exception:
    rawpy = None  # type: ignore
    HAS_RAWPY = False


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp"}
RAW_EXTENSIONS = {".nef", ".arw", ".cr2", ".cr3", ".dng", ".rw2", ".orf", ".raf", ".srw", ".pef", ".erf", ".3fr", ".iiq", ".mos", ".mef", ".nrw"}
SIDE_CAR_EXTENSIONS = {".xmp"}
IMAGE_EXTENSIONS = IMAGE_EXTENSIONS.union(RAW_EXTENSIONS)
DEFAULT_SCORE = 5
CSV_FILENAME = "image_selections.csv"
THUMB_SIZE = (200, 200)


class ImageRecord:
    def __init__(self, path: str) -> None:
        self.path: str = path
        self.filename: str = os.path.basename(path)
        self.liked: bool = False
        self.rejected: bool = False
        self.score: int = DEFAULT_SCORE

    def to_csv_row(self) -> List[str]:
        return [
            self.filename,
            self.path,
            "1" if self.liked else "0",
            "1" if self.rejected else "0",
            str(self.score),
        ]


class ImageGalleryApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Photo Selector")
        self.geometry("1200x800")
        self.minsize(900, 600)

        self.folder_path: Optional[str] = None
        self.images: List[ImageRecord] = []
        self.current_index: int = 0
        self.photo_cache: List[ImageTk.PhotoImage] = []
        self.thumb_cache: List[ImageTk.PhotoImage] = []
        self.viewer_photo: Optional[ImageTk.PhotoImage] = None
        self.is_fullscreen: bool = False
        self.is_dirty: bool = False

        # Cache the original PIL image for the current viewer to avoid re-decoding on resize
        self._current_viewer_original: Optional[Image.Image] = None
        self._current_viewer_path: Optional[str] = None

        # Apply a visible, stable ttk theme and base styles
        self._apply_theme()

        self._build_toolbar()
        self._build_menubar()
        self.container = ttk.Frame(self)
        self.container.pack(fill=tk.BOTH, expand=True)
        self.update_idletasks()

        self.gallery_canvas: Optional[tk.Canvas] = None
        self.gallery_inner: Optional[ttk.Frame] = None
        self.gallery_scrollbar: Optional[ttk.Scrollbar] = None

        self.viewer_frame: Optional[ttk.Frame] = None
        self.viewer_label: Optional[ttk.Label] = None
        self.viewer_status: Optional[ttk.Label] = None

        self.bind("<F11>", self._toggle_fullscreen_event)
        self.bind("<Escape>", self._escape_pressed)

        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # Launch folder chooser on start
        self.after(100, self.open_folder_dialog)

    # UI construction
    def _build_toolbar(self) -> None:
        self.toolbar = ttk.Frame(self)
        self.toolbar.pack(side=tk.TOP, fill=tk.X)

        self.open_btn = ttk.Button(self.toolbar, text="Open Folder", command=self.open_folder_dialog)
        self.open_btn.pack(side=tk.LEFT, padx=6, pady=6)

        self.save_btn = ttk.Button(self.toolbar, text="Save CSV", command=self.save_csv)
        self.save_btn.pack(side=tk.LEFT, padx=6, pady=6)

        self.gallery_btn = ttk.Button(self.toolbar, text="Gallery", command=self.show_gallery)
        self.gallery_btn.pack(side=tk.LEFT, padx=6, pady=6)

        self.viewer_btn = ttk.Button(self.toolbar, text="Viewer", command=self.show_viewer_current)
        self.viewer_btn.pack(side=tk.LEFT, padx=6, pady=6)

        self.fullscreen_btn = ttk.Button(self.toolbar, text="Toggle Fullscreen (F11)", command=self.toggle_fullscreen)
        self.fullscreen_btn.pack(side=tk.LEFT, padx=6, pady=6)

        self.status_var = tk.StringVar(value="No folder selected")
        self.status_label = ttk.Label(self.toolbar, textvariable=self.status_var, anchor=tk.W)
        self.status_label.pack(side=tk.RIGHT, padx=8)

    def _build_menubar(self) -> None:
        menubar = tk.Menu(self)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Open…", command=self.open_folder_dialog, accelerator="Cmd+O")
        file_menu.add_command(label="Save CSV", command=self.save_csv, accelerator="Cmd+S")
        file_menu.add_separator()
        file_menu.add_command(label="Quit", command=self._on_close, accelerator="Cmd+Q")
        menubar.add_cascade(label="File", menu=file_menu)

        view_menu = tk.Menu(menubar, tearoff=0)
        view_menu.add_command(label="Gallery", command=self.show_gallery)
        view_menu.add_command(label="Viewer", command=self.show_viewer_current)
        view_menu.add_command(label="Toggle Fullscreen", command=self.toggle_fullscreen, accelerator="F11")
        menubar.add_cascade(label="View", menu=view_menu)

        self.config(menu=menubar)

        # Bind common accelerators (macOS Command key)
        self.bind_all("<Command-o>", lambda e: self.open_folder_dialog())
        self.bind_all("<Command-s>", lambda e: self.save_csv())
        self.bind_all("<Command-q>", lambda e: self._on_close())

    # Data loading
    def open_folder_dialog(self) -> None:
        selected = filedialog.askdirectory(title="Select image folder")
        if not selected:
            return
        self.load_folder(selected)

    def _should_skip_entry(self, entry: str, full_path: str) -> bool:
        # Skip hidden entries, resource forks and sidecars
        if entry.startswith("._"):
            return True
        if entry.startswith('.'):
            return True
        if not os.path.isfile(full_path):
            return True
        _, ext = os.path.splitext(entry)
        if ext.lower() in SIDE_CAR_EXTENSIONS:
            return True
        return False

    def _gather_images_recursive(self, root_folder: str) -> (List[ImageRecord], int):
        images: List[ImageRecord] = []
        skipped = 0
        for dirpath, dirnames, filenames in os.walk(root_folder):
            # Skip hidden directories
            dirnames[:] = [d for d in dirnames if not d.startswith('.') and not d.startswith('._')]
            for entry in sorted(filenames):
                full_path = os.path.join(dirpath, entry)
                if self._should_skip_entry(entry, full_path):
                    skipped += 1
                    continue
                _, ext = os.path.splitext(entry)
                if ext.lower() in IMAGE_EXTENSIONS:
                    images.append(ImageRecord(full_path))
                else:
                    skipped += 1
        return images, skipped

    def load_folder(self, folder_path: str) -> None:
        self.folder_path = folder_path
        self.images = []
        self.photo_cache = []
        self.thumb_cache = []
        self.current_index = 0

        self.images, skipped = self._gather_images_recursive(folder_path)

        self.status_var.set(f"Loaded {len(self.images)} images (skipped {skipped}) from {folder_path}")
        if not self.images:
            messagebox.showinfo("No Images", "No supported images found in the selected folder.")
            self.show_empty_state()
            return

        self.show_gallery()

    # Gallery view
    def show_empty_state(self) -> None:
        for child in self.container.winfo_children():
            child.destroy()
        empty = ttk.Label(self.container, text="Open a folder to begin", anchor=tk.CENTER)
        empty.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)

    def show_gallery(self) -> None:
        for child in self.container.winfo_children():
            child.destroy()

        self.gallery_canvas = tk.Canvas(self.container, highlightthickness=0, background="#1e1e1e")
        self.gallery_scrollbar = ttk.Scrollbar(self.container, orient=tk.VERTICAL, command=self.gallery_canvas.yview)
        self.gallery_inner = ttk.Frame(self.gallery_canvas)

        self.gallery_inner.bind(
            "<Configure>",
            lambda e: self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all")),
        )

        inner_window = self.gallery_canvas.create_window((0, 0), window=self.gallery_inner, anchor="nw")

        def _resize_canvas(event: tk.Event) -> None:
            self.gallery_canvas.itemconfig(inner_window, width=event.width)

        self.gallery_canvas.bind("<Configure>", _resize_canvas)
        self.gallery_canvas.configure(yscrollcommand=self.gallery_scrollbar.set)

        self.gallery_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.gallery_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self._populate_thumbnails()

    def _populate_thumbnails(self) -> None:
        if self.gallery_inner is None:
            return
        for child in self.gallery_inner.winfo_children():
            child.destroy()

        # Compute grid columns from current width
        columns = max(1, self.gallery_inner.winfo_toplevel().winfo_width() // (THUMB_SIZE[0] + 20))
        if columns < 1:
            columns = 4
        self._thumb_columns = columns  # type: ignore[attr-defined]

        # Incremental loader state
        self._thumb_next_index = 0  # type: ignore[attr-defined]
        self._thumb_loading = True  # type: ignore[attr-defined]
        self.thumb_cache = []

        # Process thumbnails in small chunks to keep UI responsive
        def process_chunk() -> None:
            if self.gallery_inner is None:
                return
            CHUNK = 16
            made_any = False
            count = 0
            while self._thumb_next_index < len(self.images) and count < CHUNK:  # type: ignore[attr-defined]
                idx = self._thumb_next_index  # type: ignore[attr-defined]
                record = self.images[idx]
                try:
                    img = self._open_image_for_thumbnail(record.path)
                    img.thumbnail(THUMB_SIZE, Image.LANCZOS)
                    photo = ImageTk.PhotoImage(img)
                    self.thumb_cache.append(photo)
                except Exception as ex:
                    print(f"Failed to load thumbnail for {record.path}: {ex}")
                    self.thumb_cache.append(None)  # type: ignore
                    photo = None  # type: ignore

                frame = ttk.Frame(self.gallery_inner, relief=tk.RIDGE, borderwidth=1)
                r = idx // self._thumb_columns  # type: ignore[attr-defined]
                c = idx % self._thumb_columns  # type: ignore[attr-defined]
                frame.grid(row=r, column=c, padx=8, pady=8, sticky="nsew")

                if photo is not None:
                    label = ttk.Label(frame, image=photo)
                    label.image = photo
                else:
                    label = ttk.Label(frame, text="Failed", anchor=tk.CENTER)
                label.pack()

                caption_text = record.filename
                if record.rejected:
                    caption_text += "  [Rejected]"
                elif record.liked:
                    caption_text += f"  [Liked • {record.score}]"
                else:
                    caption_text += f"  [Score {record.score}]"
                caption = ttk.Label(frame, text=caption_text)
                caption.pack(pady=(4, 6))

                def _open(i=idx) -> None:
                    self.open_viewer(i)

                label.bind("<Button-1>", lambda e, i=idx: _open(i))
                frame.bind("<Button-1>", lambda e, i=idx: _open(i))

                self._thumb_next_index += 1  # type: ignore[attr-defined]
                count += 1
                made_any = True

            # Force layout updates so content becomes visible
            try:
                self.gallery_inner.update_idletasks()
                if self.gallery_canvas is not None:
                    self.gallery_canvas.configure(scrollregion=self.gallery_canvas.bbox("all"))
            except Exception:
                pass

            self.status_var.set(f"Rendering thumbnails {min(self._thumb_next_index, len(self.images))}/{len(self.images)}")  # type: ignore[attr-defined]

            if self._thumb_next_index < len(self.images):  # type: ignore[attr-defined]
                self.after(1, process_chunk)
            else:
                self._thumb_loading = False  # type: ignore[attr-defined]
                self.status_var.set(f"Ready • {len(self.images)} images")

    # Viewer view
    def show_viewer_current(self) -> None:
        if not self.images:
            self.show_empty_state()
            return
        self.open_viewer(self.current_index)

    def open_viewer(self, index: int) -> None:
        if index < 0 or index >= len(self.images):
            return
        self.current_index = index

        for child in self.container.winfo_children():
            child.destroy()

        self.viewer_frame = ttk.Frame(self.container)
        self.viewer_frame.pack(fill=tk.BOTH, expand=True)

        self.viewer_label = ttk.Label(self.viewer_frame, anchor=tk.CENTER, background="#000000")
        self.viewer_label.pack(fill=tk.BOTH, expand=True)

        self.viewer_status = ttk.Label(self.viewer_frame, anchor=tk.CENTER)
        self.viewer_status.pack(fill=tk.X)

        # Bind a resize handler that only resizes from cached original image
        if self.viewer_label is not None:
            self.viewer_label.bind("<Configure>", self._on_viewer_resize)

        self._render_current_image()
        self._bind_viewer_keys()

    def _bind_viewer_keys(self) -> None:
        self.bind("<Left>", self._prev_image)
        self.bind("<Right>", self._next_image)
        self.bind("<space>", self._toggle_like)
        for n in ["1", "2", "3", "4", "5"]:
            self.bind(n, self._set_score_factory(int(n)))
        self.bind("n", self._reject)
        self.bind("g", self._back_to_gallery)
        self.bind("f", self._toggle_fullscreen_event)

    def _render_current_image(self) -> None:
        if self.viewer_label is None or self.viewer_status is None:
            return
        record = self.images[self.current_index]
        try:
            # Load original only when switching image or cache missing
            if self._current_viewer_path != record.path or self._current_viewer_original is None:
                self._current_viewer_original = self._open_image_full(record.path)
                self._current_viewer_path = record.path

            frame_width = self.viewer_label.winfo_width() or self.viewer_label.winfo_toplevel().winfo_width()
            frame_height = self.viewer_label.winfo_height() or (self.viewer_label.winfo_toplevel().winfo_height() - 80)
            if frame_width < 50 or frame_height < 50:
                frame_width, frame_height = 1200, 700

            img = self._resize_to_fit(self._current_viewer_original, frame_width, frame_height)
            self.viewer_photo = ImageTk.PhotoImage(img)
            self.viewer_label.configure(image=self.viewer_photo, text="")
        except Exception as ex:
            print(f"Failed to open {record.path}: {ex}")
            self.viewer_label.configure(text=f"Failed to open: {record.filename}", image="")

        status = self._status_for_record(record)
        self.viewer_status.configure(text=status)

        # Update window title with progress
        self.title(f"Photo Selector - {record.filename}  [{self.current_index + 1}/{len(self.images)}]")

    def _on_viewer_resize(self, event=None) -> None:
        if self.viewer_label is None or self._current_viewer_original is None:
            return
        frame_width = self.viewer_label.winfo_width()
        frame_height = self.viewer_label.winfo_height()
        if frame_width < 2 or frame_height < 2:
            return
        img = self._resize_to_fit(self._current_viewer_original, frame_width, frame_height)
        self.viewer_photo = ImageTk.PhotoImage(img)
        self.viewer_label.configure(image=self.viewer_photo)

    def _resize_to_fit(self, img: Image.Image, frame_width: int, frame_height: int) -> Image.Image:
        img_ratio = img.width / img.height
        frame_ratio = frame_width / frame_height
        if img_ratio > frame_ratio:
            new_width = frame_width
            new_height = int(new_width / img_ratio)
        else:
            new_height = frame_height
            new_width = int(new_height * img_ratio)
        return img.resize((max(1, new_width), max(1, new_height)), Image.LANCZOS)

    def _status_for_record(self, record: ImageRecord) -> str:
        if record.rejected:
            state = "Rejected"
        elif record.liked:
            state = f"Liked • Score {record.score}"
        else:
            state = f"Score {record.score}"
        return (
            f"{record.filename}  |  {state}  |  Space: Like  •  n: Reject  •  1-5: Score  •  ←/→: Prev/Next  •  g: Gallery"
        )

    # Key handlers
    def _prev_image(self, event=None) -> None:
        if not self.images:
            return
        self.current_index = (self.current_index - 1) % len(self.images)
        # Reset cache when switching image
        self._current_viewer_original = None
        self._current_viewer_path = None
        self._render_current_image()

    def _next_image(self, event=None) -> None:
        if not self.images:
            return
        self.current_index = (self.current_index + 1) % len(self.images)
        # Reset cache when switching image
        self._current_viewer_original = None
        self._current_viewer_path = None
        self._render_current_image()

    def _toggle_like(self, event=None) -> None:
        record = self.images[self.current_index]
        if record.rejected:
            record.rejected = False
        record.liked = not record.liked
        self.is_dirty = True
        self._render_current_image()

    def _reject(self, event=None) -> None:
        record = self.images[self.current_index]
        record.rejected = True
        record.liked = False
        self.is_dirty = True
        self._render_current_image()

    def _set_score_factory(self, value: int):
        def _set_score(event=None) -> None:
            record = self.images[self.current_index]
            record.score = value
            self.is_dirty = True
            self._render_current_image()
        return _set_score

    def _back_to_gallery(self, event=None) -> None:
        self.show_gallery()

    # Fullscreen and window
    def toggle_fullscreen(self) -> None:
        self.is_fullscreen = not self.is_fullscreen
        self.attributes("-fullscreen", self.is_fullscreen)

    def _toggle_fullscreen_event(self, event=None) -> None:
        self.toggle_fullscreen()

    def _escape_pressed(self, event=None) -> None:
        if self.is_fullscreen:
            self.toggle_fullscreen()
        else:
            # In viewer, go back to gallery on Escape
            if self.viewer_frame is not None and self.viewer_frame.winfo_exists():
                self.show_gallery()

    # CSV persistence
    def save_csv(self) -> None:
        if not self.folder_path:
            messagebox.showinfo("No Folder", "Open a folder before saving.")
            return
        out_path = os.path.join(self.folder_path, CSV_FILENAME)
        try:
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["filename", "path", "liked", "rejected", "score"])
                for rec in self.images:
                    writer.writerow(rec.to_csv_row())
            self.is_dirty = False
            self.status_var.set(f"Saved CSV to {out_path}")
        except Exception as ex:
            messagebox.showerror("Save Failed", f"Could not save CSV: {ex}")

    def _maybe_save_prompt(self) -> bool:
        if not self.is_dirty:
            return True
        if not self.folder_path:
            return True
        response = messagebox.askyesnocancel(
            "Unsaved Changes",
            "You have unsaved changes. Save to CSV before exiting?",
        )
        if response is None:
            return False
        if response is True:
            self.save_csv()
            return True
        return True

    def _on_close(self) -> None:
        if self._maybe_save_prompt():
            self.destroy()

    # Image loading helpers
    def _is_raw_path(self, path: str) -> bool:
        _, ext = os.path.splitext(path)
        return ext.lower() in RAW_EXTENSIONS

    def _open_image_for_thumbnail(self, path: str) -> Image.Image:
        if self._is_raw_path(path) and HAS_RAWPY:
            try:
                with rawpy.imread(path) as raw:  # type: ignore
                    try:
                        thumb = raw.extract_thumb()  # type: ignore
                        if thumb.format == rawpy.ThumbFormat.JPEG:  # type: ignore
                            return Image.open(io.BytesIO(thumb.data))
                        else:
                            # BITMAP returns RGB numpy array
                            return Image.fromarray(thumb.data)
                    except Exception:
                        # No thumb -> quick postprocess (half size for speed)
                        rgb = raw.postprocess(use_auto_wb=True, no_auto_bright=True, output_bps=8, half_size=True)  # type: ignore
                        return Image.fromarray(rgb)
            except Exception as ex:
                print(f"RAW thumb fallback failed for {path}: {ex}")
        # Non-RAW or rawpy missing -> standard open
        return Image.open(path)

    def _open_image_full(self, path: str) -> Image.Image:
        if self._is_raw_path(path) and HAS_RAWPY:
            try:
                with rawpy.imread(path) as raw:  # type: ignore
                    # Full decode; half_size speeds up and is enough for screen viewing
                    rgb = raw.postprocess(use_auto_wb=True, no_auto_bright=True, output_bps=8, half_size=True)  # type: ignore
                    return Image.fromarray(rgb)
            except Exception as ex:
                print(f"RAW full decode failed for {path}: {ex}")
        return Image.open(path)

    def _apply_theme(self) -> None:
        try:
            style = ttk.Style()
            # Prefer 'clam' for consistent rendering across platforms
            if 'clam' in style.theme_names():
                style.theme_use('clam')
            # Ensure basic widget backgrounds/foregrounds are visible
            style.configure('TFrame', background='#2b2b2b')
            style.configure('TLabel', background='#2b2b2b', foreground='#e6e6e6')
            style.configure('TButton', padding=6)
        except Exception:
            pass


def run_app() -> None:
    try:
        app = ImageGalleryApp()
        app.mainloop()
    except KeyboardInterrupt:
        sys.exit(0)
