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
