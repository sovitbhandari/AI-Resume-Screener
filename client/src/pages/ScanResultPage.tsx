import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { InsightList } from '../components/results/InsightList'
import { ScoreCard } from '../components/results/ScoreCard'
import { SectionAnalysisTable } from '../components/results/SectionAnalysisTable'
import type { ParsedResumeResponse, ResumeAnalysisResult } from '../services/scanService'

type ResultState = {
  parsedResume: ParsedResumeResponse['data']
  analysis: ResumeAnalysisResult
  targetRoleName?: string
  jobDescriptionText: string
}

export function ScanResultPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(null)

  const resultState = useMemo(() => {
    const incoming = location.state as ResultState | null
    if (incoming?.analysis) {
      return incoming
    }

    const cached = sessionStorage.getItem('latestResumeAnalysis')
    if (!cached) {
      return null
    }

    try {
      return JSON.parse(cached) as ResultState
    } catch {
      return null
    }
  }, [location.state])

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

  if (!resultState) {
    return (
      <section className="card">
        <h2>Scan Result</h2>
        <p className="empty-text">No analysis found yet. Upload a resume and run analysis first.</p>
        <button type="button" onClick={() => navigate('/dashboard')}>
          Go to Dashboard
        </button>
      </section>
    )
  }

  const { analysis, parsedResume, targetRoleName } = resultState

  return (
    <section className="results-layout">
      <header className="results-header card">
        <h2>Resume Analysis Dashboard</h2>
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
        {notice ? <p className="success-text">{notice}</p> : null}
      </header>

      <div className="score-grid">
        <ScoreCard title="Overall Match Score" score={analysis.overallScore} subtitle="Overall resume-to-role fit" />
        <ScoreCard title="Keyword Match Score" score={analysis.keywordMatchScore} subtitle="Alignment with role keywords" />
      </div>

      <div className="result-grid">
        <InsightList
          title="Missing Keywords"
          items={analysis.missingKeywords}
          emptyText="No missing keywords were identified."
          onCopy={copyItems}
        />
        <InsightList
          title="Missing Skills"
          items={analysis.missingSkills}
          emptyText="No missing skills were identified."
          onCopy={copyItems}
        />
        <InsightList
          title="ATS Formatting Feedback"
          items={analysis.atsFormattingFeedback}
          emptyText="No ATS formatting issues were detected."
          onCopy={copyItems}
        />
        <InsightList title="Strengths" items={analysis.strengths} emptyText="No strengths were returned." onCopy={copyItems} />
        <InsightList
          title="Weaknesses"
          items={analysis.weaknesses}
          emptyText="No weaknesses were returned."
          onCopy={copyItems}
        />
        <InsightList
          title="Recommended Fixes"
          items={analysis.suggestedImprovements}
          emptyText="No recommendations were returned."
          onCopy={copyItems}
        />
      </div>

      <SectionAnalysisTable sections={analysis.sectionAnalysis} />
    </section>
  )
}
