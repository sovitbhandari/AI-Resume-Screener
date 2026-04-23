import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { parseResumePdf } from '../services/scanService'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

type ParsedResult = {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

export function DashboardPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null)

  const fileDetails = useMemo(() => {
    if (!selectedFile) {
      return null
    }

    return `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
  }, [selectedFile])

  const validatePdfFile = (file: File) => {
    const isPdfType = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdfType) {
      return 'Only PDF files are allowed.'
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return 'File exceeds 5MB limit. Please upload a smaller PDF.'
    }

    return null
  }

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setServerError(null)
    setParsedResult(null)

    if (!file) {
      setSelectedFile(null)
      setValidationError(null)
      return
    }

    const error = validatePdfFile(file)
    if (error) {
      setSelectedFile(null)
      setValidationError(error)
      return
    }

    setValidationError(null)
    setSelectedFile(file)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setServerError(null)

    if (!selectedFile) {
      setValidationError('Select a valid PDF resume before submitting.')
      return
    }

    setIsLoading(true)
    try {
      const response = await parseResumePdf(selectedFile)
      setParsedResult(response.data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected upload error.'
      setServerError(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="card">
      <h2>Dashboard</h2>
      <p>Upload a PDF resume to extract raw and cleaned text for downstream analysis.</p>

      <form className="upload-form" onSubmit={onSubmit}>
        <label htmlFor="resume-upload" className="upload-label">
          Resume PDF
        </label>
        <input
          id="resume-upload"
          name="resume-upload"
          type="file"
          accept=".pdf,application/pdf"
          onChange={onFileChange}
        />
        <p className="muted">Accepted format: PDF only. Maximum size: 5MB.</p>

        {fileDetails ? <p className="file-meta">Selected: {fileDetails}</p> : null}
        {validationError ? <p className="error-text">{validationError}</p> : null}
        {serverError ? <p className="error-text">{serverError}</p> : null}

        <button type="submit" disabled={isLoading || !selectedFile}>
          {isLoading ? 'Parsing Resume...' : 'Upload and Parse Resume'}
        </button>
      </form>

      {parsedResult ? (
        <div className="parsed-result">
          <h3>Parsing Successful</h3>
          <p>
            <strong>File:</strong> {parsedResult.fileName}
          </p>
          <p>
            <strong>Pages:</strong> {parsedResult.pageCount}
          </p>
          <p>
            <strong>Cleaned Character Count:</strong> {parsedResult.characterCount}
          </p>

          <h4>Cleaned Text Preview</h4>
          <pre>{parsedResult.cleanedText.slice(0, 2000) || 'No cleaned text preview available.'}</pre>
        </div>
      ) : null}
    </section>
  )
}
