type InsightListProps = {
  title: string
  items: string[]
  emptyText: string
  onCopy: (title: string, items: string[]) => void
}

export function InsightList({ title, items, emptyText, onCopy }: InsightListProps) {
  return (
    <section className="result-card">
      <div className="result-card-header">
        <h3>{title}</h3>
        <button type="button" className="ghost-button" onClick={() => onCopy(title, items)} disabled={items.length === 0}>
          Copy
        </button>
      </div>
      {items.length === 0 ? (
        <p className="empty-text">{emptyText}</p>
      ) : (
        <ul className="bullet-list">
          {items.map((item) => (
            <li key={`${title}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
