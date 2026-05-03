import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'zPlayer — AIO File Editor',
  description: 'All-in-one workspace for PDFs and images. Annotate, crop, watermark, OCR, merge, convert — all in your browser.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#080808] text-white">
        {children}
      </body>
    </html>
  )
}
