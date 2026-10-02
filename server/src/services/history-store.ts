export type HistoryListItem = {
  id: string
  resume_file_name: string
  overall_score: number | null
  keyword_match_score: number | null
  created_at: string
}

export type HistoryScanDetail = HistoryListItem & {
  resume_text: string
  job_description: string
  result_json: unknown
}

export type HistoryPage = {
  limit: number
  cursor?: {
    createdAt: string
    id: string
  }
}

export interface HistoryStore {
  list(userId: string, page: HistoryPage): Promise<HistoryListItem[]>
  getById(userId: string, scanId: string): Promise<HistoryScanDetail | null>
  deleteById(userId: string, scanId: string): Promise<boolean>
}
