# Sprint 2 Notes

## Goal
Enable resume PDF upload and reliable text extraction for downstream analysis.

## Delivered

- Dashboard upload flow with:
  - PDF-only client validation
  - 5MB size validation
  - loading and error states
  - successful parse preview
- Multipart backend upload endpoint:
  - `POST /api/scans/parse-resume`
  - memory-buffer file handling with `multer`
  - strict file-type and file-size constraints
- PDF parsing service using `pdf-parse`
- Text cleaning utility to normalize whitespace and line breaks
- Structured parse response with:
  - `fileName`
  - `rawText`
  - `cleanedText`
  - `pageCount`
  - `characterCount`
- Error handling for:
  - missing file
  - unsupported file type
  - oversized file
  - empty/unreadable PDF
  - parse failures

## Validation Notes

- Non-PDF upload returns `UNSUPPORTED_FILE_TYPE`.
- Valid sample PDF upload returns parsed raw and cleaned text payload.

## Next Sprint
Sprint 3 should integrate LLM analysis on top of cleaned resume text and job description input.
