# zPlayer — Complete Feature & Architecture Reference

> This document is a complete technical specification for the zPlayer application. It is written so that an AI or developer can rebuild the same application from scratch in React Native (Expo) for Android, with full feature parity. Read every section before writing any code.

---

## 1. What Is zPlayer

zPlayer is an all-in-one offline-first file manipulation tool for images and PDFs. It runs entirely in the browser/app — no server needed for any core operations. All image and PDF processing uses the device's own Canvas/rendering APIs. Optional cloud features (OCR via Gemini AI, cloud save via Supabase) require network.

**Core philosophy:** Everything must work without a login. Files never leave the device unless the user explicitly triggers an AI or cloud feature.

---

## 2. Data Model

### FileItem (central data structure)

Every file loaded into zPlayer becomes a `FileItem`. This is the single source of truth for everything.

```typescript
type FileItem = {
  id: string              // random unique ID (nanoid-style)
  name: string            // display name (user can rename)
  originalName: string    // original file name, never changes
  type: 'image' | 'pdf-page' | 'other'
  dataUrl: string         // current state (base64 data URL) — changes after edits
  originalDataUrl: string // snapshot at load time — never changes, used for before/after
  rotation: number        // 0 | 90 | 180 | 270
  size: number            // bytes (approximate after edits)
  extractedText: string   // OCR/AI extracted text (empty string if none)
  pageNum?: number        // only for pdf-page type, 1-indexed
  fileTypeInfo: string    // 'JPEG' | 'PNG' | 'PDF' | 'WEBP' | 'HEIC' | etc.
  lastModified: number    // Unix timestamp ms
  dimensions?: string     // '1920×1080' string
  software?: string       // EXIF software tag or PDF creator
  metadata?: Record<string, string>  // key-value pairs shown in file info panel
}
```

### Supporting types

```typescript
type Tool = 'files' | 'merge' | 'extract' | 'convert' | 'split'
// 'files' = default grid view
// 'merge' = merge selected to PDF panel
// 'extract' = bulk text extract panel
// 'convert' = format convert panel
// 'split' = PDF page range splitter panel

type NotifType = 'success' | 'error' | 'warn' | 'info'
type Notif = { id: string; msg: string; type: NotifType }
```

---

## 3. State Inventory

All state lives in a single top-level component. There are no global stores or context providers (except whatever the surrounding app provides for auth).

### File state
| State | Type | Purpose |
|-------|------|---------|
| `files` | `FileItem[]` | All loaded files, in display order |
| `selected` | `Set<string>` | IDs of checked/selected cards |
| `extractedTexts` | `Record<string, string>` | `{fileId: extractedText}` — mirrors `file.extractedText` but kept separately for quick reads |
| `showOriginal` | `Set<string>` | IDs where before/after toggle shows original |
| `focusedCardId` | `string \| null` | The one card that has keyboard focus for D/R/C/Del shortcuts |

### UI state
| State | Type | Purpose |
|-------|------|---------|
| `activeTool` | `Tool` | Which tool panel is open below the grid |
| `dragging` | `boolean` | Drop zone is active (file dragged over app) |
| `loading` | `boolean` | Global loading overlay visible |
| `loadingMsg` | `string` | Message shown in loading overlay |
| `notifs` | `Notif[]` | Toast notification queue |
| `editingId` | `string \| null` | Which card filename is being edited inline |
| `editingName` | `string` | Current value during inline rename |
| `dragId` | `string \| null` | ID of card being dragged for reorder |
| `dragOver` | `string \| null` | ID of card being dragged over |
| `apiKey` | `string` | Gemini API key (persisted to localStorage) |
| `showApiPanel` | `boolean` | API key input panel visible |
| `ocrProgress` | `number` | 0–100 progress for Tesseract OCR |

### Modal state
| State | Type | Purpose |
|-------|------|---------|
| `zoomFile` | `FileItem \| null` | Single file fullscreen zoom overlay |
| `galleryOpen` | `boolean` | Slideshow gallery open |
| `galleryIndex` | `number` | Current index in gallery |
| `annotateFile` | `FileItem \| null` | File open for annotation |
| `annotateRotatedUrl` | `string` | Pre-rotated image URL for the annotation canvas |
| `cropFile` | `FileItem \| null` | File open for crop |
| `bulkCropIds` | `string[]` | Additional IDs to apply same crop to |
| `compressModal` | `{ids, type} \| null` | Compress settings modal |
| `resizeModal` | `{ids} \| null` | Resize settings modal |
| `convertModal` | `{ids} \| null` | Format convert modal |
| `watermarkModal` | `{ids} \| null` | Watermark settings modal |
| `signModal` | `{id} \| null` | E-signature modal (single file only) |
| `dateStampModal` | `{ids} \| null` | Date stamp modal |
| `compareIds` | `[string, string] \| null` | Side-by-side compare — exactly 2 file IDs |
| `metaFileId` | `string \| null` | File info/metadata modal |
| `textEditorOpen` | `boolean` | Rich text editor panel open |
| `textEditorFullscreen` | `boolean` | Text editor in fullscreen mode |

### Annotation sub-state
| State | Type | Purpose |
|-------|------|---------|
| `annotateMode` | `'draw' \| 'highlight' \| 'text'` | Active annotation tool |
| `annotateColor` | `string` | Hex color for annotation |
| `annotateSize` | `number` | Brush size (1–12 range) |
| `annotateText` | `string` | Text to stamp in text mode |
| `isDrawing` | `boolean` | Mouse/finger is currently down on canvas |

### Compress sub-state
| State | Type | Purpose |
|-------|------|---------|
| `compressQuality` | `number` | 1–100 JPEG quality |
| `compressTargetKB` | `string` | Target file size in KB (optional mode) |
| `compressSizeMode` | `boolean` | Whether using target KB mode |

### Resize sub-state
| State | Type | Purpose |
|-------|------|---------|
| `resizeW` / `resizeH` | `string` | Width/height inputs |
| `resizeLock` | `boolean` | Aspect ratio locked |
| `resizeMode` | `'px' \| 'pct'` | Pixels or percentage |

### Watermark sub-state
| State | Type | Purpose |
|-------|------|---------|
| `wmText` | `string` | Watermark text (default 'CONFIDENTIAL') |
| `wmFontSize` | `number` | Font size in px (applied on original image dimensions) |
| `wmOpacity` | `number` | 0–100 opacity |
| `wmColor` | `string` | Hex color |
| `wmPosition` | `'center' \| 'tl' \| 'tr' \| 'bl' \| 'br' \| 'tile'` | Position |
| `wmAngle` | `number` | Rotation in degrees (default -30) |

### Date stamp sub-state
| State | Type | Purpose |
|-------|------|---------|
| `dsFormat` | `'datetime' \| 'date' \| 'time' \| 'custom'` | What text to stamp |
| `dsCustomText` | `string` | Used when format = 'custom' |
| `dsPosition` | `'br' \| 'bl' \| 'tr' \| 'tl' \| 'center'` | Corner position |
| `dsColor` | `string` | Text color hex |
| `dsFontSize` | `number` | Font size px |
| `dsOpacity` | `number` | 0–100 opacity |
| `dsBg` | `boolean` | Whether to draw a dark background box behind text |

### E-Signature sub-state
| State | Type | Purpose |
|-------|------|---------|
| `signTab` | `'draw' \| 'type'` | Draw your signature or type it |
| `signText` | `string` | Text for typed signature |
| `signFont` | `string` | CSS font family ('cursive', 'serif', etc.) |
| `signColor` | `string` | Signature color |
| `signPos` | `'br' \| 'bl' \| 'tr' \| 'tl' \| 'center'` | Placement |
| `signDrawing` | `boolean` | Mouse/finger down on signature canvas |

### Text editor sub-state
| State | Type | Purpose |
|-------|------|---------|
| `textTitle` | `string` | Document title |
| `strictMode` | `boolean` | If true, paste strips all HTML (plain text only) |
| `editorPageCount` | `number` | Live-calculated page count based on content height |

### PDF sub-state
| State | Type | Purpose |
|-------|------|---------|
| `splitFrom` / `splitTo` | `number` | Page range for PDF splitter |

---

## 4. Refs (non-reactive state)

These are `useRef` values — they don't trigger re-renders.

| Ref | Type | Purpose |
|-----|------|---------|
| `filesRef` | `FileItem[]` | Mirror of `files` state — used in keyboard/event handlers to avoid stale closures |
| `zoomFileRef` | `FileItem \| null` | Mirror of `zoomFile` for keyboard handler |
| `focusedCardIdRef` | `string \| null` | Mirror of `focusedCardId` for keyboard handler |
| `strictModeRef` | `boolean` | Mirror of `strictMode` for paste handler |
| `textEditorOpenRef` | `boolean` | Mirror of `textEditorOpen` for paste handler |
| `annotateCanvasRef` | `HTMLCanvasElement` | The annotation drawing canvas element |
| `annotateSnapshot` | `ImageData \| null` | Snapshot before a highlight drag — used to restore canvas each frame during highlight preview |
| `annotateHlStart` | `{x, y} \| null` | Start point of current highlight drag |
| `lastPoint` | `{x, y} \| null` | Last draw point for freehand line |
| `signCanvasRef` | `HTMLCanvasElement` | E-signature drawing canvas |
| `signLastPt` | `{x, y} \| null` | Last point on signature canvas |
| `editorRef` | `HTMLDivElement` | The contenteditable rich text editor div |
| `cropContainerRef` | `HTMLDivElement` | The crop image container for coordinate math |
| `historyRef` | `FileItem[][]` | Undo/redo history stack (max 15 snapshots) |
| `historyIdxRef` | `number` | Current position in history stack |
| `processFilesRef` | `function` | Stable ref to `processFiles` — lets the paste handler call it without being a dependency |
| `inputRef` | `HTMLInputElement` | The hidden file picker input |

---

## 5. localStorage Keys

| Key | Value | Purpose |
|-----|-------|---------|
| `zplayer_apiKey` | `string` | Gemini API key |
| `zplayer_state` | `JSON {files, et}` | Full session auto-save (debounced 1.5 s) |
| `zp_prefs` | `JSON object` | User preferences: compressQuality, convertFormat, wmText, wmOpacity, wmFontSize, wmColor, wmPosition, dsFormat, dsPosition, dsColor, dsFontSize, dsOpacity, dsBg |

Session restore: on init, load `zplayer_state`, restore files but reset `dataUrl` to `originalDataUrl` (edits are not re-applied — this is intentional, raw file is restored).

Preferences restore: on init, load `zp_prefs` and apply to corresponding state. Preferences are saved when the user applies an operation (not when modal closes).

---

## 6. File Ingestion

### Supported inputs
1. **File picker** — button triggers hidden `<input type="file" multiple accept="image/*,.pdf,.heic,.heif" />`
2. **Drag and drop** — drop zone over the entire app
3. **Clipboard paste** — global `document.addEventListener('paste', ...)` — catches images pasted from clipboard (screenshots, copied images). If text is pasted, opens the rich text editor instead.

### HEIC handling
HEIC/HEIF files are detected by MIME type or extension. They are converted to JPEG first using the `heic2any` library (loaded from CDN on demand) before processing as a normal image.

### Image processing pipeline
1. Read file as data URL (FileReader)
2. Load into an `<img>` to get natural dimensions
3. Parse JPEG EXIF metadata (custom inline parser — no library needed)
4. Build `FileItem` with all metadata
5. Append to `files` state

### PDF processing pipeline
1. Load `pdf.js` from CDN (with worker URL set)
2. Load PDF from ArrayBuffer
3. Extract PDF metadata (title, author, creator, etc.)
4. For each page: render to a 1.5× scale canvas, export as PNG data URL
5. Each page becomes a separate `FileItem` with `type: 'pdf-page'` and `pageNum`

### Supported file types
JPEG, PNG, GIF, WEBP, SVG, BMP, TIFF, AVIF, ICO, HEIC/HEIF, PDF. Any other image/* subtype is also accepted. Unknown types show a generic card with no image preview.

---

## 7. EXIF Parser (inline, no library)

A custom JPEG EXIF reader is included directly in the code. It:
1. Decodes the first ~64 KB of the base64 data URL
2. Scans for the `0xFFE1` APP1 marker with "Exif" header
3. Parses the TIFF IFD0 directory
4. Extracts: Description, Make, Model, Software, Date, Artist, Copyright

Tags extracted: camera make/model, capture date, software, artist, copyright, description.

---

## 8. Feature Catalog

### 8.1 File Grid
- Files displayed in a responsive grid (1–4 columns depending on screen width)
- Each card shows: drag handle, filename (editable inline), checkbox, thumbnail, rotate button (on hover), before/after toggle (if edited), zoom overlay, metadata bar, action buttons
- Cards are reorderable by drag-and-drop
- Click card = toggle keyboard focus (blue ring). When focused: D=download, R=rotate, C=crop, Del=remove

### 8.2 Selection System
- Checkbox per card
- "All", "None", "By type" (images / PDF pages) selector buttons
- Selected count shown in batch bar header
- Batch bar appears only when `selected.size > 0`

### 8.3 Batch Bar Operations
All batch operations target `selectedFiles` (files whose ID is in `selected`):

| Button | Action |
|--------|--------|
| Extract text | Runs OCR/AI on all selected files sequentially |
| Merge PDF | Merges selected files into a single downloadable PDF |
| ZIP | Packages selected files as PNG files in a ZIP archive |
| Text | Downloads extracted text as .txt file |
| Copy text | Copies extracted text to clipboard |
| Bulk Crop | Opens crop UI; same crop rect applied to all selected images |
| Compress | Opens compress modal (image or PDF mode) |
| PDF (compressed) | Opens compress modal in PDF mode |
| Resize | Opens resize modal |
| Convert | Opens format convert modal |
| Watermark | Opens watermark modal |
| Date Stamp | Opens date stamp modal |
| Compare | Opens side-by-side compare (first 2 selected images) |

### 8.4 Card Action Buttons
Each card has a row of small action buttons (icons only with tooltips):

| Button | Action |
|--------|--------|
| Download | Download as PNG (with rotation applied via canvas) |
| PDF | Download as single-image PDF |
| Fullscreen | Open zoom overlay |
| Gallery | Open slideshow at this file's index |
| Extract text | OCR/AI for this single file |
| Annotate | Open annotation canvas |
| Crop | Open crop UI (single file) |
| Compress | Open compress modal for this file |
| Resize | Open resize modal for this file |
| Convert | Open format convert modal for this file |
| Watermark | Open watermark modal for this file |
| E-Signature | Open signature placement modal for this file |
| Date Stamp | Open date stamp modal for this file |

### 8.5 Rotation
- 90° clockwise per click, wraps at 360
- Stored as integer (0/90/180/270) on the FileItem
- Applied via canvas transform at download/export time (`getRotatedDataUrl`)
- Displayed in the card via CSS `transform: rotate(Xdeg)` — no canvas work at display time

### 8.6 Crop
1. User opens crop UI
2. A full-size version of the image is shown
3. User click-drags to define crop rectangle
4. Crop rect stored as normalized 0–1 coordinates (relative to display div dimensions)
5. On apply: coordinates are multiplied by `img.naturalWidth/Height` to get pixel rect
6. Canvas `drawImage` with `sx, sy, sw, sh` copies the crop region
7. `dataUrl` and `originalDataUrl` are both updated to the cropped version
8. In bulk crop mode: same normalized rect applied to all selected images (each scaled independently)

### 8.7 Compress
**Image mode:**
- User sets quality (1–100 JPEG) or target KB
- Canvas re-renders each image, exports as JPEG with the given quality
- `dataUrl` updated in place, `size` updated to estimated new size

**PDF mode:**
- Selected files rendered into a new PDF using jsPDF
- Each page JPEG-compressed at chosen quality
- PDF downloaded immediately (does not update `dataUrl`)

### 8.8 Resize
- User enters width and height in px or percentage
- Aspect ratio lock: when locked, changing one dimension auto-calculates the other
- Canvas is resized and `drawImage` stretches/shrinks the image
- Both `dataUrl` and `originalDataUrl` updated (resize is non-destructive in the undo sense — undo restores previous size)
- Applies to multiple files; each is resized to the same absolute pixel dimensions

### 8.9 Format Convert
- Target formats: JPEG, PNG, WebP
- Quality slider (for JPEG/WebP)
- For JPEG: fills canvas with white background first (handles transparency)
- Downloads the converted file immediately — does **not** update the card's dataUrl (convert = export only)

### 8.10 Watermark
Parameters: text, font size, opacity (0–100), color (hex), position (center/tl/tr/bl/br/tile), angle (degrees)

**Tile mode:** canvas is rotated by `wmAngle`, then text is stamped in a grid pattern covering the entire image, extending beyond bounds to fill all corners after rotation.

**Single position mode:** canvas translate+rotate to the target position, then `fillText`.

Updates `dataUrl` in place on all targeted files.

### 8.11 Date Stamp
Like watermark but instead of custom text:
- `datetime`: `new Date().toLocaleString()` 
- `date`: `new Date().toLocaleDateString()`
- `time`: `new Date().toLocaleTimeString()`
- `custom`: user-supplied string

Parameters: position (br/bl/tr/tl/center), color, font size, opacity, dark background box toggle.

The background box: when enabled, a semi-opaque black rectangle is drawn behind the text. Box dimensions calculated from `ctx.measureText(text).width + padding` and `fontSize * 1.5`. Box origin adjusted based on text alignment (right/left/center) and baseline (bottom/middle/top).

### 8.12 E-Signature
Two modes:

**Draw mode:**
- 360×120px canvas, transparent background
- Mouse/touch events draw freehand strokes (lineWidth 2.5, round caps)
- Clear button resets canvas

**Type mode:**
- User types their name
- Rendered using a 48px cursive (or selected) font onto a 400×100px canvas

Both modes: signature image rendered at 30% of target image width, aspect-ratio-preserved height, placed at selected corner or center.

### 8.13 Annotation
Full-screen overlay with a canvas drawn over the image.

**Three modes:**

**Draw:** Freehand strokes. `ctx.lineTo` from last point to current point. Color + brush size sliders.

**Highlight:** Click-drag draws a semi-transparent (0.35 alpha) rectangle. During drag, `putImageData` restores the canvas to a pre-drag snapshot each frame, then redraws the highlight rect — this creates a live preview. On mouseup, the rect is committed.

**Text:** Click anywhere to stamp `annotateText` at that point. No dragging.

Saving: merges the annotation canvas on top of the base image canvas → exports as PNG → updates `dataUrl`.

Color palette: 8 fixed colors — red, orange, yellow, green, blue, purple, white, black.

### 8.14 Side-by-side Compare
Full-screen modal with two panels side by side. Each panel shows:
- File name header
- The image (`dataUrl`) scaled to fill the panel
- Image dimensions below

Only works with image/pdf-page type files. Requires exactly 2 files selected (uses first 2 from selection).

### 8.15 Zoom / Fullscreen
Single file fullscreen overlay:
- Left/right arrow keys navigate between files
- Image shown at natural size (scrollable if larger than viewport)
- Keyboard Escape closes

### 8.16 Gallery / Slideshow
Full-screen slideshow:
- Left/right arrow keys navigate
- Current index / total shown
- Thumbnails strip at bottom (optional, scroll to current)

### 8.17 Text Extraction (OCR)
**With Gemini API key:**
- Sends `originalDataUrl` as base64 inline data to Gemini 2.0 Flash
- Model: `gemini-2.0-flash`
- Prompt: "Extract all text from this image. Output only the text, nothing else."
- Result stored in `extractedTexts[fileId]` and `file.extractedText`

**Without API key (Tesseract.js v2 fallback):**
- Loads Tesseract.js from CDN
- `T.recognize(originalDataUrl, 'eng', { logger })` 
- Logger updates `ocrProgress` state and loading message with percentage
- Same result storage

### 8.18 Rich Text Editor
Opens as a slide-in panel (or fullscreen). A `contenteditable` div styled to look like an A4 page.

**Page visualization:** CSS `backgroundImage` using a repeating linear gradient that draws a 2px gray separator line + 20px gap every `297mm` — simulates page breaks visually.

**Page count tracking:** A `ResizeObserver` on the editor div calculates page count from `scrollHeight / (offsetWidth * 297/210)` (A4 aspect ratio).

**Formatting toolbar:** bold, italic, underline, strikethrough, H1/H2/H3, unordered list, ordered list, text color.

**Export options:**
- Download as PDF: renders the div with html2canvas at 2× scale, slices into A4-sized canvas tiles, adds each slice as a PDF page via jsPDF
- Download as .doc: wraps innerHTML in Word-compatible HTML, downloads as .doc blob
- Download as images: same html2canvas approach, saves each page as PNG
- Copy text: `innerText` to clipboard

**Paste handling:**
- Global paste when editor is closed: if HTML is pasted, opens editor and sets innerHTML (sanitized). If plain text, opens editor with paragraph-converted HTML.
- Inside editor: intercepts paste, strips unsafe HTML (sanitizeHtml), inserts clean HTML or plain text.
- Strict mode: always strips to plain text, no rich formatting.

**Text from OCR:** Any file's extracted text can be "Open in editor" → `openEditorWith(text, false)` which wraps paragraphs in `<p>` tags.

### 8.19 PDF Splitter
Works on loaded PDF pages (type = 'pdf-page' with `pageNum`).
User sets page range (from/to). Filtered pages are merged into a new PDF and downloaded.

### 8.20 Undo / Redo
- History stack of up to 15 `FileItem[]` snapshots (shallow copy of each item)
- `pushHistory()` called before any destructive operation (crop, resize, watermark, date stamp, signature, drag reorder)
- `undoHistory()` / `redoHistory()` navigate the stack and restore `files` state
- Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) keyboard shortcuts
- Undo/Redo buttons in header

### 8.21 Before / After Toggle
When a file's `dataUrl !== originalDataUrl`, a toggle button appears on the card image area (visible on hover). Clicking it toggles `showOriginal` set — when ID is in the set, the card shows `originalDataUrl` with an "Original" badge; otherwise shows `dataUrl` with "Edited" badge.

### 8.22 Drag Reorder
HTML5 Drag and Drop on cards:
- `onDragStart`: records `dragId`
- `onDragOver`: records `dragOver`, applies visual highlight
- `onDrop`: calls `pushHistory()`, splices `dragId` item to `dragOver` position
- `onDragEnd`: clears both states

### 8.23 Keyboard Shortcuts
All shortcuts active globally except when typing in an input/textarea/contenteditable:

| Shortcut | Action |
|----------|--------|
| Escape | Close any open overlay/modal; clear card focus |
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |
| Arrow Left / Right | Navigate gallery or zoom view |
| D (when card focused) | Download focused card as PNG |
| R (when card focused) | Rotate focused card 90° |
| C (when card focused) | Open crop for focused card |
| Delete or Backspace (when card focused) | Remove focused card |

Card focus is toggled by clicking the card div. Focused card shows a sky-blue ring and a shortcut hint bar at the bottom.

### 8.24 Duplicate File
Inserts a copy of the file immediately after the original in the `files` array. New ID generated. Name gets " (copy)" suffix.

### 8.25 Inline Rename
Click the filename text on a card → converts to an input field. Enter or blur commits. Escape cancels. Also updates `zoomFile` if that file is currently in zoom.

### 8.26 File Info Panel
A slide-in sheet showing all `file.metadata` key-value pairs. Also shows:
- Extracted text if available (with "Open in editor" button)
- "Remove" button

### 8.27 Cloud Save
Optional Supabase integration. Calls `supabase.from('zplayer_sessions').upsert(payload, { onConflict: 'user_id' })`. Saves file metadata (not dataUrls — those are too large) and extracted texts. Falls back gracefully if user is not logged in or table doesn't exist.

---

## 9. External Libraries & When They Load

All external libraries are loaded lazily from CDN on first use. The `loadScript(src)` function is idempotent — it checks if the `<script>` tag already exists before adding a new one.

| Library | CDN | When loaded |
|---------|-----|-------------|
| pdf.js 3.11 | cdnjs | First PDF file uploaded |
| jsPDF 2.5 | cdnjs | First PDF download/export |
| JSZip 3.10 | cdnjs | First ZIP download |
| heic2any 0.0.4 | jsdelivr | First HEIC/HEIF file |
| html2canvas 1.4 | jsdelivr | First text-to-PDF or text-to-image export |
| Tesseract.js 2.1 | jsdelivr | First OCR without API key |

**React Native equivalents:**
- pdf.js → `react-native-pdf` or `expo-file-system` + `pdf-lib`
- jsPDF → `react-native-html-to-pdf` or `pdf-lib`
- JSZip → `jszip` (works in RN via metro bundler)
- heic2any → `expo-image-picker` handles HEIC natively
- html2canvas → `react-native-view-shot`
- Tesseract.js → `@react-native-ml-kit/text-recognition` or Tesseract RN fork

---

## 10. Utility Functions

### `getRotatedDataUrl(file: FileItem): Promise<string>`
Creates a canvas with swapped dimensions if rotation is 90/270, translates to center, rotates by `file.rotation` degrees, draws the original image. Returns PNG data URL.

### `fixPdfSpacing(text: string): string`
Cleans up PDF-extracted text:
- Merges hyphenated line breaks (`word-\nword` → `word`)
- Soft-wraps merged (`letter\nletter` → `letter letter`)
- Collapses multiple spaces
- Trims line edges
- Collapses 3+ newlines to 2

### `sanitizeHtml(html: string): string`
Strips `<script>`, `<style>`, `on*` attributes, `javascript:` hrefs.

### `textToHtml(text: string): string`
Splits plain text on double newlines, wraps each block in `<p>`, converts single newlines to `<br>`.

### `formatDate(ms: number): string`
Relative date: "just now", "5m ago", "2h ago", "3d ago", or formatted date string.

### `getFileTypeInfo(file: File): string`
Maps MIME type and extension to a short uppercase label: 'JPEG', 'PNG', 'PDF', etc.

### `parseTiffIfd` + `readJpegExif`
Inline EXIF parser for JPEG files. Reads the first ~64KB of the image binary, finds the APP1 marker, parses TIFF IFD0 entries for the supported tag IDs.

---

## 11. UI Layout

### Overall structure (top to bottom)
```
┌─────────────────────────────────────────────────────┐
│ Header bar: logo, tool tabs, undo/redo, API key,    │
│             save, cloud save                        │
├─────────────────────────────────────────────────────┤
│ Drop zone (full area, inactive when file grid shown)│
│                                                     │
│ ┌─ Selection toolbar ─────────────────────────────┐ │
│ │ All | None | By type | Gallery (right-aligned)  │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ Batch bar (when selection > 0) ───────────────┐  │
│ │ Extract | Merge | ZIP | Text | Copy | Crop |   │  │
│ │ Compress | PDF | Resize | Convert | Watermark  │  │
│ │ DateStamp | Compare                            │  │
│ └────────────────────────────────────────────────┘  │
│                                                     │
│ ┌─ File grid ─────────────────────────────────────┐ │
│ │  [card] [card] [card] [card]                   │ │
│ │  [card] [card] ...                             │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─ Tool panel (when activeTool ≠ 'files') ────────┐ │
│ │ Merge / Split / etc.                           │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### File card structure (top to bottom)
```
┌─ Card ──────────────────────────────────────────────┐
│ [grip] [checkbox] [filename input/text] [✕ remove]  │  ← TOP BAR
├─────────────────────────────────────────────────────┤
│                                                     │
│         [thumbnail image]                          │  ← IMAGE AREA
│  [TEXT✓]          [Original/Edited toggle]         │
│                   [zoom overlay on hover]           │
│                              [rotate btn on hover]  │
│                                                     │
├─────────────────────────────────────────────────────┤
│ [TYPE] [size] [dimensions] [page]   [duplicate][⋯] │  ← META BAR 1
├─────────────────────────────────────────────────────┤
│ [↓] [PDF] [⛶] [▦] [🔍] [✏] [✂] [⊙] [↔] [↺] [🔖] [✍] [📅] │  ← ACTION BUTTONS
├─────────────────────────────────────────────────────┤
│ D · R · C · Del  shortcuts active                  │  ← KEYBOARD HINT (focused only)
└─────────────────────────────────────────────────────┘
```

### Modal / Overlay layering (z-index order, lowest to highest)
1. File grid (base)
2. Text editor panel (slide-in)
3. Crop modal
4. Compress modal
5. Resize modal
6. Convert modal
7. Watermark modal
8. Date stamp modal
9. Compare modal (full screen)
10. E-Signature modal
11. File info panel
12. Annotation canvas (full screen)
13. Gallery slideshow (full screen)
14. Zoom overlay (full screen)
15. Loading overlay
16. Toast notifications

---

## 12. React Native / Expo Mapping Guide

This section maps each web-specific concept to its React Native equivalent.

### File Ingestion
| Web | React Native |
|-----|-------------|
| `<input type="file">` | `expo-document-picker` (`DocumentPicker.getDocumentAsync`) |
| Drag and drop | Not applicable; use long-press-to-select + share extension |
| Clipboard image paste | `expo-clipboard` (`Clipboard.getImageAsync`) |
| `FileReader.readAsDataURL` | `expo-file-system` (`FileSystem.readAsStringAsync` with Base64 encoding) |
| HEIC conversion | `expo-image-picker` returns JPEG by default; no conversion needed |

### Canvas Operations
All image manipulations in zPlayer use `HTMLCanvasElement`. In React Native:
- Use `expo-canvas` or `react-native-canvas` for direct canvas drawing
- Or use `Skia` (via `@shopify/react-native-skia`) for higher performance
- Or use `expo-image-manipulator` for basic operations (resize, rotate, crop, compress)

Recommended: use `expo-image-manipulator` for rotate/crop/resize/compress (it handles hardware acceleration), and `@shopify/react-native-skia` for watermark/date stamp/annotation drawing.

### Image Display
| Web | React Native |
|-----|-------------|
| `<img src={dataUrl}>` | `<Image source={{ uri: dataUrl }} />` |
| CSS `transform: rotate()` | `style={{ transform: [{ rotate: '90deg' }] }}` |
| CSS `object-contain` | `resizeMode="contain"` |

### PDF Handling
| Web | React Native |
|-----|-------------|
| pdf.js (renders pages to canvas) | `react-native-pdf` or `expo-print` |
| Each page → PNG dataUrl | `react-native-pdf-thumbnail` or render each page to Skia canvas |
| jsPDF (create PDFs) | `react-native-html-to-pdf` or `pdf-lib` |

### Persistent Storage
| Web | React Native |
|-----|-------------|
| `localStorage.setItem` | `AsyncStorage` (from `@react-native-async-storage/async-storage`) |
| `localStorage.getItem` | `AsyncStorage.getItem` |

### Sharing / Downloading
| Web | React Native |
|-----|-------------|
| `<a href={url} download>` | `expo-sharing` (`Sharing.shareAsync`) or `expo-media-library` (`MediaLibrary.saveToLibraryAsync`) |
| `URL.createObjectURL(blob)` | Write to `FileSystem.documentDirectory` then share the URI |

### OCR
| Web | React Native |
|-----|-------------|
| Tesseract.js CDN | `@react-native-ml-kit/text-recognition` (on-device, fast) |
| Gemini API fetch | Same `fetch` call works in RN |

### Modals
React Native does not have CSS z-index stacking contexts. Use the `Modal` component from RN core for fullscreen overlays, and `react-native-reanimated` bottom sheets or custom positioned views for panel-style modals.

### Text Editor
`contenteditable` div does not exist in React Native. Alternatives:
- `TextInput` with `multiline` for basic text editing
- `react-native-rich-editor` for formatted text
- For export to PDF: compose text into a styled View, use `react-native-view-shot` to render, then `pdf-lib` to create PDF

### Drag Reorder
Use `react-native-draggable-flatlist` — drop-in replacement for FlatList with drag-to-reorder built in.

### Keyboard Shortcuts
Android does not have keyboard shortcuts in the same sense. Map them to gesture-based actions or long-press context menus instead.

---

## 13. Full State Machine Summary

```
App init
  └─ Load localStorage (apiKey, session, prefs)
  └─ Register paste listener
  └─ Register keydown listener

User adds files
  └─ processFiles(incoming[])
      ├─ For each: processPdf or processImage
      └─ Append FileItem(s) to files[]

User interacts with a card
  ├─ Click card → toggle focusedCardId
  ├─ Click checkbox → toggle selected set
  ├─ Click action button → open appropriate modal/operation
  └─ Drag card → reorder via onDragStart/Over/Drop

User opens modal
  ├─ Applies settings
  ├─ Triggers async function (shows loading overlay)
  │   └─ For each targeted file:
  │       ├─ Load image from dataUrl
  │       ├─ Draw on canvas
  │       ├─ Export new dataUrl
  │       └─ setFiles(update)
  └─ Closes modal

Keyboard handler
  ├─ Ctrl+Z → undoHistory
  ├─ Ctrl+Y → redoHistory
  ├─ Escape → close top-most overlay
  ├─ Arrow keys → navigate gallery/zoom
  └─ D/R/C/Del → act on focusedCardId

Auto-save
  └─ files or extractedTexts change
      └─ debounced 1500ms → localStorage.setItem('zplayer_state', ...)
```

---

## 14. Design System (for reference, adapt to RN)

**Colors:**
- App background: `#080808`
- Card background: `#0d0d0d`
- Border: `rgba(255,255,255,0.08)` (resting), `rgba(255,255,255,0.2)` (hover)
- Selection ring: pink `rgba(236,72,153,0.4)`
- Focus ring: sky blue `rgba(56,189,248,0.5)`
- Drag-over ring: pink-400

**Accent colors by feature:**
- Extract/AI: pink
- PDF operations: red
- ZIP: amber
- Text ops: teal, blue
- Crop: emerald
- Compress: violet, orange
- Resize: sky
- Convert: indigo
- Watermark: rose
- Date stamp: yellow
- Compare: cyan
- Annotation: amber

**Typography:**
- UI labels: 10–11px, `text-white/50`
- Card filenames: 11px, `text-white/70`
- Metadata: 9px, `text-white/25`–`text-white/40`
- Notifications: 12px

**Notification system:**
- Toasts stacked at top-right
- Types: success (green), error (red), warn (amber), info (blue)
- Default timeout: 3000ms (success/info), 5000ms (error)
- Each notification auto-removes after timeout via `setTimeout`

---

## 15. Things to Build First (Suggested Order for RN)

1. **FileItem model + state** — get the data structure right before UI
2. **File picker + image ingestion** — FileReader equivalent via expo-file-system
3. **File grid (FlatList/FlashList)** — cards with thumbnail, name, checkbox
4. **Rotate** — expo-image-manipulator, simplest operation
5. **Download/share** — expo-media-library + expo-sharing
6. **Selection + batch bar** — UI with selection state
7. **Crop** — gesture-based crop rect over image
8. **Compress** — expo-image-manipulator quality setting
9. **Resize** — expo-image-manipulator resize
10. **Watermark** — Skia canvas draw text over image
11. **Date stamp** — same as watermark with date string
12. **Undo/redo** — history stack (works the same as web)
13. **PDF ingestion** — hardest single feature; use react-native-pdf + thumbnail lib
14. **PDF export (merge/split)** — pdf-lib
15. **OCR** — ML Kit text recognition
16. **Annotation (draw)** — Skia canvas touch handler
17. **Gallery/slideshow** — FlatList horizontal scroll
18. **Text editor** — react-native-rich-editor
19. **Side-by-side compare** — two Image components side by side
20. **Auto-save to AsyncStorage** — debounced effect, same pattern

---

## 16. Known Edge Cases to Handle

- **HEIC on Android:** Android does not support HEIC natively. Must use a decoder library or reject these files.
- **Large PDFs:** Rendering all pages upfront is memory-intensive. Consider lazy rendering (only render visible pages).
- **Large images:** Canvas operations on 20MP+ images can cause OOM. Consider downscaling to a working resolution (e.g., max 4096px) before editing.
- **localStorage limits:** Data URLs for large images can exceed the 5MB localStorage limit. In RN, AsyncStorage also has limits — consider saving only metadata + file URIs, not base64 data.
- **Undo stack memory:** 15 snapshots of large images = significant RAM. Cap snapshot resolution or use URI references instead of full data URLs.
- **Highlight annotation preview:** The `putImageData` approach to restore canvas each frame is critical for responsive preview. Use the same pattern in Skia (save/restore layer).
- **Gemini API key security:** The key is stored in localStorage/AsyncStorage in plain text. Accept this tradeoff — it's user's own key. Consider SecureStore on RN.
- **PDF text extraction:** The current implementation does NOT use pdf.js text extraction — it uses AI/OCR on the rendered page image. If you want native text extraction from PDF, use pdf.js `page.getTextContent()`.
