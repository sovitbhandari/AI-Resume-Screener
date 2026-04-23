# Initial API Contracts (Sprint 1-3)

Shared contract definitions live in `shared/types/contracts.ts`.

## Request Contract

- `ResumeScanRequest`
  - `jobDescription: string`
  - `resumeText: string`
  - `resumeFileName?: string`
- `ResumeAnalysisRequest`
  - `cleanedResumeText: string`
  - `jobDescriptionText: string`
  - `targetRoleName?: string`

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
  - `missingKeywords`
  - `missingSkills`
  - `strengths`
  - `weaknesses`
  - `suggestedImprovements`
  - `sectionAnalysis`
  - optional `rewrittenBullets`

## Parsing Endpoint

- `POST /api/scans/parse-resume`
  - `multipart/form-data`
  - file field: `resume`

## Analysis Endpoint

- `POST /api/scans/analyze`
  - `application/json`
  - body fields:
    - `cleanedResumeText`
    - `jobDescriptionText`
    - optional `targetRoleName`
