import mammoth from 'mammoth'
import * as XLSX from 'xlsx'

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024 // 50 Megabytes
export const MAX_DOCUMENT_SIZE_MB = 50

export interface ExtractedDocumentResult {
  text: string
  fileName: string
  fileType: string
  fileSizeBytes: number
  charCount: number
}

/**
 * Extracts raw textual content from any supported document format up to 50MB.
 * Supports: PDF, DOCX, DOC, XLSX, XLS, CSV, TXT, MD, JSON, HTML.
 */
export async function extractTextFromDocument(
  fileBuffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ExtractedDocumentResult> {
  const lowerName = fileName.toLowerCase()
  const lowerMime = (mimeType || '').toLowerCase()
  let text = ''

  if (fileBuffer.length > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error(
      `File size (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB) exceeds the maximum allowed limit of ${MAX_DOCUMENT_SIZE_MB} MB.`
    )
  }

  // 1. PDF
  if (lowerName.endsWith('.pdf') || lowerMime === 'application/pdf') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfModule = require('pdf-parse')
      if (typeof pdfModule === 'function') {
        const parsed = await pdfModule(fileBuffer)
        text = parsed?.text || ''
      } else if (pdfModule?.PDFParse) {
        const parser = new pdfModule.PDFParse({ data: fileBuffer })
        const parsed = await parser.getText()
        try {
          await parser.destroy()
        } catch {
          // ignore cleanup errors
        }
        text = parsed?.text || ''
      } else {
        throw new Error('PDF parser engine could not be initialized.')
      }
    } catch (err: any) {
      console.error('[DocumentParser] Error parsing PDF:', err)
      throw new Error(`Failed to read PDF document: ${err.message || 'Corrupt or protected PDF'}`)
    }
  }

  // 2. Word documents (.docx)
  else if (
    lowerName.endsWith('.docx') ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: fileBuffer })
      text = value || ''
    } catch (err: any) {
      console.error('[DocumentParser] Error parsing DOCX:', err)
      throw new Error(`Failed to extract text from Word document: ${err.message || 'Corrupt DOCX file'}`)
    }
  }

  // 3. Spreadsheets (.xlsx, .xls, .csv)
  else if (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.csv') ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime === 'text/csv'
  ) {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
      const sheetTexts: string[] = []

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        if (!sheet) continue
        const csvContent = XLSX.utils.sheet_to_csv(sheet)
        if (csvContent.trim()) {
          sheetTexts.push(`### Sheet: ${sheetName}\n${csvContent}`)
        }
      }

      text = sheetTexts.join('\n\n')
    } catch (err: any) {
      console.error('[DocumentParser] Error parsing spreadsheet:', err)
      throw new Error(`Failed to parse spreadsheet: ${err.message || 'Corrupt spreadsheet'}`)
    }
  }

  // 4. Plain text, Markdown, JSON, HTML, etc.
  else {
    try {
      text = fileBuffer.toString('utf-8')
    } catch (err: any) {
      console.error('[DocumentParser] Error reading text buffer:', err)
      throw new Error(`Could not decode text document: ${err.message || 'Unknown format'}`)
    }
  }

  const cleanText = text.replace(/\r\n/g, '\n').trim()

  if (!cleanText || cleanText.length < 15) {
    throw new Error(
      'The uploaded document contains insufficient or unreadable text. Please ensure the document is not an empty or scanned image-only PDF.'
    )
  }

  return {
    text: cleanText,
    fileName,
    fileType: lowerName.split('.').pop() || 'unknown',
    fileSizeBytes: fileBuffer.length,
    charCount: cleanText.length,
  }
}
