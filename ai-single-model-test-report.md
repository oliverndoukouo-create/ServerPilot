# ServerPilot Single-Model AI Test

Status: **complete**
Model: `google/gemma-4-26b-a4b-it:free` (Google: Gemma 4 26B A4B  (free))

## Summary

- Successful responses: 0/5
- HTTP 429 responses: 10
- Timeouts: 0
- Validation failures: 0
- Retries used: 5
- Total generation requests: 10/10
- Raw AI average score: N/A/10

| Dimension | Average |
|---|---:|
| intentUnderstanding | N/A/10 |
| instructionFollowing | N/A/10 |
| exclusionHandling | N/A/10 |
| hallucinationControl | N/A/10 |
| proportionality | N/A/10 |
| taskCompletion | N/A/10 |
| naturalness | N/A/10 |
| structuredOutput | N/A/10 |

## Per-prompt review

### Prompt 1: Small Minecraft

**Outcome:** rate_limited; JSON not returned; production schema not-run.
- Both the original request and one retry returned HTTP 429; the model returned no proposal, so understanding, correctness, proportionality, and hallucinations cannot be assessed.
- FALLBACK result recorded separately; not scored as AI.

### Prompt 2: Large professional Minecraft

**Outcome:** rate_limited; JSON not returned; production schema not-run.
- Both the original request and one retry returned HTTP 429; the model returned no proposal, so understanding, correctness, proportionality, and hallucinations cannot be assessed.
- FALLBACK result recorded separately; not scored as AI.

### Prompt 3: Explicit exclusions

**Outcome:** rate_limited; JSON not returned; production schema not-run.
- Both the original request and one retry returned HTTP 429; the model returned no proposal, so understanding, correctness, proportionality, and hallucinations cannot be assessed.
- FALLBACK result recorded separately; not scored as AI.

### Prompt 4: Messy natural language

**Outcome:** rate_limited; JSON not returned; production schema not-run.
- Both the original request and one retry returned HTTP 429; the model returned no proposal, so understanding, correctness, proportionality, and hallucinations cannot be assessed.
- FALLBACK result recorded separately; not scored as AI.

### Prompt 5: Events but not tournaments

**Outcome:** rate_limited; JSON not returned; production schema not-run.
- Both the original request and one retry returned HTTP 429; the model returned no proposal, so understanding, correctness, proportionality, and hallucinations cannot be assessed.
- FALLBACK result recorded separately; not scored as AI.

## Final verdict

**INSUFFICIENT EVIDENCE** — all five prompts were rate-limited on both the original request and the single allowed retry; there were no raw proposals to assess.

- Natural-language understanding: not assessable.
- Explicit exclusions: not assessable.
- Generic template leakage: not assessable.
- Scale appropriateness: not assessable.
- Hallucinations: not assessable.
- Continue testing this model: only after provider availability allows a test; this run supports no model-quality conclusion.
- Biggest weakness observed: provider availability for this exact free endpoint, not model reasoning.

Do not use this five-request diagnostic to recommend replacing the current model.
