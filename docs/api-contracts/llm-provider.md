# Provider adapter

Checked against the OpenAI Chat Completions reference and the Gemini `generateContent` reference on 2026-10-02. This adapter does not call a live model in tests. A fake provider's timings are scripted and are not a latency measurement.

## Request format

OpenAI stays on `POST /v1/chat/completions`. The default model `gpt-4o-mini` is in the documented structured-output set, so the request uses `response_format.type = json_schema` with `strict: true`. There is no silent fallback to `json_object` or to another model.

Gemini stays on `POST /v1beta/models/{model}:generateContent` with the key in `x-goog-api-key`. `generationConfig.responseSchema` is documented as deprecated, so the request uses `generationConfig.responseFormat.text` with `mimeType: application/json` and the same JSON schema. `max_completion_tokens` and `maxOutputTokens` carry the configured output-token cap.

Server-side Zod validation still runs. A schema-valid object is not a claim that the scores or feedback are factually correct. Extra object keys are stripped. Prose around JSON, a second JSON value, and trailing non-whitespace text are rejected. One markdown fence that contains the whole reply is accepted.

## Deadline and attempts

`LLM_DEADLINE_MS` is the total budget for transport attempts, backoff, and the one output repair. `LLM_TIMEOUT_MS` is accepted as that same budget. It is not a per-attempt timeout.

`LLM_MAX_ATTEMPTS` is the maximum number of provider calls inside one `generate` invocation. `LLM_MAX_RETRIES` is accepted as that same ceiling. The old name counted attempts, not extra retries after the first call.

Auth, configuration, and invalid-request responses are not retried. Rate limits, HTTP 408/409/425/5xx, network failures, and timeouts are retried only while an attempt remains and the wait fits both the deadline and a 10 second cap. A `Retry-After` delay in seconds overrides the jittered backoff. Jitter is half to all of the backoff, from an injected random source in tests.

A timeout, network error, or 5xx sets provider uncertainty and duplicate-spend risk, including when no later attempt is sent. Those outcomes keep the scan reservation. Explicit 400/401/429 responses, refusals, truncated output, schema failures, and model mismatches release the reservation. A release does not refund provider spend.

Returned model ids must equal the requested id or be a snapshot suffix of it (`gpt-4o-mini-2024-07-18` matches `gpt-4o-mini`). Any other returned id is a mismatch and is not retried or replaced.

## Output repair

Invalid JSON, an empty body, an oversized body, or a schema failure may be sent once more. That repair is not a transport retry: it is one extra `generate` call, it uses the same provider and model, and it stops after that call. Refusal and truncation are not repaired. The saved run records `repairAttempts` and `initialFailure`.

## Usage and cost

Token counts are stored only when the provider's documented fields are non-negative integers. Malformed usage does not become a number and does not fail a valid analysis. `costEstimate` is null. This repository does not contain a dated price table, so it does not estimate cost.

Saved analyses include `providerRun` with the provider, requested model, returned model version, request id, finish state, attempt counts, prompt version, and schema version. Ordinary logs record the category, attempt count, HTTP status, and request id. They do not record upstream bodies, prompts, or refusal text.
