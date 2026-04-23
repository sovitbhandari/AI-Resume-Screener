# Sprint 3 Notes

## Goal
Convert cleaned resume text and job description text into stable, structured AI analysis.

## Delivered

- Analysis endpoint:
  - `POST /api/scans/analyze`
  - input: `cleanedResumeText`, `jobDescriptionText`, optional `targetRoleName`
- Prompt template in dedicated prompts folder:
  - `server/src/prompts/resume-analysis.prompt.ts`
- LLM provider service with:
  - secure env key usage
  - timeout handling
  - retry behavior
- Response normalization and validation:
  - JSON extraction and parse safeguards
  - schema validation with `zod`
  - normalized stable output for frontend consumption
- Structured error handling for:
  - invalid input
  - provider configuration issues
  - timeouts
  - malformed model responses
  - upstream LLM failures

## Next Sprint
Sprint 4 should render analysis output in the results dashboard and improve UX polish.
