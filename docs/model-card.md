# Model Card

Purpose: produce source-supported resume/JD evidence reports for a user-uploaded resume and job description.

Current schema:
- `resume-analysis-2`
- Prompt version: `resume-analysis-evidence-2026-10-02`

Inputs sent to a configured provider:
- Extracted resume text.
- Job description text.
- Optional target role.
- Server-generated source segment IDs and original/normalized text for evidence linking.

Outputs:
- Requirement records with `required`, `preferred`, or `unclear` priority.
- JD citation and resume citations using allowed source IDs and exact quotes.
- Evidence status: `supported`, `partial`, or `not_evidenced`.
- Rationale and suggested action.
- Extraction/readability warnings.
- Observable evidence coverage denominator and rubric.

Important limitations:
- `not_evidenced` means the supplied extracted text does not evidence the requirement. It does not mean the person lacks the skill.
- The report is not an ATS prediction, hiring probability, employer score, fairness claim, or validated accuracy percentage.
- Visual PDF layout is not inspected by this pipeline.
- Partial JSON or streaming tokens are not trusted as final results.
- Provider refusal/errors must be retained in evaluation reports and not hidden.

Evaluation status:
- Offline contract tests pass with a fake provider and synthetic fixture.
- Frozen synthetic evaluation manifest exists at `docs/evaluation/source-evidence-eval.md`.
- Live model evaluation has not been run in this change. It requires approved budget, actual provider/model/version capture, repeated runs, grounding metrics, token usage, observed request latency, and synthetic/consented data only.
- Final holdout must not be used for prompt/schema tuning.

Default provider configuration:
- Local/test CI uses no production provider key.
- Supported live adapters: OpenAI and Gemini via environment configuration.
- Readiness does not call a paid model.
