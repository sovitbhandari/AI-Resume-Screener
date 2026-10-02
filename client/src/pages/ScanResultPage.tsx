import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { InsightList } from '../components/results/InsightList'
import { SectionAnalysisTable } from '../components/results/SectionAnalysisTable'
import { getLatestScanId } from '../services/authStorage'
import { ApiClientError, fetchHistoryScan, type Citation, type EvidenceResumeAnalysisResult, type ParsedResumePayload, type ResumeAnalysisResult } from '../services/scanService'

type ResultState = {
  parsedResume: ParsedResumePayload
  analysis: ResumeAnalysisResult
  targetRoleName?: string
  jobDescriptionText: string
}

const isEvidenceReport = (analysis: ResumeAnalysisResult): analysis is EvidenceResumeAnalysisResult =>
  'schemaVersion' in analysis && analysis.schemaVersion === 'resume-analysis-2'

const statusLabel: Record<EvidenceResumeAnalysisResult['requirements'][number]['evidenceStatus'], string> = {
  supported: 'Supported',
  partial: 'Partial',
  not_evidenced: 'Not evidenced',
}

const sourceText = (analysis: EvidenceResumeAnalysisResult, citation: Citation) => {
  const source = [...analysis.sourceMap.resumeSegments, ...analysis.sourceMap.jdRequirements].find((item) => item.id === citation.sourceId)
  return source?.originalText ?? ''
}

export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const [notice, setNotice] = useState<string | null>(null)
  const [flaggedFeedback, setFlaggedFeedback] = useState<Record<string, string>>({})
  const [correctedSources, setCorrectedSources] = useState<Record<string, string>>({})
  const [resultState, setResultState] = useState<ResultState | null>(() => {
    const incoming = location.state as ResultState | null
    return incoming?.analysis ? incoming : null
  })
  const initialScanId = params.scanId ?? getLatestScanId()
  const [isLoading, setIsLoading] = useState(() => !((location.state as ResultState | null)?.analysis) && Boolean(initialScanId))
  const [loadError, setLoadError] = useState<string | null>(null)

  const scanId = params.scanId ?? (!resultState ? getLatestScanId() : null)

  useEffect(() => {
    if (resultState || !scanId) {
      return
    }
    const abortController = new AbortController()
    const load = async () => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const response = await fetchHistoryScan(scanId, { signal: abortController.signal })
        setResultState({
          parsedResume: {
            fileName: response.data.resumeFileName,
            rawText: response.data.resumeText,
            cleanedText: response.data.resumeText,
            pageCount: 0,
            characterCount: response.data.resumeText.length,
          },
          analysis: response.data.result,
          jobDescriptionText: response.data.jobDescription,
        })
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'REQUEST_CANCELLED') {
          return
        }
        setLoadError(error instanceof Error ? error.message : 'Unable to load result.')
      } finally {
        setIsLoading(false)
      }
    }
    void load()
    return () => abortController.abort()
  }, [resultState, scanId])

  const copyItems = async (title: string, items: string[]) => {
    if (items.length === 0) {
      return
    }

    try {
      await navigator.clipboard.writeText(`${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`)
      setNotice(`${title} copied to clipboard.`)
    } catch {
      setNotice('Unable to copy. Please try again.')
    }
  }

  const exportReport = async () => {
    if (!resultState) {
      return
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(resultState.analysis, null, 2))
      setNotice('Report JSON copied for export.')
    } catch {
      setNotice('Unable to export report. Please try again.')
    }
  }

  if (isLoading) {
    return (
      <section className="card" aria-busy="true">
        <h2>Evidence Report</h2>
        <p className="muted" role="status">
          Loading authorized result...
        </p>
      </section>
    )
  }

  if (!resultState) {
    return (
      <section className="card">
        <h2>Scan Result</h2>
        <p className="empty-text">{loadError ?? 'No analysis found yet. Upload a resume and run analysis first.'}</p>
        <button type="button" onClick={() => navigate('/dashboard')}>
          Go to Dashboard
        </button>
      </section>
    )
  }

  const { analysis, parsedResume, targetRoleName } = resultState
  const evidenceReport = isEvidenceReport(analysis) ? analysis : null
  const legacyReport = isEvidenceReport(analysis) ? null : analysis

  const flagFeedback = (requirementId: string) => {
    setFlaggedFeedback((prev) => ({ ...prev, [requirementId]: 'Flagged for review' }))
    setNotice('Feedback flagged locally for review.')
  }

  const updateCorrectedSource = (sourceId: string, value: string) => {
    setCorrectedSources((prev) => ({ ...prev, [sourceId]: value }))
  }

  return (
    <section className="results-layout">
      <header className="results-header card">
        <h2>Evidence Report</h2>
        <p>
          File: <strong>{parsedResume.fileName}</strong> | Pages: <strong>{parsedResume.pageCount}</strong> | Characters:{' '}
          <strong>{parsedResume.characterCount}</strong>
        </p>
        {targetRoleName ? (
          <p>
            Target role: <strong>{targetRoleName}</strong>
          </p>
        ) : (
          <p className="muted">Target role not provided.</p>
        )}
        <button type="button" className="ghost-button" onClick={exportReport}>
          Copy report JSON
        </button>
        {notice ? <p className="success-text" aria-live="polite">{notice}</p> : null}
      </header>

      {evidenceReport ? (
        <>
          <section className="result-card evidence-summary">
            <div>
              <p className="score-title">Observable Evidence Coverage</p>
              <p className="score-value">{evidenceReport.summary.weightedEvidencePercent}%</p>
              <p className="muted">Schema {evidenceReport.schemaVersion}; prompt {evidenceReport.promptVersion}</p>
              <p className="score-subtitle">{evidenceReport.summary.rubric}</p>
            </div>
            <div className="summary-facts">
              <span>{evidenceReport.summary.evidencedRequirements} supported</span>
              <span>{evidenceReport.summary.partiallyEvidencedRequirements} partial</span>
              <span>{evidenceReport.summary.notEvidencedRequirements} not evidenced</span>
              <span>{evidenceReport.summary.explicitlyIdentifiedRequirements} total requirements</span>
            </div>
          </section>

          <section className="result-card">
            <h3>Extraction Notes</h3>
            <ul className="bullet-list">
              {evidenceReport.extractionWarnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
              <li>
                Text inspected: {evidenceReport.readabilityFacts.resumeCharacterCount} resume characters and{' '}
                {evidenceReport.readabilityFacts.jobDescriptionCharacterCount} job-description characters.
              </li>
            </ul>
          </section>

          <section className="result-card">
            <h3>Requirement Evidence</h3>
            <div className="requirement-list">
              {evidenceReport.requirements.map((requirement) => (
                <article className="requirement-row" key={requirement.requirementId}>
                  <div className="requirement-topline">
                    <span className={`status-pill ${requirement.evidenceStatus}`}>{statusLabel[requirement.evidenceStatus]}</span>
                    <span className="priority-pill">{requirement.priority}</span>
                    <code>{requirement.requirementId}</code>
                  </div>
                  <h4>{requirement.text}</h4>
                  <p>{requirement.rationale}</p>
                  <p className="muted">{requirement.suggestedAction}</p>
                  <details>
                    <summary>Inspect source evidence</summary>
                    <div className="citation-block">
                      <strong>JD citation</strong>
                      <blockquote>{requirement.jdCitation.quote}</blockquote>
                      <small>{requirement.jdCitation.sourceId}</small>
                    </div>
                    {requirement.resumeCitations.length === 0 ? (
                      <p className="empty-text">No resume citation resolved for this requirement.</p>
                    ) : (
                      requirement.resumeCitations.map((citation) => (
                        <div className="citation-block" key={`${requirement.requirementId}-${citation.sourceId}-${citation.quote}`}>
                          <strong>Resume citation</strong>
                          <blockquote>{citation.quote}</blockquote>
                          <small>{citation.sourceId}</small>
                          <textarea
                            aria-label={`Correct extracted text for ${citation.sourceId}`}
                            value={correctedSources[citation.sourceId] ?? sourceText(evidenceReport, citation)}
                            onChange={(event) => updateCorrectedSource(citation.sourceId, event.target.value)}
                          />
                        </div>
                      ))
                    )}
                  </details>
                  <button type="button" className="ghost-button" onClick={() => flagFeedback(requirement.requirementId)}>
                    {flaggedFeedback[requirement.requirementId] ? 'Flagged' : 'Flag inaccurate feedback'}
                  </button>
                </article>
              ))}
            </div>
          </section>

          {evidenceReport.unsupportedCitations.length > 0 ? (
            <section className="result-card">
              <h3>Unsupported Citations Flagged</h3>
              <ul className="bullet-list">
                {evidenceReport.unsupportedCitations.map((item, index) => (
                  <li key={`${item.sourceId ?? item.requirementId ?? 'citation'}-${index}`}>{item.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="result-grid">
            <InsightList
              title="Strengths"
              items={evidenceReport.modelFeedback.strengths}
              emptyText="No model-generated strengths were returned."
              onCopy={copyItems}
            />
            <InsightList
              title="Concerns"
              items={evidenceReport.modelFeedback.concerns}
              emptyText="No model-generated concerns were returned."
              onCopy={copyItems}
            />
            <InsightList
              title="Suggested Improvements"
              items={evidenceReport.modelFeedback.suggestedImprovements}
              emptyText="No suggestions were returned."
              onCopy={copyItems}
            />
            <InsightList
              title="Source-backed Rewritten Bullets"
              items={evidenceReport.modelFeedback.rewrittenBullets}
              emptyText="No rewritten bullets were returned."
              onCopy={copyItems}
            />
          </div>
        </>
      ) : legacyReport ? (
        <>
          <section className="result-card">
            <h3>Legacy Report</h3>
            <p className="muted">This historical report does not include source-supported citations or schema version metadata.</p>
          </section>
          <div className="result-grid">
            <InsightList title="Strengths" items={legacyReport.strengths} emptyText="No strengths were returned." onCopy={copyItems} />
            <InsightList title="Weaknesses" items={legacyReport.weaknesses} emptyText="No weaknesses were returned." onCopy={copyItems} />
            <InsightList
              title="Recommended Fixes"
              items={legacyReport.suggestedImprovements}
              emptyText="No recommendations were returned."
              onCopy={copyItems}
            />
          </div>
          <SectionAnalysisTable sections={legacyReport.sectionAnalysis} />
        </>
      ) : (
        <section className="result-card">
          <h3>Unavailable Report</h3>
          <p className="empty-text">This report could not be displayed.</p>
        </section>
      )}
    </section>
  )
}
