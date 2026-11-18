---
'hbbatchbeast': minor
---

Add bulk multi-episode handling to Organize. Select rows and choose **Multi-episode** to detect the run from the episode tag plus the joined episode titles in the filename, renumber the selection sequentially with a fixed number of episodes per file (each show/season starts at E01 and editing a start number cascades), or keep each file's current number and append the following episodes. The preview highlights what changes in each new filename, shows the current match confidence, and has a per-row **Fix match** button that opens the shared match dialog. Rows that would cross a season boundary or have no matched show are flagged, and the ranges are stored as per-file overrides.

Scans also detect multi-episode files from joined episode titles (for example `S01E02 - The Deep and Coral Reefs` → `S01E02-E03`) and score the name evidence against every title in the run, so those files are not pushed below the confidence threshold.

The review table also gains a **Multi-episode** filter chip that shows only files covering two or more episodes (including files with a queued split), and a **Select multi-episode** helper that selects every such file currently shown — or clears them when they are all selected.
