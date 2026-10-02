import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiClientError, deleteHistoryScan, fetchHistory, type ScanHistoryItem } from '../services/scanService'
import { clearCachedScanId, getAuthToken, setLatestScanId } from '../services/authStorage'

export function HistoryPage() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<ScanHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
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
        setNextCursor(response.meta.nextCursor)
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : 'Unable to load history.'
        setError(message)
      } finally {
        setIsLoading(false)
      }
    }

    void run()
  }, [navigate])

  const loadMore = async () => {
    if (!nextCursor) {
      return
    }
    setIsLoadingMore(true)
    setError(null)
    try {
      const response = await fetchHistory({ cursor: nextCursor })
      setHistory((prev) => [...prev, ...response.data])
      setNextCursor(response.meta.nextCursor)
    } catch (loadError) {
      const message = loadError instanceof ApiClientError && loadError.code === 'INVALID_CURSOR'
        ? 'History cursor expired or was invalid. Refresh history and try again.'
        : loadError instanceof Error ? loadError.message : 'Unable to load more history.'
      setError(message)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const openScan = (scanId: string) => {
    setLatestScanId(scanId)
    navigate(`/result/${scanId}`)
  }

  const onDeleteScan = async (scanId: string) => {
    const confirmed = window.confirm('Delete this scan from your history? This cannot be undone.')
    if (!confirmed) {
      return
    }

    try {
      await deleteHistoryScan(scanId)
      clearCachedScanId(scanId)
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
                <th>Weighted evidence</th>
                <th>Direct evidence</th>
                <th>Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((scan) => (
                <tr key={scan.id}>
                  <td>{scan.resumeFileName}</td>
                  <td>{scan.weightedEvidencePercent ?? '-'}</td>
                  <td>{scan.directEvidencePercent ?? '-'}</td>
                  <td>{new Date(scan.createdAt).toLocaleString()}</td>
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
          {nextCursor ? (
            <button type="button" className="ghost-button" onClick={loadMore} disabled={isLoadingMore}>
              {isLoadingMore ? 'Loading...' : 'Load more'}
            </button>
          ) : null}
        </div>
      )}
    </section>
  )
}
