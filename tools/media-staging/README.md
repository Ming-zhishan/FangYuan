# FangYuan — Read-only media staging v1

## Purpose

Create **offline, non-deployable** candidate snapshots from the *existing* meme and voice research assets. This is the stage-0/stage-1 handoff for two media lines only; it is not a new Bot, crawler, scheduler, TTS engine, or production asset importer.

- **Meme:** read the latest TrendRadar `output_live/current_snapshot_summary.json` keyword matches and existing meme `research.sqlite3` metadata **read-only**. Emit leads with `originalImageVerified:false`, `rights:unverified`, `readyForProduction:false`. TrendRadar titles are not source meme pictures. Existing approval and source database are never changed.
- **Voice:** reconcile current `sources.jsonl`, `research_audio_manifest.jsonl`, and the older disabled voice catalogue. Verify each actual audio file's SHA-256 and recorded byte length. Detect additional source/audio IDs without hardcoded 49/11 counts; export candidates with `readyForQQ:false`. An ASR file pair being present does **not** establish transcription correctness, speaker identity, rights, or listening quality.
- **Isolation:** no changes to DSH NEXT, Aurabot, NapCat, QQ, learning, persona, production sources, shared Git main, or any other collaborator's assets. No fetch, download, model invocation, TTS, or QQ send. This tool can only write inside a previously nonexistent output directory **outside the source tree**.

## Requirements and command

Node.js **v22.13+** for `node:sqlite` (the actual TJ validation used Node 24). In PowerShell, run:

```powershell
node --test tools/media-staging/stage.test.mjs
node tools/media-staging/stage.mjs --media-root "<MEDIA_RESEARCH_ROOT>" --out "<NEW_ISOLATED_AUDIT_DIRECTORY>"
```

The caller substitutes existing paths; **the output directory must not exist**, its parent must exist, and the parent must contain a task-owner marker named `.fangyuan-media-staging-root.json` with exact contents `{"purpose":"isolated-fangyuan-media-staging","allowNewChildren":true}`. Create that marker **only in a new audit directory owned by this media task**, never inside production, shared Git, or another collaborator's folder. It prevents accidental writes into arbitrary directories. Do not run the older `run_pipeline.mjs`, `curated_stock_import.mjs --commit`, `update_audio_manifest.mjs`, `run_final_independent_qa.mjs`, or `tidy_v4_delivery.mjs` in production as a shortcut — some still use historical path literals and may mutate source files, reports, or library contents.

Output files:

| Output | Purpose |
| --- | --- |
| `manifest.json` | Source fingerprints, non-production status and audit metadata |
| `meme_leads.json` | Deduplicated TrendRadar keyword leads plus *read-only* SQLite counts; no original-media or rights claim |
| `voice_review.json` | Actual research audio integrity, old-vs-current inventory differences, conservative disabled status |
| `README.md` | Explicit offline-only warning |

## Baseline and known limits

- Current baseline was 32 production stickers, 0 automatic media chance, group allowlist 0. This tool does not require or modify production config.
- The independent TrendRadar snapshot has one crawl, nine platform summaries and 249 raw headlines; the 8 keyword matches only produce research leads. Existing meme SQLite records still have 0 hot topics, 5 awaiting-visual templates and no approved original.
- Current voice manifests have 51 source rows and 13 audio rows; the previous QA and disabled catalogue reflect 49 and 11. The added rows `FY-V050`/`FY-V051` require new validation; do not overwrite old QA or activate their audio. The staged report's two added source IDs are inferred from append-only ordering and must be reconciled with original history.
- The voice clone dependency setup and reference-audio work are NOT proof of a trained and accepted bespoke voice.
- One snapshot is not a continuous production/update system. Current pipeline gaps remain: **source discovery → actual original media → licensing/editorial review → one-writer ingest**, **voice provenance → speaker review → permitted source → high-quality render**, and the separate private QQ release approval.
- Every candidate remains disabled even if hashes match. A production integrator must separately approve specific material, create versioned release manifests, back up live configs and check real QQ output with authorized contacts.

## Multi-collaborator contract

This work lives in its **own** Git worktree and feature branch. The daily meme research automation and other editors may continue their projects. This tool treats all existing data as read-only, never claims or deletes a shared lock, and refuses to create outputs inside source media or overwrite anyone's existing output directory.

It also checks selected inputs' fingerprints before/after staging and aborts if they changed during the read. If a writer updates media mid-run, retry later with a **new** output directory; never reset or overwrite that writer's files.

Deployment and code merge are separate decisions. Opening or merging a PR will not install code into the Bot's production directory. Do not toggle `autoChance` or send live QQ messages as part of this procedure.

## Tests

`stage.test.mjs` uses fake data and isolated temporary fixtures. It checks candidate deduplication, fingerprinting, disabled rights/publish flags, non-overwriting output, source/output overlap, corrupted or missing audio, duplicate IDs, path traversal, malformed trend data, and incomplete arguments. The real-data smoke test writes only to a private audit directory that must **not** be uploaded to a public repository.

## Stage 2: Evidence-based private review queue

The review command operates on the **existing Stage 1 results** and the same research root, writing a **new task-owned directory**. It is an offline triage and evidence template only, not a deployer.

```powershell
node --test tools/media-staging/stage.test.mjs tools/media-staging/review.test.mjs
node tools/media-staging/review.mjs --media-root "<MEDIA_RESEARCH_ROOT>" --stage-1 "<STAGE_1_OUTPUT_DIRECTORY>" --out "<NEW_STAGE_2_REVIEW_DIRECTORY>"
```

The output parent must already contain the same task-owned `.fangyuan-media-staging-root.json` marker described above. The destination must not exist; source research and Stage 1 input are read-only. If Stage 1 source fingerprints no longer match the source research, stop and repeat Stage 1 in an isolated new directory rather than overwriting anyone else's data.

Stage 2 generates `review_queue.json` with **unapproved** meme and voice tickets, plus `review_decisions_TEMPLATE.json` with **blank human decision fields**. The queue contains recording hashes, ASR status, segment-count comparisons, and cross-model Chinese-transcription similarity where available; the original transcript itself is deliberately not copied into the shareable template. Use the original private research files for manual audio listening and source verification.

ASR review triage is heuristic: **high** when similarity < 0.50, the two segment counts differ by a ratio of at least 1.50, or a model/status check is anomalous; **medium** for weaker differences (including similarity < 0.85); otherwise **normal**. These are *review scheduling priorities*, never transcription accuracy, speaker attribution, or permission approvals. Every source still requires independent human review.

`evaluateReview(ticket, decision)` validates that a proposed editorial review carries an identified reviewer, timestamp and the relevant *references* (original-image hash and source context/rights for memes; speaker, transcript, listening, usage rights for voice). Even a fully completed and validated **mock** decision yields only `evidence_submitted_for_separate_review`; it can **never** set `productionReady` or `qqReady` to true. An evidence reference is not automatically proof that a license was issued or that human review really occurred.

**Editorial approval is not deployment authorization.** Another authorized integrator must separately validate original artifacts and permission scope, approve the specific release batch, check QQ identity/permissions, back up production, run staged tests, and record the real recipient-side result before any release. Current group-disabled and zero-media-auto policies remain unchanged.

`review.test.mjs` uses synthetic isolated fixtures to test review prioritization, source SHA-256 binding, ASR tampering, concurrent source changes, rejection/evidence gates, blank templates, and output ownership. No research data, production files, QQ messages, or paid model calls are needed.

## Stage 4 — repeatable factory and newly synthesized voice packs

This is a development and private research workflow. It never modifies Aurabot, QQ, the original producer SQLite, or another collaborator's code. It has no fixed daily item or execution cap; editorial relevance and licensing still gate what is considered for production.

- factory.mjs: read the FULL TrendRadar raw NewsNow SQLite rather than the truncated top-20 preview; merge old Wiki terms and checksum-verified original media. It stores every snapshot in an independently owned SQLite DB and deduplicates repeated runs. Sensitive news never becomes an approved meme. Use --previous only for a previously closed factory output DB. Always create a NEW output directory. No direct QQ send.
- source_shadow.py: safely create a private SQLite backup and byte-for-byte media copies, join a fresh independently crawled TrendRadar snapshot and extra original references. It never checkpoints/writes the producer database. It records original-media rights as unverified.
- run_factory_cycle.py: optional independent TrendRadar refresh, single-writer lock, fresh source shadow, incremental factory, integrity check and atomic LATEST.json pointer. Duplicate snapshots automatically skip. It does NOT create an OS scheduled task; call at the desired cadence from a task that exclusively owns this root.
- synthesize_f5.py: reusable local F5 zero-shot generator with explicit SHA-256 reference verification, original text JSON, deterministic seeds, peak limiter, signal QC and all-release-flags-false. It performs no paid model calls and no training. This remains private research; a human must validate timbre, speaker attribution and usage rights.
- asr_voicepack.py: independent cached offline Whisper small decoding of newly synthesized samples; compare raw Han characters and pinyin separately. Traditional/Simplified differences often reduce raw character score without altering phonetics. Pinyin 100% CAN mask semantic homophones and is not a word-accuracy certificate.
- audio_qa.py: independent WAV technical QC; flags saturation and non-finite/invalid data. Peak limiting cannot restore lost audio from an earlier clipped waveform.
- build_review_dashboard.py + dashboard_template.html: local HTML showing complete cross-snapshot lead search, 11 real original meme files and the three R&D WAVs with hashes, recognition, playback, rights reminders and an offline notes export. No external JavaScript or QQ.

Suggested run order in a wholly private owner-marked research directory:

1. Clone the TrendRadar code and config into a uniquely owned copy; keep its notifications and in-app auto-scheduler OFF, and disable browser launches. Point a public-data fetch run exclusively at that copy.
2. Run run_factory_cycle.py with --root, --crawler, --crawler-python, --research, --external, --source-shadow and --factory-js (all are input paths; never use the live Bot root as output). Supply --refresh when a fresh crawl is wanted. Repeat calls with unchanged source are skipped safely.
3. Check CYCLE_FINAL.json, FACTORY_FINAL.json, and the SHA-256 source metadata, then inspect the content. A high-priority title is a RESEARCH LEAD, NOT an original image or publishable meme.
4. Provide a permitted voice reference and matching transcript; run synthesize_f5.py --dry-run first, then without it into a NEW private output directory. Source words are ORIGINAL lines; use the real speaker consent scope for reference audio.
5. Run asr_voicepack.py, audio_qa.py, and build_review_dashboard.py to review real audio and image candidates, then explicitly approve individual items for a separate integration batch.
6. Only a designated production integrator may change the QQ Bot runtime after reviewing media rights, back-ups, versioned manifests and real private-recipient acceptance.

Isolated TJ evidence from 2026-11-01: independent fresh nine-platform crawl succeeded (246 items), merged with older snapshot for 398 unique leads; 80 research Wiki terms; 11 SHA-verified originals; six original zero-shot F5 clips across two independent runs (first three independently decoded); no production approvals. Check private audit files for exact validation details. Never upload copyrighted reference files, research recordings or local absolute paths to the public Git repository.
