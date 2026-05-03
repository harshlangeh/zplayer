'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Layers, Upload, FileText, FileStack, X, Sparkles,
  RotateCw, Copy, Download, CheckSquare, Square, Key, Save,
  Archive, Search, FileDown, Check, Maximize2,
  ChevronLeft, ChevronRight, LayoutGrid, Pencil, Eraser, ImageIcon,
  MoreHorizontal, Info, List, ListOrdered, Type, Crop, Gauge,
  Undo2, Redo2, GripVertical, RefreshCw, Stamp, PenLine,
  Scissors, Eye, Move, SplitSquareVertical, Calendar,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
type FileItem = {
  id: string; name: string; originalName: string
  type: 'image' | 'pdf-page' | 'other'
  dataUrl: string; originalDataUrl: string
  rotation: number; size: number; extractedText: string
  pageNum?: number; fileTypeInfo: string
  lastModified: number
  dimensions?: string
  software?: string
  metadata?: Record<string, string>
}
type Tool       = 'files' | 'merge' | 'extract' | 'convert' | 'split'
type NotifType  = 'success' | 'error' | 'warn' | 'info'
type Notif      = { id: string; msg: string; type: NotifType }

// ── CDN ────────────────────────────────────────────────────────────────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load: ${src}`))
    document.head.appendChild(s)
  })
}

const CDN = {
  pdfjs:       'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  jspdf:       'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  jszip:       'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  heic2any:    'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  tesseract:   'https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/tesseract.min.js',
}

const ANNOTATE_COLORS = ['#ff4466','#ff8800','#ffdd00','#00cc66','#0088ff','#cc44ff','#ffffff','#111111']

// ── EXIF reader (JPEG IFD0 ASCII tags, no CDN) ────────────────────────────────
function parseTiffIfd(view: DataView, base: number): Record<string, string> {
  const r: Record<string, string> = {}
  try {
    const le  = view.getUint16(base) === 0x4949
    const r16 = (o: number) => view.getUint16(base + o, le)
    const r32 = (o: number) => view.getUint32(base + o, le)
    const rStr = (o: number, n: number) => {
      let s = ''; const end = Math.min(base + o + n, view.byteLength)
      for (let j = base + o; j < end; j++) {
        const c = view.getUint8(j); if (c === 0) break; s += String.fromCharCode(c)
      }
      return s.trim()
    }
    const TAGS: Record<number, string> = {
      0x010E: 'Description', 0x010F: 'Make',  0x0110: 'Model',
      0x0131: 'Software',    0x0132: 'Date',  0x013B: 'Artist',
      0x8298: 'Copyright',
    }
    const ifd = r32(4); const n = r16(ifd)
    for (let i = 0; i < n && i < 64; i++) {
      const e = ifd + 2 + i * 12
      const tag = r16(e); const type = r16(e + 2); const cnt = r32(e + 4)
      if (!TAGS[tag] || type !== 2 || cnt === 0) continue
      const off = cnt <= 4 ? e + 8 : r32(e + 8)
      const val = rStr(off, cnt)
      if (val) r[TAGS[tag]] = val
    }
  } catch {}
  return r
}

function readJpegExif(dataUrl: string): Record<string, string> {
  try {
    const b64 = dataUrl.split(',')[1]; if (!b64) return {}
    const bin = atob(b64.slice(0, 87384))            // decode first ~64 KB
    const len = bin.length
    const buf = new ArrayBuffer(len)
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
    const view = new DataView(buf)
    if (view.getUint16(0) !== 0xFFD8) return {}      // not JPEG
    let off = 2
    while (off < len - 4) {
      if (view.getUint8(off) !== 0xFF) break
      const m = view.getUint8(off + 1)
      const s = view.getUint16(off + 2)
      if (m === 0xE1 && off + 10 < len) {
        const hdr = String.fromCharCode(...bytes.slice(off + 4, off + 10))
        if (hdr.startsWith('Exif')) return parseTiffIfd(view, off + 10)
      }
      off += 2 + s
    }
  } catch {}
  return {}
}

function formatDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms), now = Date.now(), diff = now - ms
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

function fmtSoftware(s: string): string {
  const clean = s.replace(/\s*\d[\d.]*$/, '').trim()
  return clean.length > 16 ? clean.slice(0, 14) + '…' : clean
}

// ── PDF spacing fixer + text helpers ─────────────────────────────────────────
function fixPdfSpacing(text: string): string {
  return text
    .replace(/-\s*\n\s*([a-z])/g, '$1')              // hyphenated line break → merge
    .replace(/([a-zA-Z,;:])\n([a-zA-Z])/g, '$1 $2')  // soft wrap → space
    .replace(/[ \t]{2,}/g, ' ')                        // multiple spaces → one
    .replace(/^[ \t]+|[ \t]+$/gm, '')                  // trim line edges
    .replace(/\n{3,}/g, '\n\n')                        // max 2 consecutive newlines
    .trim()
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '')
}

function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map(p => `<p>${p.replace(/\n/g, '<br>') || '<br>'}</p>`)
    .join('') || '<p><br></p>'
}

function getFileTypeInfo(file: File): string {
  const t = file.type.toLowerCase()
  const e = (file.name.split('.').pop() ?? '').toLowerCase()
  if (t === 'image/jpeg'    || e === 'jpg'  || e === 'jpeg') return 'JPEG'
  if (t === 'image/png'     || e === 'png')                  return 'PNG'
  if (t === 'image/gif'     || e === 'gif')                  return 'GIF'
  if (t === 'image/webp'    || e === 'webp')                 return 'WEBP'
  if (t === 'image/svg+xml' || e === 'svg')                  return 'SVG'
  if (t === 'image/bmp'     || e === 'bmp')                  return 'BMP'
  if (t === 'image/tiff'    || e === 'tif'  || e === 'tiff') return 'TIFF'
  if (t === 'image/avif'    || e === 'avif')                 return 'AVIF'
  if (t === 'image/x-icon'  || e === 'ico')                  return 'ICO'
  if (t === 'image/heic' || t === 'image/heif' || e === 'heic' || e === 'heif' || e === 'hif') return 'HEIC'
  if (t.startsWith('image/')) return t.split('/')[1].toUpperCase().replace('X-', '')
  return e.toUpperCase() || 'IMG'
}

function isHeicFile(file: File): boolean {
  const t = file.type.toLowerCase()
  const e = (file.name.split('.').pop() ?? '').toLowerCase()
  return t === 'image/heic' || t === 'image/heif' || e === 'heic' || e === 'heif' || e === 'hif'
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ZPlayerPage() {
  const [files, setFiles]                   = useState<FileItem[]>([])
  const [selected, setSelected]             = useState<Set<string>>(new Set())
  const [activeTool, setActiveTool]         = useState<Tool>('files')
  const [dragging, setDragging]             = useState(false)
  const [loading, setLoading]               = useState(false)
  const [loadingMsg, setLoadingMsg]         = useState('Processing…')
  const [extractedTexts, setExtractedTexts] = useState<Record<string, string>>({})
  const [apiKey, setApiKey]                 = useState('')
  const [showApiPanel, setShowApiPanel]     = useState(false)
  const [notifs, setNotifs]                 = useState<Notif[]>([])
  const [editingId, setEditingId]           = useState<string | null>(null)
  const [editingName, setEditingName]       = useState('')

  // ── Modal state ──────────────────────────────────────────────────────────────
  const [zoomFile, setZoomFile]             = useState<FileItem | null>(null)
  const [galleryOpen, setGalleryOpen]       = useState(false)
  const [galleryIndex, setGalleryIndex]     = useState(0)
  const [annotateFile, setAnnotateFile]     = useState<FileItem | null>(null)
  const [annotateRotatedUrl, setAnnotateRotatedUrl] = useState('')
  const [annotateColor, setAnnotateColor]   = useState('#ff4466')
  const [annotateSize, setAnnotateSize]     = useState(4)
  const [isDrawing, setIsDrawing]           = useState(false)
  const [metaFileId, setMetaFileId]         = useState<string | null>(null)
  const [textEditorOpen, setTextEditorOpen] = useState(false)
  const [textTitle, setTextTitle]           = useState('Untitled document')
  const [strictMode, setStrictMode]         = useState(false)
  const [textEditorFullscreen, setTextEditorFullscreen] = useState(false)
  const [editorPageCount, setEditorPageCount] = useState(1)

  // ── Crop state ────────────────────────────────────────────────────────────
  const [cropFile, setCropFile]       = useState<FileItem | null>(null)
  const [cropRect, setCropRect]       = useState<{x:number;y:number;w:number;h:number} | null>(null)
  const [cropDragging, setCropDragging] = useState(false)
  const [cropStart, setCropStart]     = useState<{x:number;y:number} | null>(null)
  const [bulkCropIds, setBulkCropIds] = useState<string[]>([])

  // ── Compress state ────────────────────────────────────────────────────────
  const [compressModal, setCompressModal] = useState<{ids:string[];type:'image'|'pdf'} | null>(null)
  const [compressQuality, setCompressQuality] = useState(75)
  const [compressTargetKB, setCompressTargetKB] = useState('')
  const [compressSizeMode, setCompressSizeMode] = useState(false)

  // ── Drag reorder ──────────────────────────────────────────────────────────
  const [dragId, setDragId]   = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  // ── Resize state ──────────────────────────────────────────────────────────
  const [resizeModal, setResizeModal] = useState<{ids:string[]} | null>(null)
  const [resizeW, setResizeW]         = useState('')
  const [resizeH, setResizeH]         = useState('')
  const [resizeLock, setResizeLock]   = useState(true)
  const [resizeMode, setResizeMode]   = useState<'px'|'pct'>('px')

  // ── Format converter state ────────────────────────────────────────────────
  const [convertModal, setConvertModal]   = useState<{ids:string[]} | null>(null)
  const [convertFormat, setConvertFormat] = useState<'jpeg'|'png'|'webp'>('jpeg')
  const [convertQuality, setConvertQuality] = useState(85)

  // ── Watermark state ───────────────────────────────────────────────────────
  const [watermarkModal, setWatermarkModal] = useState<{ids:string[]} | null>(null)
  const [wmText, setWmText]         = useState('CONFIDENTIAL')
  const [wmFontSize, setWmFontSize] = useState(48)
  const [wmOpacity, setWmOpacity]   = useState(30)
  const [wmColor, setWmColor]       = useState('#ffffff')
  const [wmPosition, setWmPosition] = useState<'center'|'tl'|'tr'|'bl'|'br'|'tile'>('center')
  const [wmAngle, setWmAngle]       = useState(-30)

  // ── E-Signature state ─────────────────────────────────────────────────────
  const [signModal, setSignModal]     = useState<{id:string} | null>(null)
  const [signTab, setSignTab]         = useState<'draw'|'type'>('draw')
  const [signText, setSignText]       = useState('')
  const [signFont, setSignFont]       = useState('cursive')
  const [signColor, setSignColor]     = useState('#1a1a1a')
  const [signPos, setSignPos]         = useState<'br'|'bl'|'tr'|'tl'|'center'>('br')
  const [signDrawing, setSignDrawing] = useState(false)

  // ── PDF Splitter state ────────────────────────────────────────────────────
  const [splitFrom, setSplitFrom] = useState(1)
  const [splitTo, setSplitTo]     = useState(1)

  // ── Before / After state ──────────────────────────────────────────────────
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set())

  // ── OCR progress ──────────────────────────────────────────────────────────
  const [ocrProgress, setOcrProgress] = useState(0)

  // ── Keyboard focus (for D/R/C/Del shortcuts) ──────────────────────────────
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null)

  // ── Side-by-side compare ──────────────────────────────────────────────────
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null)

  // ── Date stamp ────────────────────────────────────────────────────────────
  const [dateStampModal, setDateStampModal] = useState<{ids: string[]} | null>(null)
  const [dsFormat, setDsFormat]   = useState<'datetime'|'date'|'time'|'custom'>('datetime')
  const [dsCustomText, setDsCustomText] = useState('')
  const [dsPosition, setDsPosition] = useState<'br'|'bl'|'tr'|'tl'|'center'>('br')
  const [dsColor, setDsColor]     = useState('#ffffff')
  const [dsFontSize, setDsFontSize] = useState(28)
  const [dsOpacity, setDsOpacity] = useState(85)
  const [dsBg, setDsBg]           = useState(true)

  // ── Annotation mode ───────────────────────────────────────────────────────
  const [annotateMode, setAnnotateMode] = useState<'draw'|'highlight'|'text'>('draw')
  const [annotateText, setAnnotateText] = useState('Note')

  const inputRef          = useRef<HTMLInputElement>(null)
  const processFilesRef   = useRef<(files: File[]) => Promise<void>>(async () => {})
  const annotateCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotateSnapshot  = useRef<ImageData | null>(null)
  const annotateHlStart   = useRef<{x:number;y:number} | null>(null)
  const lastPoint         = useRef<{ x: number; y: number } | null>(null)
  const filesRef          = useRef(files)
  const zoomFileRef       = useRef(zoomFile)
  const focusedCardIdRef  = useRef<string | null>(null)
  const editorRef         = useRef<HTMLDivElement>(null)
  const strictModeRef     = useRef(false)
  const textEditorOpenRef = useRef(false)
  const cropContainerRef  = useRef<HTMLDivElement>(null)
  const signCanvasRef     = useRef<HTMLCanvasElement>(null)
  const signLastPt        = useRef<{x:number;y:number} | null>(null)
  const historyRef        = useRef<FileItem[][]>([])
  const historyIdxRef     = useRef(-1)

  useEffect(() => { filesRef.current = files },                   [files])
  useEffect(() => { zoomFileRef.current = zoomFile },             [zoomFile])
  useEffect(() => { strictModeRef.current = strictMode },         [strictMode])
  useEffect(() => { textEditorOpenRef.current = textEditorOpen }, [textEditorOpen])
  useEffect(() => { focusedCardIdRef.current = focusedCardId },   [focusedCardId])

  // ── Auto-save files to localStorage (debounced) ───────────────────────────
  useEffect(() => {
    if (files.length === 0) return
    const t = setTimeout(() => {
      try { localStorage.setItem('zplayer_state', JSON.stringify({ files, et: extractedTexts })) } catch {}
    }, 1500)
    return () => clearTimeout(t)
  }, [files, extractedTexts])

  // ── Track page count in text editor ───────────────────────────────────────
  useEffect(() => {
    if (!textEditorOpen || !editorRef.current) return
    const el = editorRef.current
    const calcPages = () => {
      const pageHpx = el.offsetWidth * (297 / 210)
      setEditorPageCount(Math.max(1, Math.ceil(el.scrollHeight / pageHpx)))
    }
    calcPages()
    const ro = new ResizeObserver(calcPages)
    ro.observe(el)
    el.addEventListener('input', calcPages)
    return () => { ro.disconnect(); el.removeEventListener('input', calcPages) }
  }, [textEditorOpen])

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('zplayer_apiKey')
    if (saved) setApiKey(saved)
    // Restore last session
    const raw = localStorage.getItem('zplayer_state')
    if (raw) {
      try {
        const { files: f, et } = JSON.parse(raw)
        setFiles(f.map((x: FileItem) => ({ ...x, dataUrl: x.originalDataUrl })))
        setExtractedTexts(et || {})
        notify(`Restored ${f.length} file${f.length !== 1 ? 's' : ''} from last session`, 'info', 4000)
      } catch { localStorage.removeItem('zplayer_state') }
    }
    // Restore preferences
    try {
      const prefs = JSON.parse(localStorage.getItem('zp_prefs') || '{}')
      if (prefs.compressQuality) setCompressQuality(prefs.compressQuality)
      if (prefs.convertFormat)   setConvertFormat(prefs.convertFormat)
      if (prefs.wmText)     setWmText(prefs.wmText)
      if (prefs.wmOpacity)  setWmOpacity(prefs.wmOpacity)
      if (prefs.wmFontSize) setWmFontSize(prefs.wmFontSize)
      if (prefs.wmColor)    setWmColor(prefs.wmColor)
      if (prefs.wmPosition) setWmPosition(prefs.wmPosition)
    } catch {}
    const onPaste = (e: ClipboardEvent) => {
      if (textEditorOpenRef.current) return
      const items = e.clipboardData?.items
      if (!items) return
      const all   = Array.from(items)
      const imgs  = all.filter(i => i.kind === 'file' && i.type.startsWith('image/'))
      const tHtml = all.find(i => i.kind === 'string' && i.type === 'text/html')
      const tPlain = all.find(i => i.kind === 'string' && i.type === 'text/plain')
      if (imgs.length > 0) {
        const pasted: File[] = []
        for (const item of imgs) {
          const file = item.getAsFile()
          if (file) pasted.push(new File([file], `pasted_${Date.now()}.${file.type.split('/')[1] || 'png'}`, { type: file.type }))
        }
        if (pasted.length > 0) { processFilesRef.current(pasted); return }
      }
      if (tPlain || tHtml) {
        e.preventDefault()
        if (tHtml && !strictModeRef.current) {
          tHtml.getAsString(html => {
            setTextTitle('Untitled document')
            setTextEditorOpen(true)
            setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(html) }, 30)
          })
        } else {
          tPlain?.getAsString(raw => {
            setTextTitle('Untitled document')
            setTextEditorOpen(true)
            setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = textToHtml(fixPdfSpacing(raw)) }, 30)
          })
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // ── Keyboard nav ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoHistory(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redoHistory(); return }
      if (e.key === 'Escape') {
        if (textEditorOpenRef.current) { setTextEditorOpen(false); setTextEditorFullscreen(false); return }
        if (metaFileId) { setMetaFileId(null); return }
        if (annotateFile) { setAnnotateFile(null); setAnnotateRotatedUrl('') }
        else if (galleryOpen) setGalleryOpen(false)
        else if (zoomFileRef.current) setZoomFile(null)
        setFocusedCardId(null)
        return
      }
      if (galleryOpen) {
        if (e.key === 'ArrowLeft')  setGalleryIndex(i => Math.max(0, i - 1))
        if (e.key === 'ArrowRight') setGalleryIndex(i => Math.min(filesRef.current.length - 1, i + 1))
      }
      if (zoomFileRef.current && !galleryOpen && !annotateFile) {
        const cur = filesRef.current
        const idx = cur.findIndex(f => f.id === zoomFileRef.current!.id)
        if (e.key === 'ArrowLeft'  && idx > 0)              setZoomFile(cur[idx - 1])
        if (e.key === 'ArrowRight' && idx < cur.length - 1) setZoomFile(cur[idx + 1])
      }
      // Card keyboard shortcuts — only when no modal open and not typing in an input
      const tag = (e.target as HTMLElement).tagName
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (!isTyping && !e.ctrlKey && !e.metaKey && focusedCardIdRef.current &&
          !galleryOpen && !annotateFile && !metaFileId && !textEditorOpenRef.current) {
        const f = filesRef.current.find(x => x.id === focusedCardIdRef.current)
        if (f) {
          if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateFile(f.id); return }
          if (e.key === 'd' || e.key === 'D') { e.preventDefault(); downloadImage(f); return }
          if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openCrop(f, [f.id]); return }
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeFile(f.id); return }
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [galleryOpen, annotateFile, metaFileId])

  // ── Notifications ──────────────────────────────────────────────────────────
  function notify(msg: string, type: NotifType = 'info', ms = 3000) {
    const id = Math.random().toString(36).slice(2)
    setNotifs(p => [...p, { id, msg, type }])
    setTimeout(() => setNotifs(p => p.filter(n => n.id !== id)), ms)
  }

  // ── File processing ────────────────────────────────────────────────────────
  const processFiles = useCallback(async (incoming: File[]) => {
    setLoading(true)
    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i]
      setLoadingMsg(`Processing ${i + 1}/${incoming.length}: ${file.name}`)
      try {
        if (file.type === 'application/pdf') await processPdf(file)
        else if (file.type.startsWith('image/') || isHeicFile(file)) await processImage(file)
        else notify(`Unsupported type: ${file.name}`, 'warn')
      } catch (err: any) { notify(`Error: ${err.message}`, 'error', 5000) }
    }
    setLoading(false)
  }, [])

  useEffect(() => { processFilesRef.current = processFiles }, [processFiles])

  function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

  async function processImage(file: File): Promise<void> {
    let workFile = file
    if (isHeicFile(file)) {
      setLoadingMsg(`Converting HEIC: ${file.name}`)
      await loadScript(CDN.heic2any)
      const h2a = (window as any).heic2any
      const result = await h2a({ blob: file, toType: 'image/jpeg', quality: 0.92 })
      const blob: Blob = Array.isArray(result) ? result[0] : result
      workFile = new File([blob], file.name.replace(/\.(heic|heif|hif)$/i, '.jpg'), {
        type: 'image/jpeg', lastModified: file.lastModified,
      })
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('Cannot read file'))
      reader.readAsDataURL(workFile)
    })
    const img = new Image()
    await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); img.src = dataUrl })
    const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height
    const dims = w && h ? `${w}×${h}` : undefined
    const typeLabel = getFileTypeInfo(file)
    const exif = readJpegExif(dataUrl)
    const md: Record<string, string> = {
      'File name': file.name,
      'Format': typeLabel,
      'File size': `${(file.size / 1024).toFixed(1)} KB`,
      'Last modified': new Date(file.lastModified).toLocaleString(),
    }
    if (dims) md['Dimensions'] = dims
    if (exif.Make || exif.Model) md['Camera'] = [exif.Make, exif.Model].filter(Boolean).join(' ')
    if (exif.Software)    md['Software']    = exif.Software
    if (exif.Date)        md['Date taken']  = exif.Date
    if (exif.Artist)      md['Artist']      = exif.Artist
    if (exif.Copyright)   md['Copyright']   = exif.Copyright
    if (exif.Description) md['Description'] = exif.Description
    setFiles(prev => [...prev, {
      id: genId(), name: file.name, originalName: file.name,
      type: 'image', dataUrl, originalDataUrl: dataUrl,
      rotation: 0, size: file.size, extractedText: '',
      fileTypeInfo: typeLabel,
      lastModified: file.lastModified, dimensions: dims,
      software: exif.Software, metadata: md,
    }])
  }

  async function processPdf(file: File): Promise<void> {
    await loadScript(CDN.pdfjs)
    const pdfjs = (window as any).pdfjsLib
    pdfjs.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker
    const buf = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buf }).promise
    let pdfExtra: Record<string, string> = {}
    let pdfSoftware: string | undefined
    try {
      const { info } = await doc.getMetadata()
      if (info) {
        if (info.Title)        pdfExtra['Title']    = info.Title
        if (info.Author)       pdfExtra['Author']   = info.Author
        if (info.Subject)      pdfExtra['Subject']  = info.Subject
        if (info.Creator)      pdfExtra['Creator']  = info.Creator
        if (info.Producer)     pdfExtra['Producer'] = info.Producer
        if (info.CreationDate) pdfExtra['Created']  = info.CreationDate
        if (info.ModDate)      pdfExtra['Modified'] = info.ModDate
        pdfSoftware = info.Creator || info.Producer || undefined
      }
    } catch {}
    for (let i = 1; i <= doc.numPages; i++) {
      setLoadingMsg(`PDF: page ${i}/${doc.numPages} — ${file.name}`)
      const page = await doc.getPage(i)
      const vp = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      const dataUrl = canvas.toDataURL('image/png')
      canvas.width = 0; canvas.height = 0
      const pageName = `${file.name} — p.${i}`
      const md: Record<string, string> = {
        'File name': file.name, 'Format': 'PDF',
        'File size': `${(file.size / 1024).toFixed(1)} KB`,
        'Total pages': String(doc.numPages), 'Page': String(i),
        'Last modified': new Date(file.lastModified).toLocaleString(),
        ...pdfExtra,
      }
      setFiles(prev => [...prev, {
        id: genId(), name: pageName, originalName: pageName,
        type: 'pdf-page', dataUrl, originalDataUrl: dataUrl,
        rotation: 0, size: Math.round(file.size / doc.numPages),
        extractedText: '', pageNum: i, fileTypeInfo: 'PDF',
        lastModified: file.lastModified,
        dimensions: `${Math.round(vp.width)}×${Math.round(vp.height)}`,
        software: pdfSoftware, metadata: md,
      }])
    }
    notify(`PDF → ${doc.numPages} pages`, 'success')
  }

  // ── Card actions ───────────────────────────────────────────────────────────
  function removeFile(id: string) {
    setFiles(p => p.filter(f => f.id !== id))
    setSelected(p => { const n = new Set(p); n.delete(id); return n })
    setExtractedTexts(p => { const n = { ...p }; delete n[id]; return n })
    if (zoomFile?.id === id) setZoomFile(null)
  }

  function rotateFile(id: string) {
    const next = (r: number) => (r + 90) % 360
    setFiles(p => p.map(f => f.id === id ? { ...f, rotation: next(f.rotation) } : f))
    if (zoomFile?.id === id) setZoomFile(p => p ? { ...p, rotation: next(p.rotation) } : null)
  }

  function duplicateFile(id: string) {
    setFiles(p => {
      const idx = p.findIndex(f => f.id === id)
      if (idx === -1) return p
      const copy = { ...p[idx], id: genId(), name: `${p[idx].name} (copy)` }
      const next = [...p]; next.splice(idx + 1, 0, copy)
      return next
    })
    notify('Duplicated', 'success', 1500)
  }

  function renameFile(id: string, name: string) {
    setFiles(p => p.map(f => f.id === id ? { ...f, name } : f))
    if (zoomFile?.id === id) setZoomFile(p => p ? { ...p, name } : null)
  }

  function startEditing(f: FileItem) {
    setEditingId(f.id)
    setEditingName(f.name)
  }

  function commitRename() {
    if (editingId) { renameFile(editingId, editingName || 'Untitled'); setEditingId(null) }
  }

  async function getRotatedDataUrl(file: FileItem): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const r = file.rotation
        const canvas = document.createElement('canvas')
        if (r === 90 || r === 270) { canvas.width = img.height; canvas.height = img.width }
        else { canvas.width = img.width; canvas.height = img.height }
        const ctx = canvas.getContext('2d')!
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate((r * Math.PI) / 180)
        ctx.drawImage(img, -img.width / 2, -img.height / 2)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = file.originalDataUrl
    })
  }

  async function downloadImage(file: FileItem) {
    setLoading(true); setLoadingMsg('Preparing…')
    try {
      const dataUrl = await getRotatedDataUrl(file)
      const a = document.createElement('a')
      a.href = dataUrl; a.download = `${file.name.replace(/\s+/g, '_')}.png`; a.click()
      notify('Downloaded', 'success', 1500)
    } catch { notify('Download failed', 'error') }
    setLoading(false)
  }

  async function downloadAsPdf(file: FileItem) {
    setLoading(true); setLoadingMsg('Creating PDF…')
    try {
      await loadScript(CDN.jspdf)
      const { jsPDF } = (window as any).jspdf
      const pdf = new jsPDF()
      const imgData = await getRotatedDataUrl(file)
      const props = pdf.getImageProperties(imgData)
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const ratio = Math.min(pw / props.width, ph / props.height)
      pdf.addImage(imgData, 'PNG', (pw - props.width * ratio) / 2, (ph - props.height * ratio) / 2, props.width * ratio, props.height * ratio)
      pdf.save(`${file.name.replace(/\s+/g, '_')}.pdf`)
      notify('PDF saved', 'success', 1500)
    } catch { notify('PDF failed', 'error') }
    setLoading(false)
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll()   { setSelected(new Set(files.map(f => f.id))); notify(`Selected ${files.length}`, 'info', 1500) }
  function deselectAll() { setSelected(new Set()) }
  function selectByType(type: string) {
    const ids = files.filter(f =>
      type === 'images' ? f.type === 'image' :
      type === 'pdf'    ? f.type === 'pdf-page' :
      f.fileTypeInfo.toLowerCase() === type
    ).map(f => f.id)
    setSelected(new Set(ids)); notify(`Selected ${ids.length}`, 'info', 1500)
  }

  const selectedFiles = files.filter(f => selected.has(f.id))

  // ── Text extraction ────────────────────────────────────────────────────────
  async function extractText(file: FileItem) {
    if (!apiKey) { await extractTextTesseract(file); return }
    setLoading(true); setLoadingMsg(`Extracting: ${file.name}`)
    try {
      const base64 = file.originalDataUrl.split(',')[1]
      const mime   = file.originalDataUrl.substring(5, file.originalDataUrl.indexOf(';'))
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [
          { text: 'Extract all text from this image. Output only the text, nothing else.' },
          { inlineData: { mimeType: mime, data: base64 } },
        ] }] }),
      })
      if (!res.ok) throw new Error((await res.json()).error?.message || res.statusText)
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '(no text found)'
      setFiles(p => p.map(f => f.id === file.id ? { ...f, extractedText: text } : f))
      setExtractedTexts(p => ({ ...p, [file.id]: text }))
      notify('Text extracted', 'success')
    } catch (err: any) { notify(`Extract failed: ${err.message}`, 'error', 5000) }
    setLoading(false)
  }

  async function batchExtract() {
    if (selectedFiles.length === 0) { notify('Select files first', 'warn'); return }
    for (const file of selectedFiles) await extractText(file)
  }

  // ── Batch exports ──────────────────────────────────────────────────────────
  async function downloadMergedPdf() {
    if (selectedFiles.length === 0) { notify('Select files first', 'warn'); return }
    setLoading(true); setLoadingMsg('Creating merged PDF…')
    try {
      await loadScript(CDN.jspdf)
      const { jsPDF } = (window as any).jspdf
      const pdf = new jsPDF()
      for (let i = 0; i < selectedFiles.length; i++) {
        if (i > 0) pdf.addPage()
        const imgData = await getRotatedDataUrl(selectedFiles[i])
        const props = pdf.getImageProperties(imgData)
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
        const ratio = Math.min(pw / props.width, ph / props.height)
        pdf.addImage(imgData, 'PNG', (pw - props.width * ratio) / 2, (ph - props.height * ratio) / 2, props.width * ratio, props.height * ratio)
      }
      pdf.save('merged.pdf'); notify('Merged PDF saved', 'success')
    } catch { notify('Merge failed', 'error') }
    setLoading(false)
  }

  async function downloadZip() {
    if (selectedFiles.length === 0) { notify('Select files first', 'warn'); return }
    setLoading(true); setLoadingMsg('Creating ZIP…')
    try {
      await loadScript(CDN.jszip)
      const zip = new (window as any).JSZip()
      for (const file of selectedFiles) {
        const dataUrl = await getRotatedDataUrl(file)
        zip.file(`${file.name.replace(/\s+/g, '_')}.png`, dataUrl.split(',')[1], { base64: true })
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'images.zip'; a.click()
      URL.revokeObjectURL(a.href); notify('ZIP downloaded', 'success')
    } catch { notify('ZIP failed', 'error') }
    setLoading(false)
  }

  function makeTextBlob(fileList: FileItem[]) {
    return fileList.map(f => `--- ${f.name} ---\n${f.extractedText || '(no text extracted)'}`).join('\n\n')
  }
  function downloadTextFile(fileList: FileItem[]) {
    const a = document.createElement('a')
    a.href = `data:text/plain;charset=utf-8,${encodeURIComponent(makeTextBlob(fileList))}`
    a.download = 'extracted_text.txt'; a.click()
  }
  function copyTextToClipboard(fileList: FileItem[]) {
    navigator.clipboard.writeText(makeTextBlob(fileList))
      .then(() => notify('Copied to clipboard', 'success', 1500))
      .catch(() => notify('Copy failed', 'error'))
  }

  // ── Crop helpers ───────────────────────────────────────────────────────────
  function getCropPos(e: React.MouseEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  function openCrop(file: FileItem, bulk: string[] = []) {
    setCropFile(file); setCropRect(null); setCropStart(null); setBulkCropIds(bulk)
  }

  function startCropDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (!cropContainerRef.current) return
    const pos = getCropPos(e, cropContainerRef.current)
    setCropStart(pos); setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 }); setCropDragging(true)
  }

  function updateCropDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (!cropDragging || !cropStart || !cropContainerRef.current) return
    const pos = getCropPos(e, cropContainerRef.current)
    setCropRect({
      x: Math.min(cropStart.x, pos.x), y: Math.min(cropStart.y, pos.y),
      w: Math.abs(pos.x - cropStart.x), h: Math.abs(pos.y - cropStart.y),
    })
  }

  function endCropDrag() { setCropDragging(false); setCropStart(null) }

  async function applyCrop(targetIds: string[]) {
    if (!cropRect || cropRect.w < 0.01 || cropRect.h < 0.01) { notify('Draw a crop area first', 'warn'); return }
    setLoading(true); setLoadingMsg('Cropping…')
    for (const id of targetIds) {
      const file = filesRef.current.find(f => f.id === id)
      if (!file) continue
      const img = new Image(); img.src = file.dataUrl
      await new Promise(r => { img.onload = r })
      const sw = Math.round(img.naturalWidth * cropRect.w)
      const sh = Math.round(img.naturalHeight * cropRect.h)
      const canvas = document.createElement('canvas')
      canvas.width = sw; canvas.height = sh
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, Math.round(img.naturalWidth * cropRect.x), Math.round(img.naturalHeight * cropRect.y), sw, sh, 0, 0, sw, sh)
      const newUrl = canvas.toDataURL('image/png')
      setFiles(p => p.map(f => f.id === id ? { ...f, dataUrl: newUrl, originalDataUrl: newUrl, dimensions: `${sw}×${sh}` } : f))
    }
    setCropFile(null); setCropRect(null); setBulkCropIds([])
    notify(`Cropped ${targetIds.length} image${targetIds.length > 1 ? 's' : ''}`, 'success')
    setLoading(false)
  }

  // ── Compress helpers ───────────────────────────────────────────────────────
  function openCompressImages(ids: string[]) {
    const imageIds = ids.filter(id => filesRef.current.find(f => f.id === id && f.type !== 'other'))
    if (imageIds.length === 0) { notify('No images in selection', 'warn'); return }
    setCompressQuality(75); setCompressTargetKB(''); setCompressSizeMode(false)
    setCompressModal({ ids: imageIds, type: 'image' })
  }

  function openCompressPdf(ids: string[]) {
    if (ids.length === 0) { notify('Select files first', 'warn'); return }
    setCompressQuality(75); setCompressTargetKB(''); setCompressSizeMode(false)
    setCompressModal({ ids, type: 'pdf' })
  }

  async function compressImages(ids: string[], quality: number) {
    setLoading(true); setLoadingMsg('Compressing images…')
    let count = 0
    for (const id of ids) {
      const file = filesRef.current.find(f => f.id === id)
      if (!file) continue
      const img = new Image(); img.src = file.originalDataUrl
      await new Promise(r => { img.onload = r })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      const newUrl = canvas.toDataURL('image/jpeg', quality / 100)
      const newSize = Math.round((newUrl.length * 3) / 4)
      setFiles(p => p.map(f => f.id === id ? { ...f, dataUrl: newUrl, size: newSize, fileTypeInfo: 'JPEG' } : f))
      count++
    }
    setCompressModal(null)
    notify(`Compressed ${count} image${count > 1 ? 's' : ''}`, 'success')
    setLoading(false)
  }

  async function downloadCompressedPdf(ids: string[], quality: number) {
    setLoading(true); setLoadingMsg('Creating compressed PDF…')
    try {
      await loadScript(CDN.jspdf)
      const { jsPDF } = (window as any).jspdf
      const pdf = new jsPDF()
      const targets = filesRef.current.filter(f => ids.includes(f.id))
      for (let i = 0; i < targets.length; i++) {
        if (i > 0) pdf.addPage()
        const file = targets[i]
        const img = new Image(); img.src = file.dataUrl
        await new Promise(r => { img.onload = r })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        const imgData = canvas.toDataURL('image/jpeg', quality / 100)
        const props = pdf.getImageProperties(imgData)
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
        const ratio = Math.min(pw / props.width, ph / props.height)
        pdf.addImage(imgData, 'JPEG', (pw - props.width * ratio) / 2, (ph - props.height * ratio) / 2, props.width * ratio, props.height * ratio, '', 'FAST')
      }
      pdf.save('compressed.pdf')
      notify('Compressed PDF saved', 'success')
    } catch { notify('PDF compression failed', 'error') }
    setCompressModal(null)
    setLoading(false)
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  function pushHistory() {
    const snap = filesRef.current.map(f => ({ ...f }))
    const trimmed = historyRef.current.slice(0, historyIdxRef.current + 1)
    trimmed.push(snap)
    if (trimmed.length > 15) trimmed.shift()
    historyRef.current = trimmed
    historyIdxRef.current = trimmed.length - 1
  }

  function undoHistory() {
    if (historyIdxRef.current <= 0) { notify('Nothing to undo', 'info', 1500); return }
    historyIdxRef.current--
    setFiles([...historyRef.current[historyIdxRef.current]])
    notify('Undone', 'info', 1500)
  }

  function redoHistory() {
    if (historyIdxRef.current >= historyRef.current.length - 1) { notify('Nothing to redo', 'info', 1500); return }
    historyIdxRef.current++
    setFiles([...historyRef.current[historyIdxRef.current]])
    notify('Redone', 'info', 1500)
  }

  // ── Drag reorder ───────────────────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id); e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOverCard(e: React.DragEvent, id: string) {
    e.preventDefault(); setDragOver(id)
  }

  function onDropCard(id: string) {
    if (!dragId || dragId === id) { setDragId(null); setDragOver(null); return }
    pushHistory()
    setFiles(prev => {
      const arr = [...prev]
      const from = arr.findIndex(f => f.id === dragId)
      const to   = arr.findIndex(f => f.id === id)
      if (from === -1 || to === -1) return prev
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
    setDragId(null); setDragOver(null)
  }

  // ── Resize ─────────────────────────────────────────────────────────────────
  function openResize(ids: string[]) {
    const imgs = ids.filter(id => filesRef.current.find(f => f.id === id && f.type !== 'other'))
    if (!imgs.length) { notify('No images selected', 'warn'); return }
    const first = filesRef.current.find(f => f.id === imgs[0])
    const dim = first?.dimensions?.split('×') ?? []
    setResizeW(dim[0] ?? ''); setResizeH(dim[1] ?? '')
    setResizeMode('px'); setResizeLock(true)
    setResizeModal({ ids: imgs })
  }

  async function applyResize(ids: string[], w: number, h: number) {
    if (!w || !h) { notify('Enter valid dimensions', 'warn'); return }
    setLoading(true); setLoadingMsg('Resizing…'); pushHistory()
    for (const id of ids) {
      const file = filesRef.current.find(f => f.id === id); if (!file) continue
      const img = new Image(); img.src = file.dataUrl
      await new Promise(r => { img.onload = r })
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const newUrl = canvas.toDataURL('image/png')
      setFiles(p => p.map(f => f.id === id ? { ...f, dataUrl: newUrl, originalDataUrl: newUrl, dimensions: `${w}×${h}` } : f))
    }
    setResizeModal(null)
    notify(`Resized ${ids.length} image${ids.length > 1 ? 's' : ''}`, 'success')
    setLoading(false)
  }

  // ── Format converter ───────────────────────────────────────────────────────
  function openConvert(ids: string[]) {
    const imgs = ids.filter(id => filesRef.current.find(f => f.id === id))
    if (!imgs.length) { notify('Select files first', 'warn'); return }
    setConvertFormat('jpeg'); setConvertQuality(85)
    setConvertModal({ ids: imgs })
  }

  async function convertAndDownload(ids: string[], fmt: string, quality: number) {
    setLoading(true); setLoadingMsg('Converting…')
    const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
    const ext  = fmt === 'jpeg' ? 'jpg' : fmt
    for (const id of ids) {
      const file = filesRef.current.find(f => f.id === id); if (!file) continue
      const img = new Image(); img.src = file.dataUrl
      await new Promise(r => { img.onload = r })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      if (fmt === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
      ctx.drawImage(img, 0, 0)
      const a = document.createElement('a')
      a.href = canvas.toDataURL(mime, quality / 100)
      a.download = `${file.name.replace(/\.[^.]+$/, '')}.${ext}`; a.click()
    }
    setConvertModal(null)
    notify(`Downloaded ${ids.length} file${ids.length > 1 ? 's' : ''} as ${fmt.toUpperCase()}`, 'success')
    setLoading(false)
  }

  // ── Watermark ──────────────────────────────────────────────────────────────
  async function applyWatermark(ids: string[]) {
    setLoading(true); setLoadingMsg('Adding watermark…'); pushHistory()
    for (const id of ids) {
      const file = filesRef.current.find(f => f.id === id); if (!file) continue
      const img = new Image(); img.src = file.dataUrl
      await new Promise(r => { img.onload = r })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      ctx.save()
      ctx.globalAlpha = wmOpacity / 100
      ctx.fillStyle = wmColor
      ctx.font = `bold ${wmFontSize}px Arial, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      if (wmPosition === 'tile') {
        ctx.rotate((wmAngle * Math.PI) / 180)
        const tw = ctx.measureText(wmText).width + wmFontSize * 2
        const th = wmFontSize * 3
        for (let y = -canvas.height * 2; y < canvas.height * 2; y += th)
          for (let x = -canvas.width * 2; x < canvas.width * 2; x += tw)
            ctx.fillText(wmText, x, y)
      } else {
        const pad = wmFontSize
        const pos: Record<string, [number,number]> = {
          center: [canvas.width/2, canvas.height/2],
          tl: [pad*2, pad], tr: [canvas.width-pad*2, pad],
          bl: [pad*2, canvas.height-pad], br: [canvas.width-pad*2, canvas.height-pad],
        }
        const [x, y] = pos[wmPosition] ?? pos.center
        ctx.translate(x, y); ctx.rotate((wmAngle * Math.PI) / 180)
        ctx.fillText(wmText, 0, 0)
      }
      ctx.restore()
      const newUrl = canvas.toDataURL('image/png')
      setFiles(p => p.map(f => f.id === id ? { ...f, dataUrl: newUrl } : f))
    }
    setWatermarkModal(null)
    notify(`Watermark applied to ${ids.length} image${ids.length > 1 ? 's' : ''}`, 'success')
    setLoading(false)
  }

  // ── E-Signature ────────────────────────────────────────────────────────────
  function getSignPt(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = signCanvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function startSignDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    setSignDrawing(true); signLastPt.current = getSignPt(e)
  }
  function doSignDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!signDrawing || !signLastPt.current || !signCanvasRef.current) return
    const ctx = signCanvasRef.current.getContext('2d')!
    const pt = getSignPt(e)
    ctx.strokeStyle = signColor; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.beginPath(); ctx.moveTo(signLastPt.current.x, signLastPt.current.y); ctx.lineTo(pt.x, pt.y); ctx.stroke()
    signLastPt.current = pt
  }
  function endSignDraw() { setSignDrawing(false); signLastPt.current = null }
  function clearSignCanvas() {
    const c = signCanvasRef.current; if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
  }

  async function applySignature(fileId: string) {
    setLoading(true); setLoadingMsg('Applying signature…'); pushHistory()
    const file = filesRef.current.find(f => f.id === fileId)
    if (!file) { setLoading(false); return }
    const img = new Image(); img.src = file.dataUrl
    await new Promise(r => { img.onload = r })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)

    let signDataUrl: string
    if (signTab === 'draw' && signCanvasRef.current) {
      signDataUrl = signCanvasRef.current.toDataURL('image/png')
    } else {
      const tc = document.createElement('canvas'); tc.width = 400; tc.height = 100
      const tctx = tc.getContext('2d')!
      tctx.font = `48px ${signFont}`; tctx.fillStyle = signColor; tctx.textBaseline = 'middle'
      tctx.fillText(signText, 10, 50)
      signDataUrl = tc.toDataURL('image/png')
    }

    const sImg = new Image(); sImg.src = signDataUrl
    await new Promise(r => { sImg.onload = r })
    const sw = Math.round(canvas.width * 0.3)
    const sh = Math.round((sw / sImg.naturalWidth) * sImg.naturalHeight)
    const pad = 20
    const positions: Record<string,[number,number]> = {
      br: [canvas.width - sw - pad, canvas.height - sh - pad],
      bl: [pad, canvas.height - sh - pad],
      tr: [canvas.width - sw - pad, pad],
      tl: [pad, pad],
      center: [(canvas.width-sw)/2, (canvas.height-sh)/2],
    }
    const [sx, sy] = positions[signPos] ?? positions.br
    ctx.drawImage(sImg, sx, sy, sw, sh)
    const newUrl = canvas.toDataURL('image/png')
    setFiles(p => p.map(f => f.id === fileId ? { ...f, dataUrl: newUrl } : f))
    setSignModal(null)
    notify('Signature applied', 'success')
    setLoading(false)
  }

  // ── PDF Splitter ───────────────────────────────────────────────────────────
  async function downloadSplitPdf(from: number, to: number) {
    const pages = filesRef.current.filter(f => f.type === 'pdf-page' && f.pageNum !== undefined && f.pageNum >= from && f.pageNum <= to)
    if (!pages.length) { notify('No pages in that range', 'warn'); return }
    setLoading(true); setLoadingMsg('Splitting PDF…')
    try {
      await loadScript(CDN.jspdf)
      const { jsPDF } = (window as any).jspdf
      const pdf = new jsPDF()
      for (let i = 0; i < pages.length; i++) {
        if (i > 0) pdf.addPage()
        const imgData = await getRotatedDataUrl(pages[i])
        const props = pdf.getImageProperties(imgData)
        const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
        const ratio = Math.min(pw / props.width, ph / props.height)
        pdf.addImage(imgData, 'PNG', (pw - props.width*ratio)/2, (ph - props.height*ratio)/2, props.width*ratio, props.height*ratio)
      }
      pdf.save(`pages_${from}-${to}.pdf`)
      notify(`Saved pages ${from}–${to} as PDF`, 'success')
    } catch { notify('Split failed', 'error') }
    setLoading(false)
  }

  // ── Tesseract OCR (no API key) ─────────────────────────────────────────────
  async function extractTextTesseract(file: FileItem) {
    setLoading(true); setLoadingMsg('Loading OCR engine…'); setOcrProgress(0)
    try {
      await loadScript(CDN.tesseract)
      const T = (window as any).Tesseract
      setLoadingMsg('Running OCR…')
      const result = await T.recognize(file.originalDataUrl, 'eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100))
            setLoadingMsg(`OCR: ${Math.round(m.progress * 100)}%`)
          }
        },
      })
      const text = result.data.text?.trim() || '(no text found)'
      setFiles(p => p.map(f => f.id === file.id ? { ...f, extractedText: text } : f))
      setExtractedTexts(p => ({ ...p, [file.id]: text }))
      notify('Text extracted (OCR)', 'success')
    } catch (err: any) { notify(`OCR failed: ${err.message}`, 'error', 5000) }
    setOcrProgress(0); setLoading(false)
  }

  // ── Before / After ─────────────────────────────────────────────────────────
  function toggleOriginal(id: string) {
    setShowOriginal(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function saveState() {
    try {
      localStorage.setItem('zplayer_state', JSON.stringify({ files, et: extractedTexts }))
      notify('Project saved', 'success')
    } catch { notify('Save failed (files too large for localStorage)', 'error', 5000) }
  }

  function savePrefs(patch: Record<string, unknown>) {
    try {
      const cur = JSON.parse(localStorage.getItem('zp_prefs') || '{}')
      localStorage.setItem('zp_prefs', JSON.stringify({ ...cur, ...patch }))
    } catch {}
  }

  // ── Date Stamp ─────────────────────────────────────────────────────────────
  async function applyDateStamp(ids: string[]) {
    setLoading(true); setLoadingMsg('Applying date stamp…'); pushHistory()
    const now = new Date()
    const text = dsFormat === 'datetime' ? now.toLocaleString() :
                 dsFormat === 'date'     ? now.toLocaleDateString() :
                 dsFormat === 'time'     ? now.toLocaleTimeString() :
                 (dsCustomText || now.toLocaleString())
    for (const id of ids) {
      const file = filesRef.current.find(f => f.id === id); if (!file) continue
      const img = new Image(); img.src = file.dataUrl; await new Promise(r => { img.onload = r })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      ctx.font = `bold ${dsFontSize}px Arial, sans-serif`
      const tw = ctx.measureText(text).width
      const pad = dsFontSize * 0.5
      const positions: Record<string,[number,number,CanvasTextAlign,CanvasTextBaseline]> = {
        br: [canvas.width  - pad, canvas.height - pad, 'right',  'bottom'],
        bl: [pad,                 canvas.height - pad, 'left',   'bottom'],
        tr: [canvas.width  - pad, pad,                 'right',  'top'   ],
        tl: [pad,                 pad,                 'left',   'top'   ],
        center: [canvas.width/2,  canvas.height/2,     'center', 'middle'],
      }
      const [x, y, align, baseline] = positions[dsPosition] ?? positions.br
      ctx.textAlign = align; ctx.textBaseline = baseline
      if (dsBg) {
        const bw = tw + pad * 2, bh = dsFontSize * 1.5
        let bx = x, by = y
        if (align === 'right')  bx = x - bw
        if (align === 'center') bx = x - bw / 2
        if (baseline === 'bottom') by = y - bh
        if (baseline === 'middle') by = y - bh / 2
        ctx.save(); ctx.globalAlpha = (dsOpacity / 100) * 0.55
        ctx.fillStyle = '#000'; ctx.fillRect(bx - pad*0.3, by - pad*0.3, bw + pad*0.6, bh + pad*0.6)
        ctx.restore()
      }
      ctx.save(); ctx.globalAlpha = dsOpacity / 100; ctx.fillStyle = dsColor
      ctx.fillText(text, x, y); ctx.restore()
      setFiles(p => p.map(f => f.id === id ? { ...f, dataUrl: canvas.toDataURL('image/png') } : f))
    }
    setDateStampModal(null)
    notify(`Date stamp applied to ${ids.length} image${ids.length > 1 ? 's' : ''}`, 'success')
    setLoading(false)
  }

  // ── Side-by-side compare ───────────────────────────────────────────────────
  function openCompare() {
    const imgs = selectedFiles.filter(f => f.type === 'image' || f.type === 'pdf-page')
    if (imgs.length < 2) { notify('Select exactly 2 files to compare', 'warn'); return }
    setCompareIds([imgs[0].id, imgs[1].id])
  }

  // ── Gallery / Zoom helpers ─────────────────────────────────────────────────
  function openGallery(file: FileItem) {
    const idx = files.findIndex(f => f.id === file.id)
    setGalleryIndex(Math.max(0, idx))
    setGalleryOpen(true)
  }

  // ── Text editor ────────────────────────────────────────────────────────────
  function openEditorWith(content: string, isHtml: boolean) {
    const html = isHtml ? content : textToHtml(content)
    setTextTitle('Untitled document')
    setTextEditorOpen(true)
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = html }, 30)
  }

  function execCmd(cmd: string, val?: string) {
    document.execCommand(cmd, false, val)
    editorRef.current?.focus()
  }

  function handleEditorPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    const items  = Array.from(e.clipboardData.items)
    const tHtml  = items.find(i => i.kind === 'string' && i.type === 'text/html')
    const tPlain = items.find(i => i.kind === 'string' && i.type === 'text/plain')
    const el = editorRef.current; if (!el) return
    if (tHtml && !strictModeRef.current) {
      tHtml.getAsString(html => { el.focus(); document.execCommand('insertHTML', false, sanitizeHtml(html)) })
    } else if (tPlain) {
      tPlain.getAsString(raw => { el.focus(); document.execCommand('insertText', false, fixPdfSpacing(raw)) })
    }
  }

  async function downloadTextAsPdf() {
    const el = editorRef.current; if (!el) return
    setLoading(true); setLoadingMsg('Generating PDF…')
    try {
      await loadScript(CDN.html2canvas)
      await loadScript(CDN.jspdf)
      const { jsPDF } = (window as any).jspdf
      const full: HTMLCanvasElement = await (window as any).html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const pageHpx = Math.round(full.width * ph / pw)
      const totalPages = Math.ceil(full.height / pageHpx)
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) pdf.addPage()
        const slice = document.createElement('canvas')
        slice.width = full.width; slice.height = pageHpx
        const ctx = slice.getContext('2d')!
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, slice.width, slice.height)
        ctx.drawImage(full, 0, -i * pageHpx)
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph)
      }
      pdf.save(`${textTitle.replace(/\s+/g, '_')}.pdf`)
      notify(`PDF saved (${totalPages} page${totalPages > 1 ? 's' : ''})`, 'success', 2500)
    } catch (err: any) { notify(`PDF failed: ${err.message}`, 'error', 5000) }
    setLoading(false)
  }

  function downloadTextAsWord() {
    const el = editorRef.current; if (!el) return
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${textTitle}</title></head><body>${el.innerHTML}</body></html>`
    const blob = new Blob(['﻿', html], { type: 'application/msword' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${textTitle.replace(/\s+/g, '_')}.doc`; a.click()
    URL.revokeObjectURL(a.href)
  }

  async function downloadTextAsImages() {
    const el = editorRef.current; if (!el) return
    setLoading(true); setLoadingMsg('Rendering pages…')
    try {
      await loadScript(CDN.html2canvas)
      const full: HTMLCanvasElement = await (window as any).html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const pageW = full.width
      const pageH = Math.round(pageW * 297 / 210)
      const pages = Math.ceil(full.height / pageH)
      for (let i = 0; i < pages; i++) {
        const pc = document.createElement('canvas'); pc.width = pageW; pc.height = pageH
        const ctx = pc.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pageW, pageH)
        ctx.drawImage(full, 0, -i * pageH)
        const a = document.createElement('a')
        a.href = pc.toDataURL('image/png')
        a.download = `${textTitle.replace(/\s+/g, '_')}_p${i + 1}.png`; a.click()
      }
      notify(`${pages} image${pages > 1 ? 's' : ''} downloaded`, 'success')
    } catch { notify('Image export failed', 'error') }
    setLoading(false)
  }

  // ── Annotation ─────────────────────────────────────────────────────────────
  async function openAnnotate(file: FileItem) {
    setAnnotateFile(file)
    setAnnotateRotatedUrl('')
    const url = await getRotatedDataUrl(file)
    setAnnotateRotatedUrl(url)
  }

  function getCanvasPoint(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = annotateCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    const pt = getCanvasPoint(e)
    if (annotateMode === 'text') {
      const canvas = annotateCanvasRef.current!
      const ctx = canvas.getContext('2d')!
      ctx.font = `bold ${annotateSize * 5}px Arial, sans-serif`
      ctx.fillStyle = annotateColor; ctx.globalAlpha = 1
      ctx.fillText(annotateText, pt.x, pt.y)
      return
    }
    if (annotateMode === 'highlight') {
      const canvas = annotateCanvasRef.current!
      annotateSnapshot.current = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      annotateHlStart.current = pt
    } else {
      lastPoint.current = pt
    }
    setIsDrawing(true)
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing) return
    const canvas = annotateCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    const pt = getCanvasPoint(e)
    if (annotateMode === 'draw') {
      if (!lastPoint.current) return
      ctx.strokeStyle = annotateColor; ctx.lineWidth = annotateSize
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
      ctx.lineTo(pt.x, pt.y); ctx.stroke()
      lastPoint.current = pt
    } else if (annotateMode === 'highlight' && annotateHlStart.current) {
      if (annotateSnapshot.current) ctx.putImageData(annotateSnapshot.current, 0, 0)
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = annotateColor
      ctx.fillRect(annotateHlStart.current.x, annotateHlStart.current.y, pt.x - annotateHlStart.current.x, pt.y - annotateHlStart.current.y)
      ctx.restore()
    }
  }

  function endDraw(e?: React.MouseEvent<HTMLCanvasElement>) {
    if (annotateMode === 'highlight' && annotateHlStart.current && e) {
      const canvas = annotateCanvasRef.current!
      const ctx = canvas.getContext('2d')!
      const pt = getCanvasPoint(e)
      if (annotateSnapshot.current) ctx.putImageData(annotateSnapshot.current, 0, 0)
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = annotateColor
      ctx.fillRect(annotateHlStart.current.x, annotateHlStart.current.y, pt.x - annotateHlStart.current.x, pt.y - annotateHlStart.current.y)
      ctx.restore()
      annotateSnapshot.current = null; annotateHlStart.current = null
    }
    setIsDrawing(false); lastPoint.current = null
  }

  function clearAnnotation() {
    const canvas = annotateCanvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
  }

  async function saveAnnotation() {
    if (!annotateFile || !annotateRotatedUrl || !annotateCanvasRef.current) return
    const img = new Image()
    img.src = annotateRotatedUrl
    await new Promise(r => { img.onload = r })
    const out = document.createElement('canvas')
    out.width = img.naturalWidth; out.height = img.naturalHeight
    const ctx = out.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    ctx.drawImage(annotateCanvasRef.current, 0, 0, out.width, out.height)
    const newUrl = out.toDataURL('image/png')
    setFiles(p => p.map(f => f.id === annotateFile.id ? { ...f, dataUrl: newUrl } : f))
    setAnnotateFile(null); setAnnotateRotatedUrl('')
    notify('Annotation saved', 'success')
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const TOOLS: { id: Tool; label: string; Icon: any }[] = [
    { id: 'files',   label: 'Files',        Icon: Layers    },
    { id: 'merge',   label: 'Merge PDF',    Icon: FileStack },
    { id: 'split',   label: 'Split PDF',    Icon: Scissors  },
    { id: 'extract', label: 'Extract Text', Icon: Search    },
    { id: 'convert', label: 'Convert',      Icon: ImageIcon },
  ]

  const pdfPages = files.filter(f => f.type === 'pdf-page' && f.pageNum !== undefined)
  const maxPage  = pdfPages.reduce((m, f) => Math.max(m, f.pageNum!), 0)
  const notifBg: Record<NotifType, string> = {
    success: 'bg-emerald-500 text-white', error: 'bg-red-500 text-white',
    warn: 'bg-amber-400 text-black', info: 'bg-blue-500 text-white',
  }
  const filesWithText = files.filter(f => extractedTexts[f.id])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      {/* Standalone header */}
      <header className="h-12 border-b border-white/[0.06] flex items-center px-5 gap-3 bg-[#0a0a0a] sticky top-0 z-40 flex-shrink-0">
        <div className="w-6 h-6 rounded-lg bg-pink-500/15 border border-pink-500/20 flex items-center justify-center">
          <Layers size={12} className="text-pink-400" />
        </div>
        <span className="text-white text-sm font-semibold">zPlayer</span>
        <span className="text-white/20 text-[10px] font-mono">zplayer.harshz.com</span>
        <div className="ml-auto flex items-center gap-2">
          <a href="https://harshz.com" target="_blank" rel="noreferrer"
            className="text-white/20 hover:text-white/50 text-[10px] transition-colors">
            harshz.com →
          </a>
        </div>
      </header>
    <div className="flex flex-1 h-[calc(100vh-48px)] gap-4 relative p-4">

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-4 border-white/20 border-t-pink-400 rounded-full animate-spin" />
          <p className="text-white/60 text-sm text-center max-w-xs">{loadingMsg}</p>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {notifs.map(n => (
          <div key={n.id} className={`${notifBg[n.type]} px-4 py-2.5 rounded-xl text-xs shadow-lg font-medium`}>{n.msg}</div>
        ))}
      </div>

      {/* ── ZOOM MODAL ────────────────────────────────────────────────────── */}
      {zoomFile && (() => {
        const idx = files.findIndex(f => f.id === zoomFile.id)
        return (
          <div className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10 flex-shrink-0">
              <p className="text-white/80 text-sm font-medium flex-1 truncate">{zoomFile.name}</p>
              <span className="text-white/25 text-xs">{idx + 1} / {files.length}</span>
              <button onClick={() => rotateFile(zoomFile.id)} title="Rotate"
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                <RotateCw size={13} className="text-white/60" />
              </button>
              <button onClick={() => extractText(zoomFile)} title="Extract text"
                className="w-8 h-8 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 flex items-center justify-center transition-colors">
                <Search size={13} className="text-pink-400" />
              </button>
              <button onClick={() => downloadImage(zoomFile)} title="Download image"
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                <Download size={13} className="text-white/60" />
              </button>
              <button onClick={() => { openAnnotate(zoomFile); setZoomFile(null) }} title="Annotate"
                className="w-8 h-8 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 flex items-center justify-center transition-colors">
                <Pencil size={13} className="text-amber-400" />
              </button>
              <button onClick={() => setZoomFile(null)}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                <X size={14} className="text-white/60" />
              </button>
            </div>

            {/* Image */}
            <div className="flex-1 flex items-center justify-center relative min-h-0 p-6">
              {idx > 0 && (
                <button onClick={() => setZoomFile(files[idx - 1])}
                  className="absolute left-3 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                  <ChevronLeft size={18} className="text-white" />
                </button>
              )}
              <img
                src={zoomFile.dataUrl}
                alt={zoomFile.name}
                style={{ transform: `rotate(${zoomFile.rotation}deg)`, transition: 'transform 0.3s ease' }}
                className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
              />
              {idx < files.length - 1 && (
                <button onClick={() => setZoomFile(files[idx + 1])}
                  className="absolute right-3 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all">
                  <ChevronRight size={18} className="text-white" />
                </button>
              )}
            </div>

            {/* Footer info */}
            {extractedTexts[zoomFile.id] && (
              <div className="px-6 py-3 border-t border-white/10 flex-shrink-0 max-h-32 overflow-y-auto">
                <p className="text-white/25 text-[10px] font-semibold uppercase tracking-wider mb-1">Extracted text</p>
                <p className="text-white/50 text-xs leading-relaxed whitespace-pre-wrap">{extractedTexts[zoomFile.id]}</p>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── GALLERY MODAL ─────────────────────────────────────────────────── */}
      {galleryOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10 flex-shrink-0">
            <p className="text-white/70 text-sm font-medium flex-1 truncate">{files[galleryIndex]?.name}</p>
            <span className="text-white/30 text-xs">{galleryIndex + 1} / {files.length}</span>
            <button onClick={() => setGalleryOpen(false)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
              <X size={14} className="text-white/60" />
            </button>
          </div>

          {/* Main image */}
          <div className="flex-1 flex items-center justify-center relative min-h-0 px-16">
            {galleryIndex > 0 && (
              <button onClick={() => setGalleryIndex(i => i - 1)}
                className="absolute left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <ChevronLeft size={18} className="text-white" />
              </button>
            )}
            {files[galleryIndex] && (
              <img
                src={files[galleryIndex].dataUrl}
                alt={files[galleryIndex].name}
                style={{ transform: `rotate(${files[galleryIndex].rotation}deg)` }}
                className="max-h-full max-w-full object-contain"
              />
            )}
            {galleryIndex < files.length - 1 && (
              <button onClick={() => setGalleryIndex(i => i + 1)}
                className="absolute right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
                <ChevronRight size={18} className="text-white" />
              </button>
            )}
          </div>

          {/* Thumbnail strip */}
          <div className="flex gap-2 px-6 py-3 border-t border-white/10 overflow-x-auto flex-shrink-0">
            {files.map((f, i) => (
              <button key={f.id} onClick={() => setGalleryIndex(i)}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all ${
                  i === galleryIndex ? 'ring-2 ring-pink-400 opacity-100' : 'opacity-40 hover:opacity-70'
                }`}>
                <img src={f.dataUrl} alt={f.name}
                  style={{ transform: `rotate(${f.rotation}deg)` }}
                  className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ANNOTATE MODAL ────────────────────────────────────────────────── */}
      {annotateFile && (
        <div className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <Pencil size={13} className="text-amber-400" />
              <p className="text-white/70 text-sm font-medium truncate max-w-48">{annotateFile.name}</p>
            </div>

            {/* Mode selector */}
            <div className="flex items-center gap-1 bg-white/[0.04] border border-white/10 rounded-lg p-0.5 flex-shrink-0">
              {([['draw','Draw'],['highlight','Highlight'],['text','Text']] as const).map(([mode, label]) => (
                <button key={mode} onClick={() => setAnnotateMode(mode)}
                  className={`px-2.5 py-1 rounded-md text-[9px] transition-all ${annotateMode === mode ? 'bg-amber-500 text-black font-semibold' : 'text-white/40 hover:text-white/70'}`}>
                  {label}
                </button>
              ))}
            </div>

            {annotateMode === 'text' && (
              <input type="text" value={annotateText} onChange={e => setAnnotateText(e.target.value)}
                placeholder="Label text…"
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white/70 outline-none w-28 focus:border-amber-500/40" />
            )}

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {ANNOTATE_COLORS.map(c => (
                <button key={c} onClick={() => setAnnotateColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${annotateColor === c ? 'border-white scale-110' : 'border-white/20 hover:border-white/50'}`}
                  style={{ background: c }} />
              ))}
            </div>

            {annotateMode !== 'highlight' && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-white/30 text-[10px]">Size</span>
                <input type="range" min={1} max={20} value={annotateSize}
                  onChange={e => setAnnotateSize(Number(e.target.value))}
                  className="w-20 h-1 accent-amber-400" />
                <span className="text-white/40 text-[10px] w-4">{annotateSize}</span>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              <button onClick={clearAnnotation}
                className="flex items-center gap-1.5 text-xs text-white/50 border border-white/10 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 px-3 py-1.5 rounded-lg transition-all">
                <Eraser size={11} /> Clear
              </button>
              <button onClick={saveAnnotation}
                className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black px-4 py-1.5 rounded-lg transition-colors">
                <Check size={11} /> Save
              </button>
              <button onClick={() => { setAnnotateFile(null); setAnnotateRotatedUrl('') }}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                <X size={14} className="text-white/60" />
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div className="flex-1 flex items-center justify-center bg-[#080808] min-h-0 p-6">
            {annotateRotatedUrl ? (
              <div className="relative inline-block max-h-full" style={{ lineHeight: 0 }}>
                <img
                  src={annotateRotatedUrl}
                  alt="annotate"
                  onLoad={e => {
                    const img = e.currentTarget
                    const canvas = annotateCanvasRef.current
                    if (canvas) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight }
                  }}
                  className="block max-h-[calc(100vh-160px)] max-w-full object-contain select-none"
                  draggable={false}
                />
                <canvas
                  ref={annotateCanvasRef}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                  style={{ touchAction: 'none' }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-white/30 text-sm">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                Preparing canvas…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RESIZE MODAL ─────────────────────────────────────────────────── */}
      {resizeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setResizeModal(null)}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center"><Move size={13} className="text-sky-400" /></div>
              <div className="flex-1"><p className="text-white/80 text-sm font-medium">Resize</p><p className="text-white/30 text-[10px]">{resizeModal.ids.length} image{resizeModal.ids.length > 1 ? 's' : ''}</p></div>
              <button onClick={() => setResizeModal(null)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center"><X size={12} className="text-white/50" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex gap-2">
                {(['px','pct'] as const).map(m => (
                  <button key={m} onClick={() => setResizeMode(m)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] border transition-all ${resizeMode === m ? 'bg-sky-500/15 border-sky-500/25 text-sky-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                    {m === 'px' ? 'Pixels' : 'Percentage'}
                  </button>
                ))}
              </div>
              {resizeMode === 'px' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['1920×1080','1920','1080'],['1280×720','1280','720'],['1080×1080','1080','1080'],['800×600','800','600'],['A4 (px)','794','1123'],['Stories','1080','1920']].map(([label,w,h]) => (
                      <button key={label} onClick={() => { setResizeW(w); setResizeH(h) }}
                        className="py-1 rounded-lg border border-white/10 text-white/40 hover:border-sky-500/30 hover:text-sky-400 text-[9px] transition-all">{label}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1"><p className="text-white/30 text-[9px] mb-1">Width (px)</p>
                      <input type="number" value={resizeW} onChange={e => { setResizeW(e.target.value); if (resizeLock && resizeH && resizeW) { const r = Number(e.target.value)/Number(resizeW); setResizeH(String(Math.round(Number(resizeH)*r))) } }}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none focus:border-sky-500/40" /></div>
                    <button onClick={() => setResizeLock(v => !v)} className={`mt-5 text-[10px] px-1.5 py-1 rounded border transition-all ${resizeLock ? 'border-sky-500/30 text-sky-400' : 'border-white/10 text-white/30'}`}>🔒</button>
                    <div className="flex-1"><p className="text-white/30 text-[9px] mb-1">Height (px)</p>
                      <input type="number" value={resizeH} onChange={e => { setResizeH(e.target.value); if (resizeLock && resizeW && resizeH) { const r = Number(e.target.value)/Number(resizeH); setResizeW(String(Math.round(Number(resizeW)*r))) } }}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none focus:border-sky-500/40" /></div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-white/30 text-[10px]">Scale factor</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['25','50','75','150'].map(p => (
                      <button key={p} onClick={() => { setResizeW(p); setResizeH(p) }}
                        className="py-1.5 rounded-lg border border-white/10 text-white/40 hover:border-sky-500/30 hover:text-sky-400 text-[10px] transition-all">{p}%</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={resizeW} onChange={e => { setResizeW(e.target.value); setResizeH(e.target.value) }}
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none focus:border-sky-500/40" />
                    <span className="text-white/40 text-sm">%</span>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setResizeModal(null)} className="flex-1 py-2 rounded-xl border border-white/10 text-white/40 text-xs">Cancel</button>
                <button onClick={async () => {
                  if (resizeMode === 'px') {
                    await applyResize(resizeModal.ids, Number(resizeW), Number(resizeH))
                  } else {
                    const pct = Number(resizeW) / 100
                    for (const id of resizeModal.ids) {
                      const f = filesRef.current.find(x => x.id === id); if (!f) continue
                      const dim = f.dimensions?.split('×') ?? ['800','600']
                      await applyResize([id], Math.round(Number(dim[0])*pct), Math.round(Number(dim[1])*pct))
                    }
                  }
                }} className="flex-1 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-black text-xs font-semibold">Apply Resize</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CONVERT MODAL ────────────────────────────────────────────────── */}
      {convertModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConvertModal(null)}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center"><RefreshCw size={13} className="text-indigo-400" /></div>
              <div className="flex-1"><p className="text-white/80 text-sm font-medium">Convert Format</p><p className="text-white/30 text-[10px]">{convertModal.ids.length} file{convertModal.ids.length > 1 ? 's' : ''}</p></div>
              <button onClick={() => setConvertModal(null)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center"><X size={12} className="text-white/50" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="flex gap-2">
                {(['jpeg','png','webp'] as const).map(fmt => (
                  <button key={fmt} onClick={() => setConvertFormat(fmt)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-semibold border transition-all ${convertFormat === fmt ? 'bg-indigo-500/15 border-indigo-500/25 text-indigo-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
              {convertFormat !== 'png' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-white/40 text-[10px]">Quality</span><span className="text-white/70 text-[10px] font-mono">{convertQuality}%</span></div>
                  <input type="range" min={10} max={100} value={convertQuality} onChange={e => setConvertQuality(Number(e.target.value))} className="w-full h-1.5 accent-indigo-400" />
                </div>
              )}
              <div className="text-white/20 text-[9px]">
                {convertFormat === 'jpeg' && 'Best for photos · smaller files · no transparency'}
                {convertFormat === 'png'  && 'Lossless · supports transparency · larger files'}
                {convertFormat === 'webp' && 'Modern format · best compression · broad browser support'}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setConvertModal(null)} className="flex-1 py-2 rounded-xl border border-white/10 text-white/40 text-xs">Cancel</button>
                <button onClick={() => convertAndDownload(convertModal.ids, convertFormat, convertQuality)}
                  className="flex-1 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold">Download as {convertFormat.toUpperCase()}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── WATERMARK MODAL ──────────────────────────────────────────────── */}
      {watermarkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setWatermarkModal(null)}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center"><Stamp size={13} className="text-rose-400" /></div>
              <div className="flex-1"><p className="text-white/80 text-sm font-medium">Watermark</p><p className="text-white/30 text-[10px]">{watermarkModal.ids.length} image{watermarkModal.ids.length > 1 ? 's' : ''}</p></div>
              <button onClick={() => setWatermarkModal(null)} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center"><X size={12} className="text-white/50" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div><p className="text-white/30 text-[9px] mb-1">Text</p>
                <input value={wmText} onChange={e => setWmText(e.target.value)} placeholder="Watermark text…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-rose-500/40 placeholder-white/20" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-white/30 text-[9px] mb-1">Font size (px)</p>
                  <input type="number" value={wmFontSize} onChange={e => setWmFontSize(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none" /></div>
                <div><p className="text-white/30 text-[9px] mb-1">Opacity %</p>
                  <input type="number" min={5} max={100} value={wmOpacity} onChange={e => setWmOpacity(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-white/30 text-[9px] mb-1">Color</p>
                  <input type="color" value={wmColor} onChange={e => setWmColor(e.target.value)} className="w-full h-9 rounded-lg border border-white/10 cursor-pointer p-1" /></div>
                <div><p className="text-white/30 text-[9px] mb-1">Angle °</p>
                  <input type="number" min={-180} max={180} value={wmAngle} onChange={e => setWmAngle(Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white/70 outline-none" /></div>
              </div>
              <div><p className="text-white/30 text-[9px] mb-1.5">Position</p>
                <div className="grid grid-cols-3 gap-1">
                  {([['tl','↖ Top left'],['center','⊕ Center'],['tr','↗ Top right'],['bl','↙ Bot left'],['tile','⊞ Tile'],['br','↘ Bot right']] as const).map(([pos,label]) => (
                    <button key={pos} onClick={() => setWmPosition(pos)}
                      className={`py-1 rounded-lg text-[9px] border transition-all ${wmPosition === pos ? 'bg-rose-500/15 border-rose-500/25 text-rose-400' : 'border-white/10 text-white/35 hover:text-white/60'}`}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setWatermarkModal(null)} className="flex-1 py-2 rounded-xl border border-white/10 text-white/40 text-xs">Cancel</button>
                <button onClick={() => applyWatermark(watermarkModal.ids)} className="flex-1 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold">Apply Watermark</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── E-SIGNATURE MODAL ─────────────────────────────────────────────── */}
      {signModal && (
        <div className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-2"><PenLine size={13} className="text-fuchsia-400" /><p className="text-white/70 text-sm font-medium">E-Signature</p></div>
            <div className="flex gap-1 ml-4">
              {(['draw','type'] as const).map(t => (
                <button key={t} onClick={() => setSignTab(t)}
                  className={`px-3 py-1 rounded-lg text-[10px] border transition-all ${signTab === t ? 'bg-fuchsia-500/15 border-fuchsia-500/25 text-fuchsia-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                  {t === 'draw' ? '✏ Draw' : 'Aa Type'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-white/25 text-[9px]">Color</span>
              <input type="color" value={signColor} onChange={e => setSignColor(e.target.value)} className="w-7 h-7 rounded border border-white/10 cursor-pointer p-0.5" />
            </div>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-white/25 text-[9px]">Position</span>
              <select value={signPos} onChange={e => setSignPos(e.target.value as any)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white/50 outline-none">
                <option value="br">Bottom right</option><option value="bl">Bottom left</option>
                <option value="tr">Top right</option><option value="tl">Top left</option><option value="center">Center</option>
              </select>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              {signTab === 'draw' && <button onClick={clearSignCanvas} className="text-white/30 hover:text-red-400 text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.06] transition-all"><Eraser size={11} className="inline mr-1" />Clear</button>}
              <button onClick={() => applySignature(signModal.id)}
                className="flex items-center gap-1.5 text-xs font-semibold bg-fuchsia-500 hover:bg-fuchsia-400 text-white px-4 py-1.5 rounded-lg transition-colors">
                <Check size={11} /> Apply
              </button>
              <button onClick={() => setSignModal(null)} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center"><X size={14} className="text-white/60" /></button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-[#080808] min-h-0 p-6">
            {signTab === 'draw' ? (
              <div className="bg-white rounded-xl shadow-2xl overflow-hidden" style={{ width: 500, height: 200 }}>
                <canvas
                  ref={signCanvasRef} width={500} height={200}
                  className="block cursor-crosshair"
                  onMouseDown={startSignDraw} onMouseMove={doSignDraw}
                  onMouseUp={endSignDraw} onMouseLeave={endSignDraw}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 w-full max-w-md">
                <input value={signText} onChange={e => setSignText(e.target.value)} placeholder="Type your signature…"
                  style={{ fontFamily: signFont, fontSize: 32, color: signColor }}
                  className="w-full text-center bg-white rounded-xl px-6 py-6 outline-none shadow-2xl border-2 border-white/20 focus:border-fuchsia-400/50" />
                <div className="flex gap-2 flex-wrap justify-center">
                  {['cursive','Georgia, serif','"Brush Script MT", cursive','Palatino, serif'].map(f => (
                    <button key={f} onClick={() => setSignFont(f)}
                      style={{ fontFamily: f }}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${signFont === f ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300' : 'border-white/15 text-white/40 hover:text-white/70'}`}>
                      Signature
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CROP MODAL ───────────────────────────────────────────────────── */}
      {cropFile && (
        <div className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 flex-shrink-0 flex-wrap">
            <div className="flex items-center gap-2">
              <Crop size={13} className="text-emerald-400" />
              <p className="text-white/70 text-sm font-medium truncate max-w-48">{cropFile.name}</p>
              {bulkCropIds.length > 1 && (
                <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full">
                  {bulkCropIds.length} images selected
                </span>
              )}
            </div>
            <p className="text-white/25 text-[10px] ml-2">Click and drag to select crop area</p>
            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              {cropRect && cropRect.w > 0.01 && cropRect.h > 0.01 && (
                <>
                  <button onClick={() => applyCrop([cropFile.id])}
                    className="flex items-center gap-1.5 text-xs text-white/50 border border-white/10 hover:bg-white/5 px-3 py-1.5 rounded-lg transition-all">
                    Crop this
                  </button>
                  {bulkCropIds.length > 1 && (
                    <button onClick={() => applyCrop(bulkCropIds)}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-1.5 rounded-lg transition-colors">
                      <Check size={11} /> Apply to all ({bulkCropIds.length})
                    </button>
                  )}
                </>
              )}
              <button onClick={() => setCropRect(null)} disabled={!cropRect}
                className="text-white/30 hover:text-amber-400 text-[10px] px-2 py-1.5 rounded-lg border border-white/[0.06] hover:border-amber-500/20 transition-all disabled:opacity-20">
                Reset
              </button>
              <button onClick={() => { setCropFile(null); setCropRect(null); setBulkCropIds([]) }}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                <X size={14} className="text-white/60" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-[#080808] min-h-0 p-6">
            <div
              ref={cropContainerRef}
              className="relative inline-block select-none overflow-hidden"
              style={{ cursor: 'crosshair', lineHeight: 0 }}
              onMouseDown={startCropDrag}
              onMouseMove={updateCropDrag}
              onMouseUp={endCropDrag}
              onMouseLeave={endCropDrag}
            >
              <img
                src={cropFile.dataUrl}
                alt="crop"
                className="block max-h-[calc(100vh-180px)] max-w-full object-contain select-none"
                draggable={false}
              />
              {cropRect && cropRect.w > 0 && cropRect.h > 0 && (
                <div
                  className="absolute border-2 border-white"
                  style={{
                    left: `${cropRect.x * 100}%`,
                    top: `${cropRect.y * 100}%`,
                    width: `${cropRect.w * 100}%`,
                    height: `${cropRect.h * 100}%`,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
          {cropRect && (
            <div className="px-5 py-2 border-t border-white/10 flex-shrink-0 flex items-center gap-4">
              <span className="text-white/25 text-[10px]">
                {Math.round(cropRect.x * 100)}%, {Math.round(cropRect.y * 100)}%
                {' → '}
                {Math.round((cropRect.x + cropRect.w) * 100)}%, {Math.round((cropRect.y + cropRect.h) * 100)}%
                {' · '}
                {Math.round(cropRect.w * 100)}% × {Math.round(cropRect.h * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── SIDE-BY-SIDE COMPARE ─────────────────────────────────────────── */}
      {compareIds && (() => {
        const f1 = files.find(f => f.id === compareIds[0])
        const f2 = files.find(f => f.id === compareIds[1])
        if (!f1 || !f2) return null
        return (
          <div className="fixed inset-0 z-50 bg-black/96 flex flex-col">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 flex-shrink-0">
              <SplitSquareVertical size={14} className="text-blue-400" />
              <span className="text-white/70 text-sm font-medium">Side-by-side compare</span>
              <button onClick={() => setCompareIds(null)}
                className="ml-auto w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                <X size={14} className="text-white/60" />
              </button>
            </div>
            <div className="flex-1 flex min-h-0 gap-1">
              {[f1, f2].map((f, i) => (
                <div key={f.id} className="flex-1 flex flex-col min-w-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.025] border-b border-white/[0.06] flex-shrink-0">
                    <span className="text-white/25 text-[9px] font-semibold uppercase">{i === 0 ? 'A' : 'B'}</span>
                    <span className="text-white/50 text-xs truncate">{f.name}</span>
                    <span className="text-white/25 text-[9px] ml-auto">{f.dimensions}</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center bg-[#060606] p-6 min-h-0">
                    <img src={f.dataUrl} alt={f.name}
                      style={{ transform: `rotate(${f.rotation}deg)` }}
                      className="max-h-full max-w-full object-contain" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── DATE STAMP MODAL ─────────────────────────────────────────────── */}
      {dateStampModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDateStampModal(null)}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                <Calendar size={13} className="text-teal-400" />
              </div>
              <div className="flex-1">
                <p className="text-white/80 text-sm font-medium">Date Stamp</p>
                <p className="text-white/30 text-[10px]">{dateStampModal.ids.length} image{dateStampModal.ids.length > 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setDateStampModal(null)}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center">
                <X size={12} className="text-white/50" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                {(['datetime','date','time','custom'] as const).map(fmt => (
                  <button key={fmt} onClick={() => setDsFormat(fmt)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] border transition-all ${dsFormat === fmt ? 'bg-teal-500/15 border-teal-500/25 text-teal-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                    {fmt === 'datetime' ? 'Date + Time' : fmt === 'custom' ? 'Custom' : fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                  </button>
                ))}
              </div>
              {dsFormat === 'custom' && (
                <input type="text" value={dsCustomText} onChange={e => setDsCustomText(e.target.value)}
                  placeholder="e.g. Site visit · 2 May 2026"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-teal-500/40 placeholder-white/20" />
              )}
              <div className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-center text-teal-400/80 text-[10px] font-mono">
                {dsFormat === 'datetime' ? new Date().toLocaleString() :
                 dsFormat === 'date'     ? new Date().toLocaleDateString() :
                 dsFormat === 'time'     ? new Date().toLocaleTimeString() :
                 (dsCustomText || 'Custom text…')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-white/30 text-[9px]">Font size: {dsFontSize}px</label>
                  <input type="range" min={12} max={80} value={dsFontSize} onChange={e => setDsFontSize(Number(e.target.value))}
                    className="w-full h-1.5 accent-teal-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/30 text-[9px]">Opacity: {dsOpacity}%</label>
                  <input type="range" min={20} max={100} value={dsOpacity} onChange={e => setDsOpacity(Number(e.target.value))}
                    className="w-full h-1.5 accent-teal-400" />
                </div>
                <div className="space-y-1">
                  <label className="text-white/30 text-[9px]">Color</label>
                  <input type="color" value={dsColor} onChange={e => setDsColor(e.target.value)}
                    className="w-full h-8 rounded-lg cursor-pointer border border-white/10 p-0.5" />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input type="checkbox" checked={dsBg} onChange={e => setDsBg(e.target.checked)}
                    className="w-3.5 h-3.5 accent-teal-400" id="dsBg" />
                  <label htmlFor="dsBg" className="text-white/40 text-[10px] cursor-pointer">Dark background</label>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-white/30 text-[9px]">Position</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(['br','bl','tr','tl','center'] as const).map(pos => (
                    <button key={pos} onClick={() => setDsPosition(pos)}
                      className={`px-2 py-1 rounded-lg text-[9px] border transition-all ${dsPosition === pos ? 'bg-teal-500/15 border-teal-500/25 text-teal-400' : 'border-white/10 text-white/35 hover:text-white/60'}`}>
                      {pos === 'center' ? 'Center' : pos.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setDateStampModal(null)}
                  className="flex-1 py-2 rounded-xl border border-white/10 text-white/40 hover:text-white/60 text-xs transition-all">Cancel</button>
                <button onClick={() => { applyDateStamp(dateStampModal.ids); savePrefs({ dsFormat, dsPosition, dsColor, dsFontSize, dsOpacity, dsBg }) }}
                  className="flex-1 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-black text-xs font-semibold transition-colors">
                  Apply Stamp
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── COMPRESS MODAL ────────────────────────────────────────────────── */}
      {compressModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setCompressModal(null)}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Gauge size={13} className="text-emerald-400" />
              </div>
              <div className="flex-1">
                <p className="text-white/80 text-sm font-medium">Compress</p>
                <p className="text-white/30 text-[10px]">
                  {compressModal.ids.length} file{compressModal.ids.length > 1 ? 's' : ''} · {compressModal.type === 'pdf' ? 'PDF output' : 'JPEG output'}
                </p>
              </div>
              <button onClick={() => setCompressModal(null)}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center transition-colors">
                <X size={12} className="text-white/50" />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              {/* Mode toggle (target KB only for images) */}
              <div className="flex gap-2">
                <button onClick={() => setCompressSizeMode(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] border transition-all ${!compressSizeMode ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                  Quality %
                </button>
                {compressModal.type === 'image' && (
                  <button onClick={() => setCompressSizeMode(true)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] border transition-all ${compressSizeMode ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' : 'border-white/10 text-white/40 hover:text-white/60'}`}>
                    Target KB
                  </button>
                )}
              </div>

              {!compressSizeMode ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-white/40 text-[10px]">Quality</span>
                    <span className="text-white/70 text-[10px] font-mono">{compressQuality}%</span>
                  </div>
                  <input type="range" min={10} max={100} step={1} value={compressQuality}
                    onChange={e => setCompressQuality(Number(e.target.value))}
                    className="w-full h-1.5 accent-emerald-400" />
                  <div className="flex justify-between text-white/20 text-[9px]">
                    <span>Smallest file</span><span>Best quality</span>
                  </div>
                  <p className="text-white/25 text-[9px] pt-0.5">
                    {compressQuality >= 85 ? 'High quality · minimal size reduction' :
                     compressQuality >= 60 ? 'Good balance of quality and file size' :
                     compressQuality >= 35 ? 'Noticeable compression · much smaller file' :
                     'Aggressive compression · visible quality loss'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-white/40 text-[10px]">Target file size</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      value={compressTargetKB}
                      onChange={e => {
                        const val = e.target.value
                        setCompressTargetKB(val)
                        const kb = Number(val)
                        if (kb > 0) {
                          const origFiles = filesRef.current.filter(f => compressModal.ids.includes(f.id))
                          const avgKB = origFiles.reduce((s, f) => s + f.size, 0) / Math.max(1, origFiles.length) / 1024
                          const q = Math.max(10, Math.min(95, Math.round((kb / Math.max(avgKB, 1)) * 100)))
                          setCompressQuality(q)
                        }
                      }}
                      placeholder="e.g. 200"
                      className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 outline-none focus:border-emerald-500/40 placeholder-white/20"
                    />
                    <span className="text-white/40 text-xs flex-shrink-0">KB</span>
                  </div>
                  <p className="text-white/25 text-[9px]">
                    Estimated quality: <span className="text-emerald-400/70">{compressQuality}%</span>
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setCompressModal(null)}
                  className="flex-1 py-2 rounded-xl border border-white/10 text-white/40 hover:text-white/60 text-xs transition-all">
                  Cancel
                </button>
                <button onClick={() => {
                  if (compressModal.type === 'image') compressImages(compressModal.ids, compressQuality)
                  else downloadCompressedPdf(compressModal.ids, compressQuality)
                }}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-semibold transition-colors">
                  {compressModal.type === 'pdf' ? 'Download PDF' : 'Compress & Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── METADATA MODAL ───────────────────────────────────────────────── */}
      {metaFileId && (() => {
        const mf = files.find(f => f.id === metaFileId)
        if (!mf) return null
        return (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setMetaFileId(null)}>
            <div className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
                <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Info size={13} className="text-white/40" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-sm font-medium truncate">{mf.name}</p>
                  <p className="text-white/30 text-[10px]">File information</p>
                </div>
                <button onClick={() => setMetaFileId(null)}
                  className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/15 flex items-center justify-center transition-colors">
                  <X size={12} className="text-white/50" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-2.5 max-h-80 overflow-y-auto">
                {Object.entries(mf.metadata || {}).map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-white/30 text-[11px] w-28 flex-shrink-0 pt-px">{k}</span>
                    <span className="text-white/65 text-[11px] flex-1 break-all leading-relaxed">{v}</span>
                  </div>
                ))}
                {(!mf.metadata || Object.keys(mf.metadata).length === 0) && (
                  <p className="text-white/25 text-xs text-center py-4">No metadata available</p>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
      <div className="w-44 flex-shrink-0 flex flex-col gap-0.5 overflow-y-auto">
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
              <Layers size={13} className="text-pink-400" />
            </div>
            <span className="text-white text-xs font-semibold">zPlayer</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full">Beta</span>
            <span className="text-[9px] bg-pink-500/15 text-pink-400 px-1.5 py-0.5 rounded-full">AIO</span>
          </div>
        </div>

        {TOOLS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTool(id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs transition-all ${
              activeTool === id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
            }`}>
            <Icon size={12} /><span>{label}</span>
          </button>
        ))}

        <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-col gap-0.5">
          <div className="flex gap-1 px-3 py-1">
            <button onClick={undoHistory} title="Undo (Ctrl+Z)"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9px] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all">
              <Undo2 size={11} /> Undo
            </button>
            <button onClick={redoHistory} title="Redo (Ctrl+Y)"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[9px] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all">
              <Redo2 size={11} /> Redo
            </button>
          </div>
          <button onClick={saveState}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all">
            <Save size={12} /><span>Save local</span>
          </button>
          <button onClick={() => { setGalleryIndex(0); setGalleryOpen(true) }} disabled={files.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.04] disabled:opacity-30 transition-all">
            <LayoutGrid size={12} /><span>Gallery view</span>
          </button>
          <button onClick={() => openEditorWith('<p><br></p>', true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all">
            <Type size={12} /><span>Text editor</span>
          </button>
          <button onClick={() => setStrictMode(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all ${
              strictMode ? 'bg-violet-500/10 text-violet-400' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
            }`}>
            <Type size={12} /><span>Strict text</span>
            {strictMode && <Check size={8} className="text-violet-400 ml-auto" />}
          </button>
          <button onClick={() => setShowApiPanel(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all ${
              showApiPanel ? 'bg-white/8 text-white/70' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
            }`}>
            <Key size={12} /><span>API key</span>
            {apiKey && <Check size={8} className="text-emerald-400 ml-auto" />}
          </button>
        </div>

        {showApiPanel && (
          <div className="border border-white/10 rounded-xl p-3 bg-white/[0.02]">
            <p className="text-white/35 text-[9px] mb-2 leading-relaxed">Gemini API key for OCR</p>
            <input type="password" value={apiKey}
              onChange={e => { setApiKey(e.target.value); localStorage.setItem('zplayer_apiKey', e.target.value) }}
              placeholder="AIza…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-white/70 outline-none focus:border-pink-500/40 placeholder-white/20" />
            {apiKey && <p className="text-emerald-400/70 text-[8px] mt-1 flex items-center gap-1"><Check size={8} /> Saved</p>}
          </div>
        )}

        <div className="mt-auto border border-pink-500/15 bg-pink-500/5 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles size={10} className="text-pink-400" />
            <span className="text-pink-400 text-[10px] font-medium">AI Powered</span>
          </div>
          <p className="text-white/30 text-[9px] leading-relaxed">OCR, merge, annotate — in-browser.</p>
        </div>
      </div>

      {/* ── WORKSPACE ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

        {/* Upload zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); processFiles(Array.from(e.dataTransfer.files)) }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl transition-all cursor-pointer flex-shrink-0 mb-3 ${
            dragging ? 'border-pink-400/50 bg-pink-500/5' : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
          } ${files.length === 0 ? 'flex-1 flex items-center justify-center' : 'py-3 px-5 flex items-center gap-4'}`}>
          <input ref={inputRef} type="file" multiple accept=".pdf,image/*,.heic,.heif,.hif" className="hidden"
            onChange={e => { processFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          {files.length === 0 ? (
            <div className="text-center py-12">
              <Upload size={28} className="text-white/20 mx-auto mb-3" />
              <p className="text-white/50 text-sm font-medium">Drop files here or click to upload</p>
              <p className="text-white/25 text-xs mt-1">PDFs render as individual pages · Images · Paste text or images</p>
            </div>
          ) : (
            <>
              <Upload size={14} className="text-white/30 flex-shrink-0" />
              <span className="text-white/30 text-xs">Add more files</span>
              <span className="text-white/20 text-xs ml-auto">{files.length} item{files.length !== 1 ? 's' : ''}</span>
            </>
          )}
        </div>

        {files.length > 0 && (
          <>
            {/* Selection toolbar */}
            <div className="flex items-center gap-2 mb-2 flex-shrink-0 flex-wrap">
              <button onClick={selectAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-white/50 hover:text-white/80 text-[10px] transition-all">
                <CheckSquare size={10} /> All
              </button>
              <button onClick={deselectAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-white/50 hover:text-white/80 text-[10px] transition-all">
                <Square size={10} /> None
              </button>
              <select onChange={e => { if (e.target.value) selectByType(e.target.value); e.target.value = '' }}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-white/45 text-[10px] outline-none cursor-pointer">
                <option value="">By type…</option>
                <option value="images">Images</option>
                <option value="pdf">PDF pages</option>
              </select>
              <button onClick={() => { setGalleryIndex(0); setGalleryOpen(true) }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-white/50 hover:text-white/80 text-[10px] transition-all ml-auto">
                <LayoutGrid size={10} /> Gallery
              </button>
              {selected.size > 0 && <span className="text-white/30 text-[10px]">{selected.size} selected</span>}
            </div>

            {/* Batch bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-2 mb-3 flex-shrink-0 flex-wrap border border-white/[0.06] rounded-xl px-3 py-2 bg-white/[0.015]">
                <span className="text-white/25 text-[10px] font-medium mr-1">Batch ({selected.size}):</span>
                <button onClick={batchExtract}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400 hover:bg-pink-500/20 text-[10px] transition-all">
                  <Search size={10} /> Extract text
                </button>
                <button onClick={downloadMergedPdf}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-[10px] transition-all">
                  <FileStack size={10} /> Merge PDF
                </button>
                <button onClick={downloadZip}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 text-[10px] transition-all">
                  <Archive size={10} /> ZIP
                </button>
                <button onClick={() => downloadTextFile(selectedFiles)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/20 text-[10px] transition-all">
                  <Download size={10} /> Text
                </button>
                <button onClick={() => copyTextToClipboard(selectedFiles)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 text-[10px] transition-all">
                  <Copy size={10} /> Copy text
                </button>
                <button onClick={() => {
                  const imgFiles = selectedFiles.filter(f => f.type === 'image')
                  if (imgFiles.length === 0) { notify('Select images to crop', 'warn'); return }
                  openCrop(imgFiles[0], imgFiles.map(f => f.id))
                }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-[10px] transition-all">
                  <Crop size={10} /> Bulk Crop
                </button>
                <button onClick={() => openCompressImages(selectedFiles.map(f => f.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 text-[10px] transition-all">
                  <Gauge size={10} /> Compress
                </button>
                <button onClick={() => openCompressPdf(selectedFiles.map(f => f.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 text-[10px] transition-all">
                  <FileDown size={10} /> PDF (compressed)
                </button>
                <button onClick={() => openResize(selectedFiles.map(f => f.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500/20 text-[10px] transition-all">
                  <Move size={10} /> Resize
                </button>
                <button onClick={() => openConvert(selectedFiles.map(f => f.id))}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 text-[10px] transition-all">
                  <RefreshCw size={10} /> Convert
                </button>
                <button onClick={() => { if (!selectedFiles.length) { notify('Select files', 'warn'); return }; setWmText('CONFIDENTIAL'); setWatermarkModal({ ids: selectedFiles.map(f => f.id) }) }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 text-[10px] transition-all">
                  <Stamp size={10} /> Watermark
                </button>
                <button onClick={() => { if (!selectedFiles.length) { notify('Select files', 'warn'); return }; setDateStampModal({ ids: selectedFiles.map(f => f.id) }) }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20 text-[10px] transition-all">
                  <Calendar size={10} /> Date Stamp
                </button>
                <button onClick={openCompare}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 text-[10px] transition-all">
                  <SplitSquareVertical size={10} /> Compare
                </button>
              </div>
            )}

            {/* ── FILE GRID ─────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
                {files.map(f => (
                  <div key={f.id}
                    draggable
                    onDragStart={e => onDragStart(e, f.id)}
                    onDragOver={e => onDragOverCard(e, f.id)}
                    onDrop={() => onDropCard(f.id)}
                    onDragEnd={() => { setDragId(null); setDragOver(null) }}
                    onClick={() => setFocusedCardId(id => id === f.id ? null : f.id)}
                    className={`border rounded-2xl overflow-hidden flex flex-col bg-[#0d0d0d] transition-all cursor-pointer ${
                      dragOver === f.id && dragId !== f.id ? 'border-pink-400/60 ring-2 ring-pink-400/30 scale-[1.02]' :
                      focusedCardId === f.id ? 'border-sky-400/50 ring-2 ring-sky-400/20 shadow-[0_0_0_1px_rgba(56,189,248,0.08)]' :
                      selected.has(f.id) ? 'border-pink-500/40 ring-1 ring-pink-500/20 shadow-[0_0_0_1px_rgba(236,72,153,0.1)]'
                        : 'border-white/[0.08] hover:border-white/20'
                    } ${dragId === f.id ? 'opacity-40' : ''}`}>

                    {/* ── TOP: Filename (editable) ───────────────────── */}
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.015]">
                      <GripVertical size={10} className="text-white/15 flex-shrink-0 cursor-grab active:cursor-grabbing" />
                      <input
                        type="checkbox"
                        checked={selected.has(f.id)}
                        onChange={() => toggleSelect(f.id)}
                        className="w-3.5 h-3.5 rounded cursor-pointer accent-pink-500 flex-shrink-0"
                      />
                      {editingId === f.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 bg-white/[0.06] border border-pink-500/40 rounded-md px-2 py-0.5 text-[11px] text-white outline-none"
                        />
                      ) : (
                        <span
                          onClick={() => startEditing(f)}
                          title="Click to rename"
                          className="flex-1 text-white/70 text-[11px] truncate cursor-text hover:text-white transition-colors select-none group/name flex items-center gap-1"
                        >
                          {f.name}
                          <Pencil size={9} className="text-white/20 opacity-0 group-hover/name:opacity-100 flex-shrink-0 transition-opacity" />
                        </span>
                      )}
                      <button onClick={() => removeFile(f.id)}
                        className="w-5 h-5 rounded-md flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0">
                        <X size={11} />
                      </button>
                    </div>

                    {/* ── MIDDLE: Image + rotate overlay ────────────── */}
                    <div className="relative bg-[#080808] flex-1 min-h-52 flex items-center justify-center overflow-hidden group/img">
                      <img
                        src={showOriginal.has(f.id) ? f.originalDataUrl : f.dataUrl}
                        alt={f.name}
                        style={{ transform: `rotate(${f.rotation}deg)`, transition: 'transform 0.3s ease' }}
                        className="max-h-52 max-w-full object-contain p-3"
                        draggable={false}
                      />
                      {f.dataUrl !== f.originalDataUrl && (
                        <button onClick={() => toggleOriginal(f.id)}
                          title={showOriginal.has(f.id) ? 'Show edited' : 'Show original'}
                          className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 border border-white/15 rounded-md px-1.5 py-0.5 text-[8px] text-white/50 hover:text-white/80 transition-all opacity-0 group-hover/img:opacity-100">
                          <SplitSquareVertical size={9} /> {showOriginal.has(f.id) ? 'Edited' : 'Original'}
                        </button>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/40 transition-all duration-200 flex items-center justify-center">
                        <button onClick={() => setZoomFile(f)}
                          className="opacity-0 group-hover/img:opacity-100 transition-all duration-200 w-10 h-10 bg-white/15 hover:bg-white/30 backdrop-blur-sm rounded-xl flex items-center justify-center">
                          <Maximize2 size={16} className="text-white" />
                        </button>
                      </div>

                      {/* Rotate button (always visible, top-right) */}
                      <button onClick={() => rotateFile(f.id)} title="Rotate 90°"
                        className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-amber-500/70 rounded-lg flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-all">
                        <RotateCw size={12} className="text-white" />
                      </button>

                      {/* Extracted text indicator */}
                      {extractedTexts[f.id] && (
                        <div className="absolute top-2 left-2 bg-emerald-500/20 border border-emerald-500/30 rounded-md px-1.5 py-0.5">
                          <span className="text-emerald-400 text-[8px] font-semibold">TEXT ✓</span>
                        </div>
                      )}
                    </div>

                    {/* ── BOTTOM BAR 1: Metadata ─────────────────────── */}
                    <div className="border-t border-white/[0.05] bg-white/[0.01]">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="text-[9px] bg-white/8 text-white/40 px-1.5 py-0.5 rounded font-mono">{f.fileTypeInfo}</span>
                        <span className="text-white/25 text-[9px]">{(f.size / 1024).toFixed(1)} KB</span>
                        {f.dimensions && <span className="text-white/20 text-[9px]">{f.dimensions}</span>}
                        {f.pageNum && <span className="text-white/18 text-[9px]">p.{f.pageNum}</span>}
                        <div className="ml-auto flex items-center gap-0.5">
                          <button onClick={() => duplicateFile(f.id)} title="Duplicate"
                            className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/5 transition-all">
                            <Copy size={10} />
                          </button>
                          <button onClick={() => setMetaFileId(f.id)} title="File info"
                            className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 transition-all">
                            <MoreHorizontal size={10} />
                          </button>
                        </div>
                      </div>
                      {(!!f.lastModified || !!f.software) && (
                        <div className="flex items-center gap-2 px-3 pb-1.5 -mt-0.5">
                          {!!f.lastModified && <span className="text-white/20 text-[8px]">{formatDate(f.lastModified)}</span>}
                          {f.software && <span className="text-white/20 text-[8px] truncate" title={f.software}>via {fmtSoftware(f.software)}</span>}
                        </div>
                      )}
                    </div>

                    {/* ── BOTTOM BAR 2: Action buttons ───────────────── */}
                    <div className="flex items-center gap-1 px-2.5 py-2 border-t border-white/[0.04]">
                      <ActionBtn onClick={() => downloadImage(f)} title="Download as image" color="teal">
                        <Download size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => downloadAsPdf(f)} title="Download as PDF" color="red">
                        <FileDown size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => setZoomFile(f)} title="Full screen" color="blue">
                        <Maximize2 size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => openGallery(f)} title="Gallery view" color="violet">
                        <LayoutGrid size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => extractText(f)} title="Extract text (AI)" color="pink">
                        <Search size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => openAnnotate(f)} title="Annotate" color="amber">
                        <Pencil size={11} />
                      </ActionBtn>
                      {f.type === 'image' && (
                        <ActionBtn onClick={() => openCrop(f, [f.id])} title="Crop image" color="emerald">
                          <Crop size={11} />
                        </ActionBtn>
                      )}
                      <ActionBtn onClick={() => {
                        if (f.type === 'image') openCompressImages([f.id])
                        else openCompressPdf([f.id])
                      }} title="Compress" color="orange">
                        <Gauge size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => openResize([f.id])} title="Resize" color="sky">
                        <Move size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => openConvert([f.id])} title="Convert format" color="indigo">
                        <RefreshCw size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => { setWmText('CONFIDENTIAL'); setWatermarkModal({ ids: [f.id] }) }} title="Watermark" color="rose">
                        <Stamp size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={() => { setSignTab('draw'); setSignModal({ id: f.id }) }} title="E-Signature" color="fuchsia">
                        <PenLine size={11} />
                      </ActionBtn>
                      <ActionBtn onClick={e => { e.stopPropagation(); setDateStampModal({ ids: [f.id] }) }} title="Date Stamp" color="yellow">
                        <Calendar size={11} />
                      </ActionBtn>
                    </div>

                    {/* Keyboard hint (shown when card is focused) */}
                    {focusedCardId === f.id && (
                      <div className="px-3 pb-2 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        <span className="text-[7px] text-sky-400/70 font-mono bg-sky-500/10 border border-sky-500/20 px-1 py-0.5 rounded">D</span>
                        <span className="text-[7px] text-white/20">·</span>
                        <span className="text-[7px] text-sky-400/70 font-mono bg-sky-500/10 border border-sky-500/20 px-1 py-0.5 rounded">R</span>
                        <span className="text-[7px] text-white/20">·</span>
                        <span className="text-[7px] text-sky-400/70 font-mono bg-sky-500/10 border border-sky-500/20 px-1 py-0.5 rounded">C</span>
                        <span className="text-[7px] text-white/20">·</span>
                        <span className="text-[7px] text-sky-400/70 font-mono bg-sky-500/10 border border-sky-500/20 px-1 py-0.5 rounded">Del</span>
                        <span className="text-[7px] text-white/20 ml-1">shortcuts active</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Tool panel */}
            {activeTool !== 'files' && (
              <div className="border border-white/10 rounded-2xl p-4 mt-3 bg-white/[0.02] flex-shrink-0">
                {activeTool === 'merge' && (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-white text-xs font-medium mb-0.5">Merge to PDF</p>
                      <p className="text-white/35 text-[10px]">Select files above then merge into a single PDF.</p>
                    </div>
                    <button onClick={downloadMergedPdf}
                      className="bg-pink-500 hover:bg-pink-400 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors flex-shrink-0">
                      Merge {selected.size > 0 ? selected.size : files.length} files → PDF
                    </button>
                  </div>
                )}
                {activeTool === 'split' && (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex-1">
                      <p className="text-white text-xs font-medium mb-1">Split PDF — extract page range</p>
                      <p className="text-white/35 text-[10px] mb-3">{pdfPages.length} PDF page{pdfPages.length !== 1 ? 's' : ''} loaded · pages {1}–{maxPage || '?'}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-white/40 text-[10px]">From page</span>
                        <input type="number" min={1} max={maxPage || 999} value={splitFrom}
                          onChange={e => setSplitFrom(Number(e.target.value))}
                          className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/70 outline-none focus:border-pink-500/40" />
                        <span className="text-white/40 text-[10px]">to</span>
                        <input type="number" min={1} max={maxPage || 999} value={splitTo}
                          onChange={e => setSplitTo(Number(e.target.value))}
                          className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/70 outline-none focus:border-pink-500/40" />
                      </div>
                    </div>
                    <button onClick={() => downloadSplitPdf(splitFrom, splitTo)} disabled={!pdfPages.length}
                      className="bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors flex-shrink-0">
                      <Scissors size={12} className="inline mr-1.5" />Extract pages {splitFrom}–{splitTo}
                    </button>
                  </div>
                )}
                {activeTool === 'extract' && (
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-white text-xs font-medium mb-0.5">AI Text Extraction (OCR)</p>
                      <p className="text-white/35 text-[10px]">Uses Gemini Vision to extract text from images and PDF pages.</p>
                      {!apiKey && <p className="text-amber-400/80 text-[9px] mt-1">← Add Gemini API key in sidebar first</p>}
                    </div>
                    <button onClick={batchExtract} disabled={!apiKey}
                      className="bg-pink-500 hover:bg-pink-400 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors flex-shrink-0">
                      Extract from {selected.size > 0 ? selected.size : files.length} files
                    </button>
                  </div>
                )}
                {activeTool === 'convert' && (
                  <div>
                    <p className="text-white text-xs font-medium mb-3">Convert selected files</p>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: 'Merged PDF',       fn: downloadMergedPdf },
                        { label: 'Individual PDFs',  fn: async () => { for (const f of selectedFiles) await downloadAsPdf(f) } },
                        { label: 'ZIP archive',      fn: downloadZip },
                      ].map(({ label, fn }) => (
                        <button key={label} onClick={fn}
                          className="border border-white/15 text-white/50 hover:text-white/80 hover:bg-white/5 text-[10px] px-3 py-1.5 rounded-xl transition-all">
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Extracted text */}
            {filesWithText.length > 0 && (
              <div className="border border-white/10 rounded-2xl p-4 mt-3 bg-white/[0.02] flex-shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white text-xs font-medium">Extracted Text ({filesWithText.length} files)</p>
                  <div className="flex gap-3">
                    <button onClick={() => downloadTextFile(filesWithText)}
                      className="text-white/35 hover:text-white/70 text-[10px] flex items-center gap-1 transition-colors">
                      <Download size={9} /> Download
                    </button>
                    <button onClick={() => copyTextToClipboard(filesWithText)}
                      className="text-white/35 hover:text-white/70 text-[10px] flex items-center gap-1 transition-colors">
                      <Copy size={9} /> Copy all
                    </button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {filesWithText.map(f => (
                    <div key={f.id} className="border-b border-white/[0.05] pb-2 last:border-0">
                      <p className="text-white/40 text-[9px] font-semibold mb-0.5">{f.name}</p>
                      <p className="text-white/30 text-[9px] leading-relaxed whitespace-pre-wrap">{extractedTexts[f.id]}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TEXT EDITOR (inline or fullscreen) ──────────────────────────── */}
        {textEditorOpen && (
          <div className={textEditorFullscreen
            ? 'fixed inset-0 z-50 bg-[#111] flex flex-col'
            : 'absolute inset-0 z-10 flex flex-col bg-[#0c0c0c] border border-white/[0.08] rounded-2xl overflow-hidden'
          }>
            {/* Title bar */}
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/10 flex-shrink-0">
              <Type size={13} className="text-violet-400 flex-shrink-0" />
              <input value={textTitle} onChange={e => setTextTitle(e.target.value)}
                className="flex-1 bg-transparent text-white/80 text-sm outline-none border-b border-transparent focus:border-white/20 py-0.5 max-w-xs"
                placeholder="Document title…" />
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                <span className="text-white/20 text-[9px] font-mono px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.06]">
                  {editorPageCount} {editorPageCount === 1 ? 'page' : 'pages'}
                </span>
                <button onClick={downloadTextAsPdf}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-[10px] transition-all">
                  <FileDown size={10} /> PDF
                </button>
                <button onClick={downloadTextAsWord}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 text-[10px] transition-all">
                  <FileText size={10} /> Word
                </button>
                <button onClick={downloadTextAsImages}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 text-[10px] transition-all">
                  <Download size={10} /> Images
                </button>
                <button onClick={() => setTextEditorFullscreen(v => !v)}
                  title={textEditorFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
                  <Maximize2 size={13} className="text-white/50" />
                </button>
                <button onClick={() => { setTextEditorOpen(false); setTextEditorFullscreen(false) }}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center transition-colors">
                  <X size={14} className="text-white/60" />
                </button>
              </div>
            </div>
            {/* Formatting toolbar */}
            <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-white/[0.06] flex-shrink-0 flex-wrap bg-white/[0.01]">
              <button onClick={() => execCmd('bold')}          title="Bold"          className="w-7 h-7 rounded hover:bg-white/10 text-white/55 hover:text-white font-bold text-xs transition-all">B</button>
              <button onClick={() => execCmd('italic')}        title="Italic"        className="w-7 h-7 rounded hover:bg-white/10 text-white/55 hover:text-white italic text-xs transition-all">I</button>
              <button onClick={() => execCmd('underline')}     title="Underline"     className="w-7 h-7 rounded hover:bg-white/10 text-white/55 hover:text-white underline text-xs transition-all">U</button>
              <button onClick={() => execCmd('strikeThrough')} title="Strikethrough" className="w-7 h-7 rounded hover:bg-white/10 text-white/55 hover:text-white line-through text-xs transition-all">S</button>
              <div className="w-px h-5 bg-white/10 mx-1" />
              <button onClick={() => execCmd('justifyLeft')}   title="Align left"   className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white text-xs transition-all">≡L</button>
              <button onClick={() => execCmd('justifyCenter')} title="Align center" className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white text-xs transition-all">≡C</button>
              <button onClick={() => execCmd('justifyRight')}  title="Align right"  className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white text-xs transition-all">≡R</button>
              <div className="w-px h-5 bg-white/10 mx-1" />
              <button onClick={() => execCmd('insertUnorderedList')} title="Bullet list"   className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white flex items-center justify-center transition-all"><List size={12} /></button>
              <button onClick={() => execCmd('insertOrderedList')}   title="Numbered list" className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white flex items-center justify-center transition-all"><ListOrdered size={12} /></button>
              <div className="w-px h-5 bg-white/10 mx-1" />
              <select onChange={e => { execCmd('fontSize', e.target.value); (e.target as HTMLSelectElement).value = '3' }} defaultValue="3"
                className="h-7 rounded bg-white/5 border border-white/10 text-white/50 text-[10px] px-1.5 outline-none cursor-pointer">
                <option value="1">10pt</option><option value="2">12pt</option><option value="3">14pt</option>
                <option value="4">18pt</option><option value="5">24pt</option><option value="6">32pt</option>
              </select>
              <input type="color" defaultValue="#000000" onChange={e => execCmd('foreColor', e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-white/10 p-0.5" title="Text color" />
              <div className="w-px h-5 bg-white/10 mx-1" />
              <button onClick={() => execCmd('removeFormat')} title="Clear formatting"
                className="w-7 h-7 rounded hover:bg-white/10 text-white/45 hover:text-white flex items-center justify-center transition-all">
                <Eraser size={11} />
              </button>
              <div className="w-px h-5 bg-white/10 mx-1" />
              <button onClick={() => setStrictMode(v => !v)}
                title="Strict text mode — paste as plain text, collapse spaces"
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-all ${
                  strictMode ? 'bg-violet-500/20 border-violet-500/30 text-violet-300' : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                }`}>
                <Type size={9} /> {strictMode ? 'Strict ON' : 'Strict'}
              </button>
            </div>
            {/* A4 page editor */}
            {/* A4 page editor — visual page breaks every 297mm */}
            <div className="flex-1 overflow-y-auto bg-[#d8d4cf] py-8 flex justify-center">
              <div style={{ width: 'min(210mm, calc(100vw - 2rem))' }}>
                <div ref={editorRef} contentEditable suppressContentEditableWarning onPaste={handleEditorPaste}
                  className="text-gray-900 text-[12pt] leading-relaxed outline-none"
                  style={{
                    width: '100%',
                    minHeight: '297mm',
                    padding: '20mm',
                    backgroundColor: '#fff',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.18)',
                    backgroundImage: [
                      'linear-gradient(to bottom,',
                      '  transparent calc(297mm - 2px),',
                      '  #bbb calc(297mm - 2px),',
                      '  #bbb 297mm,',
                      '  #d8d4cf 297mm,',
                      '  #d8d4cf calc(297mm + 20px),',
                      '  #fff calc(297mm + 20px)',
                      ')',
                    ].join(' '),
                    backgroundSize: '100% calc(297mm + 20px)',
                    backgroundRepeat: 'repeat-y',
                    backgroundOrigin: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

// ── Reusable action button ─────────────────────────────────────────────────────
const COLOR_VARIANTS: Record<string, string> = {
  teal:    'hover:bg-teal-500/20    hover:text-teal-400    hover:border-teal-500/30',
  red:     'hover:bg-red-500/20     hover:text-red-400     hover:border-red-500/30',
  blue:    'hover:bg-blue-500/20    hover:text-blue-400    hover:border-blue-500/30',
  violet:  'hover:bg-violet-500/20  hover:text-violet-400  hover:border-violet-500/30',
  pink:    'hover:bg-pink-500/20    hover:text-pink-400    hover:border-pink-500/30',
  amber:   'hover:bg-amber-500/20   hover:text-amber-400   hover:border-amber-500/30',
  emerald: 'hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30',
  orange:  'hover:bg-orange-500/20  hover:text-orange-400  hover:border-orange-500/30',
  sky:     'hover:bg-sky-500/20     hover:text-sky-400     hover:border-sky-500/30',
  indigo:  'hover:bg-indigo-500/20  hover:text-indigo-400  hover:border-indigo-500/30',
  rose:    'hover:bg-rose-500/20    hover:text-rose-400    hover:border-rose-500/30',
  fuchsia: 'hover:bg-fuchsia-500/20 hover:text-fuchsia-400 hover:border-fuchsia-500/30',
}

function ActionBtn({ onClick, title, color, children }: {
  onClick: React.MouseEventHandler<HTMLButtonElement>; title: string; color: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 h-7 flex items-center justify-center rounded-lg border border-white/[0.06] text-white/30 transition-all ${COLOR_VARIANTS[color] ?? ''}`}
    >
      {children}
    </button>
  )
}
