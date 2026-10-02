# 90-120 Second Demo Script

Target duration: 100 seconds.

1. Correct evidence-linked result, 25 seconds
   - Upload a synthetic PDF and paste a synthetic JD.
   - Show the evidence report, schema/prompt version, extraction warnings and observable evidence coverage.
   - Expand a requirement and point to the JD quote and resume quote.
   - Say: “Not evidenced means not present in extracted text, not that the person lacks the skill.”

2. Duplicate request convergence, 15 seconds
   - Submit the same idempotency key twice in a local/API test scenario.
   - Show one completed operation or one in-progress response, not two provider calls.

3. Quota contention, 15 seconds
   - Run or show the PG-backed test for one remaining slot with concurrent requests.
   - Show admitted/denied counts and reconciled `scans_used`/`scans_reserved`.

4. Provider failure, 15 seconds
   - Use an unconfigured/fake failing provider path.
   - Show a structured error with correlation ID and no resume/JD content in logs.

5. Deletion, 15 seconds
   - Delete a history result.
   - Show authorized history no longer lists it and latest cached result ID is cleared.
   - Say: “Local DB row deletion does not guarantee provider or backup deletion.”

6. Limits and intentional non-overengineering, 15 seconds
   - State: no streaming/SSE yet, no paid model call in readiness, no cloud deployment in this change, no live quality or speed claims without the planned experiment harness.
