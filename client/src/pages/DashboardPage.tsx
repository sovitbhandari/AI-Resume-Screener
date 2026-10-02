import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResultSkeleton } from '../components/results/ResultSkeleton'
import { ApiClientError, analyzeResume, parseResumePdf } from '../services/scanService'
import { getAuthToken, setLatestScanId } from '../services/authStorage'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

type ParsedResult = {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

type RunStatus = 'idle' | 'uploading' | 'parsing' | 'submitted' | 'analyzing' | 'completed' | 'failed' | 'cancelled'

const statusText: Record<RunStatus, string> = {
  idle: 'Ready',
  uploading: 'Uploading resume',
  parsing: 'Extracting resume text',
  submitted: 'Submitted for analysis',
  analyzing: 'Analyzing evidence',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function DashboardPage() {
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [usageMessage, setUsageMessage] = useState<string | null>(null)
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const isLoading = ['uploading', 'parsing', 'submitted', 'analyzing'].includes(runStatus)

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
    setSuccessMessage(null)
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
    setSuccessMessage(null)
    setUsageMessage(null)

    if (!getAuthToken()) {
      setValidationError('Please log in first to run and save scans.')
      navigate('/login')
      return
    }

    if (!selectedFile) {
      setValidationError('Select a valid PDF resume before submitting.')
      return
    }

    if (!jobDescription.trim()) {
      setValidationError('Paste a job description before analyzing.')
      return
    }

    runIdRef.current += 1
    const runId = runIdRef.current
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController
    setRunStatus('uploading')
    setValidationError(null)
    try {
      const parseResponse = await parseResumePdf(selectedFile, { signal: abortController.signal })
      if (runId !== runIdRef.current) {
        return
      }
      setRunStatus('parsing')
      setParsedResult(parseResponse.data)

      setRunStatus('submitted')
      setRunStatus('analyzing')
      const analysisResponse = await analyzeResume({
        cleanedResumeText: parseResponse.data.cleanedText,
        jobDescriptionText: jobDescription,
        targetRoleName: targetRole.trim() || undefined,
        resumeFileName: parseResponse.data.fileName,
        idempotencyKey: crypto.randomUUID(),
      }, { signal: abortController.signal })
      if (runId !== runIdRef.current) {
        return
      }

      setRunStatus('completed')
      setUsageMessage(`Monthly scans: ${analysisResponse.meta.scansUsed}/${analysisResponse.meta.scansLimit} used.`)
      setSuccessMessage('Analysis complete. Redirecting to results...')

      if (analysisResponse.meta.scanId) {
        setLatestScanId(analysisResponse.meta.scanId)
        navigate(`/result/${analysisResponse.meta.scanId}`)
        return
      }
      navigate('/result', {
        state: {
          parsedResume: parseResponse.data,
          analysis: analysisResponse.data,
          targetRoleName: targetRole.trim() || undefined,
          jobDescriptionText: jobDescription,
        },
      })
    } catch (error) {
      if (runId !== runIdRef.current) {
        return
      }
      if (error instanceof ApiClientError && error.code === 'REQUEST_CANCELLED') {
        setRunStatus('cancelled')
        setServerError('Cancelled in this browser. If the analysis had already reached the provider, server work may still finish under the same idempotency key.')
      } else {
        setRunStatus('failed')
        const message = error instanceof Error ? error.message : 'Unexpected upload error.'
        const code = error instanceof ApiClientError ? error.code : ''
        if (code === 'QUOTA_EXCEEDED') {
          setServerError(`Quota exceeded: ${message}`)
        } else if (code === 'OPERATION_IN_PROGRESS' || code === 'PROVIDER_OUTCOME_UNKNOWN') {
          setServerError(`${message} Retry later; the server will not duplicate provider work for the same idempotency key.`)
        } else if (code === 'LLM_REFUSAL') {
          setServerError(`Provider refusal: ${message}`)
        } else {
          setServerError(message)
        }
      }
    } finally {
      if (runId === runIdRef.current) {
        abortRef.current = null
      }
    }
  }

  const onCancel = () => {
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setRunStatus('cancelled')
    setServerError('Cancelled in this browser. Cancellation may not stop provider work once the analysis request has been accepted by the server.')
  }

  return (
    <section className="card">
      <h2>Dashboard</h2>
      <p>Upload a PDF resume, paste a job description, and get a structured AI fit report.</p>

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
        <label htmlFor="target-role" className="upload-label">
          Target Role (optional)
        </label>
        <input
          id="target-role"
          name="target-role"
          type="text"
          placeholder="Backend Software Engineer"
          value={targetRole}
          onChange={(event) => setTargetRole(event.target.value)}
        />

        <label htmlFor="job-description" className="upload-label">
          Job Description
        </label>
        <textarea
          id="job-description"
          name="job-description"
          placeholder="Paste the full job description here..."
          value={jobDescription}
          onChange={(event) => setJobDescription(event.target.value)}
          rows={8}
        />

        {fileDetails ? <p className="file-meta">Selected: {fileDetails}</p> : null}
        <div aria-live="polite">
          {usageMessage ? <p className="muted">{usageMessage}</p> : null}
          {validationError ? <p className="error-text">{validationError}</p> : null}
          {serverError ? <p className="error-text">{serverError}</p> : null}
          {successMessage ? <p className="success-text">{successMessage}</p> : null}
        </div>

        <button type="submit" disabled={isLoading || !selectedFile}>
          {isLoading ? statusText[runStatus] : 'Analyze Resume'}
        </button>
        {isLoading ? (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </form>

      {isLoading ? (
        <>
          <p className="progress-steps" role="status" aria-live="polite">
            {runStatus === 'analyzing' || runStatus === 'submitted'
              ? 'Analyzing with an indeterminate synchronous request. No partial JSON is trusted before completion.'
              : statusText[runStatus]}
          </p>
          <ResultSkeleton />
        </>
      ) : null}

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
