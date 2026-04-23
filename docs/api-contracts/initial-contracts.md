# Initial API Contracts (Sprint 1)

Shared contract definitions live in `shared/types/contracts.ts`.

## Request Contract

- `ResumeScanRequest`
  - `jobDescription: string`
  - `resumeText: string`
  - `resumeFileName?: string`

## Response Contracts

- `ApiSuccessResponse<T>`
- `ApiErrorResponse`
- `ResumeScanResult`
  - `overallScore`
  - `keywordMatchScore`
  - `atsFormattingFeedback`
  - `missingSkills`
  - `suggestedImprovements`
  - `sectionAnalysis`
  - optional `rewrittenBullets`
