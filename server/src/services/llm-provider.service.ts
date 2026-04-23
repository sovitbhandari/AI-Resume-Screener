import { env } from '../config/env.js'

type GenerateTextParams = {
  systemPrompt: string
  userPrompt: string
}

const sleep = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const generateWithOpenAI = async ({ systemPrompt, userPrompt }: GenerateTextParams): Promise<string> => {
  if (!env.llmApiKey) {
    throw new Error('LLM_API_KEY is missing. Set it in server/.env.')
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), env.llmTimeoutMs)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.llmApiKey}`,
      },
      body: JSON.stringify({
        model: env.llmModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI request failed (${response.status}): ${errorText}`)
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) {
      throw new Error('OpenAI returned an empty response.')
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('LLM request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}

const generateWithGemini = async ({ systemPrompt, userPrompt }: GenerateTextParams): Promise<string> => {
  if (!env.llmApiKey) {
    throw new Error('LLM_API_KEY is missing. Set it in server/.env.')
  }

  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), env.llmTimeoutMs)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.llmModel}:generateContent?key=${env.llmApiKey}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
          systemInstruction: {
            role: 'system',
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini request failed (${response.status}): ${errorText}`)
    }

    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    if (!text) {
      throw new Error('Gemini returned an empty response.')
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('LLM request timed out.')
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}

export const generateAnalysisText = async (params: GenerateTextParams): Promise<string> => {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= env.llmMaxRetries; attempt += 1) {
    try {
      if (env.llmProvider === 'openai') {
        return await generateWithOpenAI(params)
      }

      if (env.llmProvider === 'gemini') {
        return await generateWithGemini(params)
      }

      throw new Error(`Unsupported LLM_PROVIDER "${env.llmProvider}". Supported providers: openai, gemini.`)
    } catch (error) {
      lastError = error
      if (attempt < env.llmMaxRetries) {
        await sleep(300 * attempt)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('LLM request failed after retries.')
}
