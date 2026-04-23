export type ParsedResumeResponse = {
  data: {
    fileName: string
    rawText: string
    cleanedText: string
    pageCount: number
    characterCount: number
  }
}

export type ApiErrorResponse = {
  error: {
    code: string
    message: string
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api'

export const parseResumePdf = async (file: File): Promise<ParsedResumeResponse> => {
  const formData = new FormData()
  formData.append('resume', file)

  const response = await fetch(`${API_BASE_URL}/scans/parse-resume`, {
    method: 'POST',
    body: formData,
  })

  const json = (await response.json()) as ParsedResumeResponse | ApiErrorResponse

  if (!response.ok) {
    const message = 'error' in json ? json.error.message : 'Resume upload failed.'
    throw new Error(message)
  }

  return json as ParsedResumeResponse
}
