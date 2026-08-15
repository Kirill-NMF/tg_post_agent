# Evidence-Led Job Latency Diagnosis

## Purpose

Measure where an asynchronous private-bot job spends time before changing model, retries, timeout, architecture, or quality settings.

## Safe timing contract

Emit one terminal structured event per measured job with a stable job id and fixed fields: queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, totalDurationMs, and terminalCategory. Do not include user id, chat id, transcript, draft, prompt, payload values, raw provider response, credential, or header.

For Stage 3, providerDurationMs covers the adapter request boundary, including response parsing and adapter-side plan validation; validationApplicationDurationMs covers the final canonical-plan application. The terminal event must be best-effort: a logging-sink failure cannot prevent delivery or recovery.

## Baseline procedure

1. Deploy the timing revision with one worker/poller.
2. Run one owner-controlled Option 2 formatting flow on a dedicated draft; do not retry it for measurement.
3. Locate its formatting_job_timing event by the job id already present in job lifecycle logs.
4. Read the fields in order: queueWaitMs identifies poll/queue delay; providerDurationMs identifies external/model-adapter time; validationApplicationDurationMs identifies local renderer cost; notifierDurationMs identifies Telegram delivery; totalDurationMs is the user-visible worker portion.
5. Classify terminalCategory before proposing a change. A single sample is a baseline, not a percentile or a performance conclusion.

## Anti-patterns

Changing provider/model/timeout because of an anecdotal wait; logging content to explain latency; treating totalDurationMs as provider latency; retrying the baseline sample; allowing telemetry failures to block recovery.


## Draft-generation terminal timing

For Stage 2 generation use draft_generation_job_timing with the same bounded timing fields as formatting. terminalCategory distinguishes success, retry_scheduled, output_repair_scheduled, terminal_failure, notifier_failed, and provider_unexpected_failure. A repair attempt is part of the original intent and must use the same confirmed source and rewrite mode.
