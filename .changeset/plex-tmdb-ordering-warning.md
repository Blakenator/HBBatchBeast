---
'hbbatchbeast': patch
---

Warn when a connected Plex TV library uses TMDB episode ordering, because the organizer renames episodes using TheTVDB (Aired) order and the two can disagree. The warning appears in the Plex status report and in TV organize plans. Older Plex databases without the `library_sections.user_fields` column are still supported.
