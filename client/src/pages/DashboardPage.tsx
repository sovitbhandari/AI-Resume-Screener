import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResultSkeleton } from '../components/results/ResultSkeleton'
import { analyzeResume, parseResumePdf, type ResumeAnalysisResult } from '../services/scanService'
import { getAuthToken } from '../services/authStorage'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

type ParsedResult = {
  fileName: string
  rawText: string
  cleanedText: string
  pageCount: number
  characterCount: number
}

const analysisSteps = [
  'Parsing resume',
  'Comparing with job description',
  'Identifying missing skills',
  'Building final analysis',
]

export function DashboardPage() {
  const navigate = useNavigate()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [jobDescription, setJobDescription] = useState('')
  const [targetRole, setTargetRole] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
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

    setIsLoading(true)
    setActiveStep(0)
    setValidationError(null)
    try {
      setActiveStep(0)
      const parseResponse = await parseResumePdf(selectedFile)
      setParsedResult(parseResponse.data)

      setActiveStep(1)
      const analysisResponse = await analyzeResume({
        cleanedResumeText: parseResponse.data.cleanedText,
        jobDescriptionText: jobDescription,
        targetRoleName: targetRole.trim() || undefined,
        resumeFileName: parseResponse.data.fileName,
      })

      setActiveStep(2)
      setActiveStep(3)
      setSuccessMessage('Analysis complete. Redirecting to results...')

      const payload = {
        parsedResume: parseResponse.data,
        analysis: analysisResponse.data as ResumeAnalysisResult,
        targetRoleName: targetRole.trim() || undefined,
        jobDescriptionText: jobDescription,
      }

      sessionStorage.setItem('latestResumeAnalysis', JSON.stringify(payload))
      navigate('/result', { state: payload })
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
        {validationError ? <p className="error-text">{validationError}</p> : null}
        {serverError ? <p className="error-text">{serverError}</p> : null}
        {successMessage ? <p className="success-text">{successMessage}</p> : null}

        <button type="submit" disabled={isLoading || !selectedFile}>
          {isLoading ? 'Analyzing Resume...' : 'Analyze Resume'}
        </button>
      </form>

      {isLoading ? (
        <>
          <ol className="progress-steps">
            {analysisSteps.map((step, index) => (
              <li key={step} className={index <= activeStep ? 'active' : ''}>
                {step}
              </li>
            ))}
          </ol>
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
