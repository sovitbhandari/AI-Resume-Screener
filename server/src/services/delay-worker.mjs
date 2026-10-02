import { parentPort } from 'node:worker_threads'

setTimeout(() => {
  parentPort.postMessage({
    ok: true,
    destroyed: true,
    text: 'Synthetic resume fixture',
    total: 1,
  })
}, 250)
