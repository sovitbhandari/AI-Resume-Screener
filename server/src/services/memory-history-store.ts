import type { HistoryListItem, HistoryPage, HistoryScanDetail, HistoryStore } from './history-store.js'

type MemoryRecord = HistoryScanDetail & {
  userId: string
}

const toListItem = (record: MemoryRecord): HistoryListItem => ({
  id: record.id,
  resume_file_name: record.resume_file_name,
  overall_score: record.overall_score,
  keyword_match_score: record.keyword_match_score,
  created_at: record.created_at,
})

const toDetail = (record: MemoryRecord): HistoryScanDetail => ({
  ...toListItem(record),
  resume_text: record.resume_text,
  job_description: record.job_description,
  result_json: record.result_json,
})

export const createMemoryHistoryStore = (seed: MemoryRecord[] = []): HistoryStore => {
  const records = seed.map((record) => ({ ...record }))

  return {
    async list(userId, page: HistoryPage) {
      const sorted = records
        .filter((record) => record.userId === userId)
        .sort((a, b) => {
          const byDate = b.created_at.localeCompare(a.created_at)
          return byDate === 0 ? b.id.localeCompare(a.id) : byDate
        })
      const afterCursor = page.cursor
        ? sorted.filter(
            (record) =>
              record.created_at < page.cursor!.createdAt ||
              (record.created_at === page.cursor!.createdAt && record.id < page.cursor!.id),
          )
        : sorted
      return afterCursor
        .slice(0, page.limit + 1)
        .map(toListItem)
    },
    async getById(userId, scanId) {
      const record = records.find((item) => item.userId === userId && item.id === scanId)
      return record ? toDetail(record) : null
    },
    async deleteById(userId, scanId) {
      const index = records.findIndex((item) => item.userId === userId && item.id === scanId)
      if (index === -1) {
        return false
      }
      records.splice(index, 1)
      return true
    },
  }
}
