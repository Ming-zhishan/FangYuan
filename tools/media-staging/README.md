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

## Focused voice-direction review (2026-11-01)

`build_voice_focus.py` and `voice_focus_template.html` reuse three existing, phonetic-screened candidates plus the existing permitted reference. This step asks whether the current voice direction is suitable before producing more takes. It performs no synthesis, pitch/time modification, network access or QQ action.

Requirements: Python + NumPy for WAV preparation; the feedback validator needs only the standard library. Inputs are a private canonical JSON index (`entries`: id/text/file/sha256/pinyinScore), permitted mono PCM16 reference WAV and its SHA-256. Current chosen IDs are fy-original-01, fy-clarity-v6-01a and fy-scene-v3-05; they must exist and have pinyinScore=1. This is an automatic screening condition, not human word accuracy or voice approval. The canonical index is an existing private Stage 6 artifact documented at media commit `294fa3c`, not a bundled audio asset.

```powershell
python tools/media-staging/build_voice_focus.py --index "<PRIVATE_CANONICAL_INDEX>" --reference "<PERMITTED_REFERENCE_WAV>" --reference-sha256 "<REFERENCE_SHA256>" --template tools/media-staging/voice_focus_template.html --out "<NEW_PRIVATE_REVIEW_FOLDER>"
python -m unittest discover -s tools/media-staging -p voice_focus_test.py -v
```

The output parent needs the same task-ownership marker documented above. Source audio folders and existing outputs are rejected. Outputs are index.html, manifest.json and four preview WAVs. Open index.html from the local folder; all audio links are relative. Never upload the private outputs to this public repository.

Each preview uses **linear gain to whole-clip RMS 0.1**; this is not LUFS or perceptual loudness normalization. Reject a clip if that gain would exceed peak 0.95 instead of silently compressing it. Original audio is untouched; sample rate, duration and pitch remain unchanged. Source and preview SHA-256 are both recorded. Refuse empty/invalid inputs and verify PCM roundtrip.

The page collects one overall direction and optional per-clip pronunciation/delivery/synthetic-voice feedback, supports skipping, local saving and JSON download. `validate_feedback(manifest, feedback)` checks the exact index/review-set hashes and original/preview hashes; preferences never authorize deployment. A changed preview set gets separate browser state so stale choices are not reused. Returned validation is subjective triage only.

Actual TJ evidence for this iteration: 4 clips, 15.433 seconds total; gain-only preparation reproduces the same four audio hashes. Headless browser decoded and played all four clips and verified refresh persistence, real JSON download/import and rejection of a tampered hash. Five feedback-gate unit tests passed. Human listening remains pending; no new synthesized samples, production writes or QQ sends. Keep existing original research audio and the stable review entry until a separately checked promotion is ready.


### Feedback-driven retakes: emotion and fluency (2026-11-01)

Human feedback accepted the overall direction as close, while finding insufficient emotion and non-fluent speech. This is a direction-level preference, not approval of every clip or deployment. Keep the old 37 files immutable and bind feedback to the focus-set manifest.

Implementation finding: the old generator stores `delivery` in metadata but does not pass it to F5; changing that label alone never conditions emotion. F5's installed infer API has no direct emotion argument. Do not claim an emotional improvement from labels or NFE values. Test the actual reference performance, text wording and timing instead.

Three private local trials were made with cached F5 v1 weights, no training, paid calls or QQ: A/B both use “不是哥们，这你都能信？”, nfe_step=48, cfg_strength=1.6, speed=0.88, seed=24011. A uses the existing C02 reference; B changes only the reference to FY-V051 seconds 0–5.76, with machine-assisted text stored in the private manifest. This reference is attributed to the same creator but its transcript/style is not human-approved; it is an experimental condition, not a final reference. C uses C02 and the conversational rewrite “先别急，把事情从头说清楚。”, speed=0.94, seed=24012, otherwise the same decoding settings. C is not the same utterance as the old daily-response clip.

Call the existing F5 API with those explicit infer parameters; provide local checkpoint/vocoder paths and HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE to avoid downloads. Keep reference hashes, source range, reference text, text, seed and parameters in the private VOICE_FACTORY_FINAL.json. Decode source audio with the existing PyAV runtime; do not re-download or install a new generation stack. Use the historical isolated ctranslate2 4.5.0 ASR runtime, rather than the F5 environment's 4.8.4 with a recorded Windows crash.

Actual outputs: 2.581 / 3.211 / 2.859 seconds, 24kHz mono PCM16, peaks approximately 0.89 with no clipping. Independent cached Whisper-small transcribed all 3 with pinyin similarity 1.0; this does not verify emotion, naturalness, homophones or identity. Separate gain-only RMS-matched previews and the old baseline all decoded and played in a headless browser. Private delivery uses VOICE_FACTORY_FINAL.json, VOICE_ASR_FACTORY_FINAL.json, HUMAN_FEEDBACK.json, LISTENING_MANIFEST.json and BROWSER_QA.json; no audio or source recordings are committed here. Next action is a small A/B preference and C fluency review, not more blind synthesis.
