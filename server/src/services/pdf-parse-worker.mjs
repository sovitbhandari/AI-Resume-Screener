import { parentPort, workerData } from 'node:worker_threads'
import { PDFParse } from 'pdf-parse'
import { classifyParserError } from './pdf-classify.mjs'

const run = async () => {
  const parser = new PDFParse({ data: workerData.fileBuffer })
  try {
    const parsed = await parser.getText()
    await parser.destroy()
    parentPort.postMessage({
      ok: true,
      destroyed: true,
      text: parsed.text ?? '',
      total: parsed.total ?? 0,
    })
  } catch (error) {
    let destroyed = true
    try {
      await parser.destroy()
    } catch {
      destroyed = false
    }
    const message = error instanceof Error ? error.message : ''
    parentPort.postMessage({
      ok: false,
      destroyed,
      reason: classifyParserError(message),
    })
  }
}

await run()
