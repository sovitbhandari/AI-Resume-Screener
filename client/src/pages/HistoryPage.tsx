import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteHistoryScan, fetchHistory, fetchHistoryScan, type ScanHistoryItem } from '../services/scanService'
import { getAuthToken } from '../services/authStorage'

export function HistoryPage() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<ScanHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!getAuthToken()) {
      navigate('/login')
      return
    }

    const run = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetchHistory()
        setHistory(response.data)
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Unable to load history.'
        setError(message)
      } finally {
        setIsLoading(false)
      }
    }

    void run()
  }, [navigate])

  const openScan = async (scanId: string) => {
    try {
      const response = await fetchHistoryScan(scanId)
      const payload = {
        parsedResume: {
          fileName: response.data.resume_file_name,
          rawText: response.data.resume_text,
          cleanedText: response.data.resume_text,
          pageCount: 0,
          characterCount: response.data.resume_text.length,
        },
        analysis: response.data.result_json,
        jobDescriptionText: response.data.job_description,
      }
      sessionStorage.setItem('latestResumeAnalysis', JSON.stringify(payload))
      navigate('/result', { state: payload })
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : 'Unable to open scan.'
      setError(message)
    }
  }

  const onDeleteScan = async (scanId: string) => {
    const confirmed = window.confirm('Delete this scan from your history? This cannot be undone.')
    if (!confirmed) {
      return
    }

    try {
      await deleteHistoryScan(scanId)
      setHistory((prev) => prev.filter((scan) => scan.id !== scanId))
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Unable to delete scan.'
      setError(message)
    }
  }

  if (isLoading) {
    return (
      <section className="card">
        <h2>History</h2>
        <p className="muted">Loading your previous scans...</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>History</h2>
      <p>Review and reopen your previous resume analyses.</p>

      {error ? <p className="error-text">{error}</p> : null}

      {history.length === 0 ? (
        <p className="empty-text">No scans found yet. Run your first analysis from Dashboard.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resume</th>
                <th>Overall</th>
                <th>Keyword</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((scan) => (
                <tr key={scan.id}>
                  <td>{scan.resume_file_name}</td>
                  <td>{scan.overall_score ?? '-'}</td>
                  <td>{scan.keyword_match_score ?? '-'}</td>
                  <td>{new Date(scan.created_at).toLocaleString()}</td>
                  <td>
                    <div className="history-actions">
                      <button type="button" className="ghost-button" onClick={() => openScan(scan.id)}>
                        Open
                      </button>
                      <button type="button" className="ghost-button danger-button" onClick={() => onDeleteScan(scan.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
