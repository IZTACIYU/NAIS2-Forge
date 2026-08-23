# Danbooru tag sync

The application ships a compact 300,000-tag autocomplete index. The reusable sync tool keeps a complete local staging database in `.tag-sync/`, validates Danbooru tags, aliases, and implications, then derives the compatible application assets.

```powershell
npm run tags:update -- --dry-run --full
npm run tags:update -- --full --use-cache
npm run tags:update -- --incremental
```

- `--dry-run` fetches and validates data but does not change `src/assets`.
- `--use-cache` applies the last complete validated fetch without downloading it again.
- `--incremental` currently performs the same complete ID scan as `--full`. Danbooru updated-time pagination does not guarantee an omission-free incremental result.
- The default API host is `https://hijiribe.donmai.us`. Override it with `DANBOORU_BASE_URL`.
- Optional authentication uses `DANBOORU_USERNAME` and `DANBOORU_API_KEY`.
- Request spacing can be changed with `DANBOORU_REQUEST_INTERVAL_MS`; the default is 200ms and requests are sequential.

Before applying, the tool copies existing generated assets into `.tag-sync/backups/<timestamp>/`. Fetches are staged transactionally in SQLite, can resume by ID cursor after interruption, never delete missing upstream rows, and only replace application assets after all three resources and integrity validation complete.

The shipped `tags.json` preserves the existing NovelAI label convention (`_` to spaces, `artist:` prefix), while adding Danbooru ID, source name, category, count, deprecation state, and timestamps. Active aliases are compiled separately and loaded lazily for prompt-generator exact matching. Implications remain in the staging database as direct `antecedent -> consequent` edges; automatic prompt expansion is intentionally outside the updater.
