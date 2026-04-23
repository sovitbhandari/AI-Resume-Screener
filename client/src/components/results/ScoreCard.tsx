type ScoreCardProps = {
  title: string
  score: number
  subtitle: string
}

export function ScoreCard({ title, score, subtitle }: ScoreCardProps) {
  const normalized = Math.max(0, Math.min(100, score))

  return (
    <article className="score-card">
      <p className="score-title">{title}</p>
      <p className="score-value">{normalized}</p>
      <p className="score-subtitle">{subtitle}</p>
      <div className="score-track" aria-hidden="true">
        <div className="score-fill" style={{ width: `${normalized}%` }} />
      </div>
    </article>
  )
}
