---
'hbbatchbeast': patch
---

Fix episode matching for shows that number seasons by year, such as Looney Tunes (`S1940E07`). Year-based season tags are now parsed from TVDB, filenames, season folders and the Fix match search, so those episodes match by tag or title instead of being dropped and leaving only specials. The TVDB episode cache key was bumped so previously cached, incomplete episode lists are refetched.
