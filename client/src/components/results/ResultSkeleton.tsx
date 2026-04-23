export function ResultSkeleton() {
  return (
    <div className="result-skeleton" aria-hidden="true">
      <div className="skeleton-row">
        <div className="skeleton-box tall" />
        <div className="skeleton-box tall" />
      </div>
      <div className="skeleton-box medium" />
      <div className="skeleton-box medium" />
      <div className="skeleton-box medium" />
    </div>
  )
}
