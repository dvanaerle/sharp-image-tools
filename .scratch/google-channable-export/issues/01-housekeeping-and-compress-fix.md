# 01: Housekeeping and compress.js fix

**What to build:** A clean, committed repo before the refactor starts, with the older compression pass working again. The uncommitted homepage and campaign preset work is committed as its own commit, untouched. `compress.js` currently imports an output-format helper that the main script does not export and therefore crashes on load; after this ticket it loads and runs. The Channable export folder and the Playwright scratch folder are ignored by git, and `docs/` plus `.scratch/` are committed.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The pre-existing changes to the config and the main script are committed in a commit of their own, with no edits of their own mixed in.
- [ ] Requiring `compress.js` no longer throws; running it against an empty temp root prints `Done.` and exits 0.
- [ ] `.gitignore` covers `google-channable-export/` and `.playwright-mcp/`.
- [ ] `docs/` and `.scratch/` are committed.
- [ ] `git status` is clean at the end.
- [ ] `npm run build` behaviour is unchanged.
