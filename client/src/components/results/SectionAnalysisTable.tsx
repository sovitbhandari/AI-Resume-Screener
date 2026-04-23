import type { SectionScore } from '../../services/scanService'

type SectionAnalysisTableProps = {
  sections: SectionScore[]
}

export function SectionAnalysisTable({ sections }: SectionAnalysisTableProps) {
  return (
    <section className="result-card">
      <h3>Section Analysis</h3>
      {sections.length === 0 ? (
        <p className="empty-text">No section-level analysis was returned.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Score</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.name}>
                  <td>{section.name}</td>
                  <td>{section.score}</td>
                  <td>{section.feedback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
