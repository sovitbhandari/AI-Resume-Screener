# Initial API Contracts (Sprint 1-2)

Shared contract definitions live in `shared/types/contracts.ts`.

## Request Contract

- `ResumeScanRequest`
  - `jobDescription: string`
  - `resumeText: string`
  - `resumeFileName?: string`

## Response Contracts

- `ApiSuccessResponse<T>`
- `ApiErrorResponse`
- `ParseResumeResponse`
  - `data.fileName`
  - `data.rawText`
  - `data.cleanedText`
  - `data.pageCount`
  - `data.characterCount`
- `ResumeScanResult`
  - `overallScore`
  - `keywordMatchScore`
  - `atsFormattingFeedback`
  - `missingSkills`
  - `suggestedImprovements`
  - `sectionAnalysis`
  - optional `rewrittenBullets`

## Parsing Endpoint

- `POST /api/scans/parse-resume`
  - `multipart/form-data`
  - file field: `resume`
