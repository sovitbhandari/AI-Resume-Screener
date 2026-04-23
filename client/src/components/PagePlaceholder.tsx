type PagePlaceholderProps = {
  title: string
  description: string
}

export function PagePlaceholder({ title, description }: PagePlaceholderProps) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p>{description}</p>
      <p className="muted">Sprint 1 placeholder UI. Functional flows arrive in later sprints.</p>
    </section>
  )
}
