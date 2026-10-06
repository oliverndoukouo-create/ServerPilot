# ServerPilot AI Model Benchmark — Round 2

Generated: 2026-10-05T21:23:08.524Z

## Executive summary

Status: complete. Models are ranked only with at least 15 schema-valid raw proposals. The prompt instructions resolve to 20 requests per model (five prompts repeated three times, the other five once).

Models with enough raw data: none; rankings will be INSUFFICIENT EVIDENCE.

## Provider availability

| Model | Attempts | Provider responses | Parsed JSON | Schema-valid proposals | Fallbacks | HTTP 429 | Timeouts | Other errors |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 26B A4B free | 20 (3 sent, 17 skipped) | 0 (0%) | 0 | 0 | 20 | 3 | 0 | 0 |
| Gemma 4 31B free | 20 (3 sent, 17 skipped) | 0 (0%) | 0 | 0 | 20 | 3 | 0 | 0 |
| Nemotron 3.5 Lightning free | 20 (3 sent, 17 skipped) | 0 (0%) | 0 | 0 | 20 | 3 | 0 | 0 |
| Dots3-Note Preview free | 20 (3 sent, 17 skipped) | 0 (0%) | 0 | 0 | 20 | 3 | 0 | 0 |

### Unavailable pinned models

- `nvidia/nemotron-3-ultra:free` — Exact pinned model ID is absent from the configured provider catalog; no substitute was used.

## Raw model comparison

| Model | Intent | Following | Exclusions | Hallucination control | Proportionality | Completion | Consistency | JSON/schema | Naturalness | Availability | Overall / 100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 26B A4B free | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | 0% | INSUFFICIENT EVIDENCE |
| Gemma 4 31B free | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | 0% | INSUFFICIENT EVIDENCE |
| Nemotron 3.5 Lightning free | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | 0% | INSUFFICIENT EVIDENCE |
| Dots3-Note Preview free | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | 0% | INSUFFICIENT EVIDENCE |

## Production ServerPilot comparison

| Model | Final intent | Following | Exclusions | Hallucination control | Proportionality | Completion | Consistency | Fallbacks | Reconciled | Accepted cleanly |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Gemma 4 26B A4B free | 8.59 | 8.03 | 9.38 | 8.3 | 10 | 8.38 | 10 | 20/20 | 0/20 | 0/20 |
| Gemma 4 31B free | 8.59 | 8.03 | 9.38 | 8.3 | 10 | 8.38 | 10 | 20/20 | 0/20 | 0/20 |
| Nemotron 3.5 Lightning free | 8.59 | 8.03 | 9.38 | 8.3 | 10 | 8.38 | 10 | 20/20 | 0/20 | 0/20 |
| Dots3-Note Preview free | 8.59 | 8.03 | 9.38 | 8.3 | 10 | 8.38 | 10 | 20/20 | 0/20 | 0/20 |

## Consistency comparison

### Gemma 4 26B A4B free

Raw average: N/A; raw worst repeated prompt: N/A; final average including fallback: 10.

| Prompt | Raw score | Outputs | Critical contradictions |
|---|---:|---:|---:|
| 1 | N/A | 0/3 | 0 |
| 2 | N/A | 0/3 | 0 |
| 5 | N/A | 0/3 | 0 |
| 8 | N/A | 0/3 | 0 |
| 10 | N/A | 0/3 | 0 |

### Gemma 4 31B free

Raw average: N/A; raw worst repeated prompt: N/A; final average including fallback: 10.

| Prompt | Raw score | Outputs | Critical contradictions |
|---|---:|---:|---:|
| 1 | N/A | 0/3 | 0 |
| 2 | N/A | 0/3 | 0 |
| 5 | N/A | 0/3 | 0 |
| 8 | N/A | 0/3 | 0 |
| 10 | N/A | 0/3 | 0 |

### Nemotron 3.5 Lightning free

Raw average: N/A; raw worst repeated prompt: N/A; final average including fallback: 10.

| Prompt | Raw score | Outputs | Critical contradictions |
|---|---:|---:|---:|
| 1 | N/A | 0/3 | 0 |
| 2 | N/A | 0/3 | 0 |
| 5 | N/A | 0/3 | 0 |
| 8 | N/A | 0/3 | 0 |
| 10 | N/A | 0/3 | 0 |

### Dots3-Note Preview free

Raw average: N/A; raw worst repeated prompt: N/A; final average including fallback: 10.

| Prompt | Raw score | Outputs | Critical contradictions |
|---|---:|---:|---:|
| 1 | N/A | 0/3 | 0 |
| 2 | N/A | 0/3 | 0 |
| 5 | N/A | 0/3 | 0 |
| 8 | N/A | 0/3 | 0 |
| 10 | N/A | 0/3 | 0 |

## Error, hallucination, and task completion comparison

| Model | Severity / flags |
|---|---|
| Gemma 4 26B A4B free | Severity: none: 3; rate_limit: 3 |
| Gemma 4 31B free | Severity: none: 3; rate_limit: 3 |
| Nemotron 3.5 Lightning free | Severity: none: 3; rate_limit: 3 |
| Dots3-Note Preview free | Severity: none: 3; rate_limit: 3 |

## Latency comparison

| Model | Average ms | Median ms | Slowest ms |
|---|---:|---:|---:|
| Gemma 4 26B A4B free | N/A | N/A | N/A |
| Gemma 4 31B free | N/A | N/A | N/A |
| Nemotron 3.5 Lightning free | N/A | N/A | N/A |
| Dots3-Note Preview free | N/A | N/A | N/A |

## Per-model detailed results

### Gemma 4 26B A4B free — google/gemma-4-26b-a4b-it:free

Raw rankable: no; provider responses 0/20; valid proposals 0/20; attempted 3; skipped 17; fallbacks 20/20; reconciled 0; clean 0.

Raw scores: {"intentUnderstanding":null,"instructionFollowing":null,"exclusionHandling":null,"hallucinationControl":null,"proportionality":null,"taskCompletion":null,"consistency":null,"structuredJson":null,"naturalness":null}.

### Gemma 4 31B free — google/gemma-4-31b-it:free

Raw rankable: no; provider responses 0/20; valid proposals 0/20; attempted 3; skipped 17; fallbacks 20/20; reconciled 0; clean 0.

Raw scores: {"intentUnderstanding":null,"instructionFollowing":null,"exclusionHandling":null,"hallucinationControl":null,"proportionality":null,"taskCompletion":null,"consistency":null,"structuredJson":null,"naturalness":null}.

### Nemotron 3.5 Lightning free — nvidia/nemotron-3.5-lightning:free

Raw rankable: no; provider responses 0/20; valid proposals 0/20; attempted 3; skipped 17; fallbacks 20/20; reconciled 0; clean 0.

Raw scores: {"intentUnderstanding":null,"instructionFollowing":null,"exclusionHandling":null,"hallucinationControl":null,"proportionality":null,"taskCompletion":null,"consistency":null,"structuredJson":null,"naturalness":null}.

### Dots3-Note Preview free — dots-studio/dots-3-note-preview:free

Raw rankable: no; provider responses 0/20; valid proposals 0/20; attempted 3; skipped 17; fallbacks 20/20; reconciled 0; clean 0.

Raw scores: {"intentUnderstanding":null,"instructionFollowing":null,"exclusionHandling":null,"hallucinationControl":null,"proportionality":null,"taskCompletion":null,"consistency":null,"structuredJson":null,"naturalness":null}.

## Raw response samples

### Gemma 4 26B A4B free

No raw response content was returned.

### Gemma 4 31B free

No raw response content was returned.

### Nemotron 3.5 Lightning free

No raw response content was returned.

### Dots3-Note Preview free

No raw response content was returned.

## Final rankings

- **Best raw AI quality:** INSUFFICIENT EVIDENCE
- **Best instruction following:** INSUFFICIENT EVIDENCE
- **Best exclusion handling:** INSUFFICIENT EVIDENCE
- **Best hallucination control:** INSUFFICIENT EVIDENCE
- **Best proportionality:** INSUFFICIENT EVIDENCE
- **Best task completion:** INSUFFICIENT EVIDENCE
- **Most consistent:** INSUFFICIENT EVIDENCE
- **Most reliable:** INSUFFICIENT EVIDENCE
- **Fastest:** INSUFFICIENT EVIDENCE
- **Best overall raw model:** INSUFFICIENT EVIDENCE
- **Best overall ServerPilot result:** INSUFFICIENT EVIDENCE

## Limitations and recommendation

The mechanical scores use the fixed prompt feature checklist. Review raw response samples and per-attempt details before drawing product conclusions. Provider errors are not treated as reasoning errors; fallback output is scored only in the production comparison.
