import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildTagIndexes } from './build-tag-index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetsDirectory = path.join(root, 'src', 'assets')
const stateDirectory = path.join(root, '.tag-sync')
const databasePath = path.join(stateDirectory, 'danbooru.sqlite')
const args = process.argv.slice(2)
const hasArg = value => args.includes(value)
const argValue = name => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
const dryRun = hasArg('--dry-run')
const useCache = hasArg('--use-cache')
const mode = hasArg('--incremental') ? 'incremental' : 'full'
const shouldApply = !dryRun
const baseUrl = (argValue('--base-url') || process.env.DANBOORU_BASE_URL || 'https://hijiribe.donmai.us').replace(/\/$/, '')
const requestInterval = Number(process.env.DANBOORU_REQUEST_INTERVAL_MS || 200)
const pageLimit = 1000
const appTagLimit = 300_000
const userAgent = process.env.DANBOORU_USER_AGENT || 'NAIS2-Forge-TagSync/1.0 (https://github.com/IZTACIYU/NAIS2-Forge)'

if (!dryRun && !hasArg('--full') && !hasArg('--incremental')) {
    console.error('Usage: npm run tags:update -- --dry-run [--full|--incremental] | --full | --incremental [--use-cache]')
    process.exit(1)
}
if (hasArg('--full') && hasArg('--incremental')) throw new Error('Choose either --full or --incremental')
if (!Number.isFinite(requestInterval) || requestInterval < 0) throw new Error('Invalid DANBOORU_REQUEST_INTERVAL_MS')

await mkdir(stateDirectory, { recursive: true })
const db = new DatabaseSync(databasePath)
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category INTEGER NOT NULL,
        post_count INTEGER NOT NULL,
        is_deprecated INTEGER NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        seen_run TEXT,
        remote_missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS tags_post_count ON tags(post_count DESC);
    CREATE INDEX IF NOT EXISTS tags_category ON tags(category);
    CREATE INDEX IF NOT EXISTS tags_deprecated ON tags(is_deprecated);
    CREATE TABLE IF NOT EXISTS tag_aliases (
        id INTEGER PRIMARY KEY,
        antecedent_name TEXT NOT NULL,
        consequent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        creator_id INTEGER,
        approver_id INTEGER,
        forum_topic_id INTEGER,
        forum_post_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        seen_run TEXT,
        remote_missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS aliases_antecedent ON tag_aliases(antecedent_name);
    CREATE INDEX IF NOT EXISTS aliases_consequent ON tag_aliases(consequent_name);
    CREATE INDEX IF NOT EXISTS aliases_status ON tag_aliases(status);
    CREATE TABLE IF NOT EXISTS tag_implications (
        id INTEGER PRIMARY KEY,
        antecedent_name TEXT NOT NULL,
        consequent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        creator_id INTEGER,
        approver_id INTEGER,
        forum_topic_id INTEGER,
        forum_post_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        seen_run TEXT,
        remote_missing INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS implications_antecedent ON tag_implications(antecedent_name);
    CREATE INDEX IF NOT EXISTS implications_consequent ON tag_implications(consequent_name);
    CREATE INDEX IF NOT EXISTS implications_status ON tag_implications(status);
    CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
`)

const getMetaStatement = db.prepare('SELECT value FROM sync_metadata WHERE key = ?')
const setMetaStatement = db.prepare('INSERT INTO sync_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
const getMeta = key => getMetaStatement.get(key)?.value ?? null
const setMeta = (key, value) => setMetaStatement.run(key, String(value))
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const credentials = process.env.DANBOORU_USERNAME && process.env.DANBOORU_API_KEY
    ? Buffer.from(`${process.env.DANBOORU_USERNAME}:${process.env.DANBOORU_API_KEY}`).toString('base64')
    : null

async function fetchPage(resource, cursor) {
    const url = new URL(`${baseUrl}/${resource}.json`)
    url.searchParams.set('limit', String(pageLimit))
    url.searchParams.set('page', `a${cursor}`)
    url.searchParams.set('search[order]', 'id')

    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            const headers = { Accept: 'application/json', 'User-Agent': userAgent }
            if (credentials) headers.Authorization = `Basic ${credentials}`
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
            if (response.ok) {
                const body = await response.json()
                if (!Array.isArray(body) || body.some(item => !item || !Number.isInteger(item.id))) {
                    throw new Error(`${resource} returned malformed JSON`)
                }
                await sleep(requestInterval)
                return body
            }

            if (response.status !== 429 && response.status < 500) {
                throw new Error(`${resource} request failed: HTTP ${response.status}`)
            }
            const retryAfter = Number(response.headers.get('retry-after')) * 1000
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1000 * (2 ** attempt))
        } catch (error) {
            if (attempt === 5) throw error
            await sleep(1000 * (2 ** attempt))
        }
    }
    throw new Error(`${resource} request failed`)
}

const tagUpsert = db.prepare(`
    INSERT INTO tags(id, name, category, post_count, is_deprecated, created_at, updated_at, seen_run, remote_missing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        post_count = excluded.post_count,
        is_deprecated = excluded.is_deprecated,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        seen_run = excluded.seen_run,
        remote_missing = 0
`)
const relationshipUpserts = {
    tag_aliases: db.prepare(`
        INSERT INTO tag_aliases(id, antecedent_name, consequent_name, status, creator_id, approver_id, forum_topic_id, forum_post_id, created_at, updated_at, seen_run, remote_missing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
            antecedent_name = excluded.antecedent_name,
            consequent_name = excluded.consequent_name,
            status = excluded.status,
            creator_id = excluded.creator_id,
            approver_id = excluded.approver_id,
            forum_topic_id = excluded.forum_topic_id,
            forum_post_id = excluded.forum_post_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            seen_run = excluded.seen_run,
            remote_missing = 0
    `),
    tag_implications: db.prepare(`
        INSERT INTO tag_implications(id, antecedent_name, consequent_name, status, creator_id, approver_id, forum_topic_id, forum_post_id, created_at, updated_at, seen_run, remote_missing)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
            antecedent_name = excluded.antecedent_name,
            consequent_name = excluded.consequent_name,
            status = excluded.status,
            creator_id = excluded.creator_id,
            approver_id = excluded.approver_id,
            forum_topic_id = excluded.forum_topic_id,
            forum_post_id = excluded.forum_post_id,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            seen_run = excluded.seen_run,
            remote_missing = 0
    `),
}

function applyPage(resource, records, runId, cursor, total) {
    db.exec('BEGIN IMMEDIATE')
    try {
        if (resource === 'tags') {
            for (const item of records) {
                if (typeof item.name !== 'string' || !Number.isInteger(item.category) || !Number.isInteger(item.post_count)) {
                    throw new Error(`Malformed tag record ${item.id}`)
                }
                tagUpsert.run(item.id, item.name, item.category, item.post_count, item.is_deprecated ? 1 : 0, item.created_at ?? null, item.updated_at ?? null, runId)
            }
        } else {
            const statement = relationshipUpserts[resource]
            for (const item of records) {
                if (typeof item.antecedent_name !== 'string' || typeof item.consequent_name !== 'string' || typeof item.status !== 'string') {
                    throw new Error(`Malformed ${resource} record ${item.id}`)
                }
                statement.run(
                    item.id,
                    item.antecedent_name,
                    item.consequent_name,
                    item.status,
                    item.creator_id ?? null,
                    item.approver_id ?? null,
                    item.forum_topic_id ?? null,
                    item.forum_post_id ?? null,
                    item.created_at ?? null,
                    item.updated_at ?? null,
                    runId,
                )
            }
        }
        setMeta(`${resource}.cursor`, cursor)
        setMeta(`${resource}.total`, total)
        setMeta(`${resource}.run_id`, runId)
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

async function syncResource(resource, runId) {
    if (getMeta(`${resource}.run_id`) === runId && getMeta(`${resource}.status`) === 'complete') {
        console.log(`${resource}: already complete for resumed run`)
        return Number(getMeta(`${resource}.total`) || 0)
    }

    let cursor = getMeta(`${resource}.run_id`) === runId ? Number(getMeta(`${resource}.cursor`) || 0) : 0
    let total = getMeta(`${resource}.run_id`) === runId ? Number(getMeta(`${resource}.total`) || 0) : 0
    setMeta(`${resource}.run_id`, runId)
    setMeta(`${resource}.status`, 'in_progress')
    console.log(`Fetching ${resource} from ID ${cursor.toLocaleString()}...`)

    while (true) {
        const records = await fetchPage(resource, cursor)
        if (records.length === 0) break
        const nextCursor = Math.max(...records.map(item => item.id))
        if (nextCursor <= cursor) throw new Error(`${resource} cursor did not advance beyond ${cursor}`)
        total += records.length
        applyPage(resource, records, runId, nextCursor, total)
        cursor = nextCursor
        if (total % 25_000 < records.length) console.log(`${resource}: ${total.toLocaleString()} fetched`)
        if (records.length < pageLimit) break
    }

    db.exec('BEGIN IMMEDIATE')
    try {
        db.prepare(`UPDATE ${resource} SET remote_missing = CASE WHEN seen_run = ? THEN 0 ELSE 1 END`).run(runId)
        setMeta(`${resource}.status`, 'complete')
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
    console.log(`${resource}: ${total.toLocaleString()} complete`)
    return total
}

function countCycles(edges, singleTarget = false) {
    const graph = new Map()
    for (const { antecedent_name: from, consequent_name: to } of edges) {
        if (singleTarget) graph.set(from, [to])
        else (graph.get(from) || graph.set(from, []).get(from)).push(to)
    }

    const state = new Map()
    let cycles = 0
    const visit = node => {
        const current = state.get(node) || 0
        if (current === 1) {
            cycles += 1
            return
        }
        if (current === 2) return
        state.set(node, 1)
        for (const next of graph.get(node) || []) visit(next)
        state.set(node, 2)
    }
    for (const node of graph.keys()) visit(node)
    return cycles
}

function validateDatabase() {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check
    const duplicateNames = db.prepare('SELECT COUNT(*) AS count FROM (SELECT name FROM tags WHERE remote_missing = 0 GROUP BY name HAVING COUNT(*) > 1)').get().count
    const brokenAliases = db.prepare(`
        SELECT COUNT(*) AS count FROM tag_aliases a
        LEFT JOIN tags antecedent ON antecedent.name = a.antecedent_name AND antecedent.remote_missing = 0
        LEFT JOIN tags consequent ON consequent.name = a.consequent_name AND consequent.remote_missing = 0
        WHERE a.status = 'active' AND a.remote_missing = 0 AND (antecedent.id IS NULL OR consequent.id IS NULL)
    `).get().count
    const brokenImplications = db.prepare(`
        SELECT COUNT(*) AS count FROM tag_implications i
        LEFT JOIN tags antecedent ON antecedent.name = i.antecedent_name AND antecedent.remote_missing = 0
        LEFT JOIN tags consequent ON consequent.name = i.consequent_name AND consequent.remote_missing = 0
        WHERE i.status = 'active' AND i.remote_missing = 0 AND (antecedent.id IS NULL OR consequent.id IS NULL)
    `).get().count
    const aliases = db.prepare("SELECT antecedent_name, consequent_name FROM tag_aliases WHERE status = 'active' AND remote_missing = 0").all()
    const implications = db.prepare("SELECT antecedent_name, consequent_name FROM tag_implications WHERE status = 'active' AND remote_missing = 0").all()
    return {
        integrity,
        duplicateNames,
        brokenAliases,
        brokenImplications,
        aliasCycles: countCycles(aliases, true),
        implicationCycles: countCycles(implications),
    }
}

const categoryNames = new Map([[0, 'general'], [1, 'artist'], [3, 'copyright'], [4, 'character'], [5, 'meta']])
const displayName = (name, category) => `${category === 1 ? 'artist:' : ''}${name.replaceAll('_', ' ')}`

function buildAssets() {
    const rows = db.prepare(`
        SELECT id, name, category, post_count, is_deprecated, created_at, updated_at
        FROM tags
        WHERE remote_missing = 0 AND post_count > 0 AND is_deprecated = 0 AND category IN (0, 1, 3, 4, 5)
        ORDER BY post_count DESC, id ASC
        LIMIT 330000
    `).all()
    const tags = []
    const labels = new Set()
    const selectedByRemoteName = new Map()
    for (const row of rows) {
        const label = displayName(row.name, row.category)
        if (labels.has(label)) continue
        const type = categoryNames.get(row.category)
        const tag = {
            label,
            value: label,
            count: row.post_count,
            type,
            danbooruId: row.id,
            danbooruName: row.name,
            isDeprecated: Boolean(row.is_deprecated),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }
        tags.push(tag)
        labels.add(label)
        selectedByRemoteName.set(row.name, { label, category: row.category })
        if (tags.length === appTagLimit) break
    }
    if (tags.length !== appTagLimit) throw new Error(`Expected ${appTagLimit} app tags, got ${tags.length}`)

    const aliases = []
    const aliasLabels = new Set()
    for (const row of db.prepare(`
        SELECT id, antecedent_name, consequent_name, updated_at
        FROM tag_aliases
        WHERE status = 'active' AND remote_missing = 0
        ORDER BY id DESC
    `).iterate()) {
        const canonical = selectedByRemoteName.get(row.consequent_name)
        if (!canonical) continue
        const alias = displayName(row.antecedent_name, canonical.category)
        if (alias === canonical.label || labels.has(alias) || aliasLabels.has(alias)) continue
        aliases.push({ alias, canonical: canonical.label, danbooruId: row.id, updatedAt: row.updated_at })
        aliasLabels.add(alias)
    }
    aliases.sort((left, right) => left.alias.localeCompare(right.alias))
    return { tags, aliases }
}

async function readJsonOrEmpty(filePath) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'))
    } catch (error) {
        if (error?.code === 'ENOENT') return []
        throw error
    }
}

function compareAssets(currentTags, nextTags, currentAliases, nextAliases) {
    const currentMap = new Map()
    let duplicateLocalTags = 0
    for (const tag of currentTags) {
        if (currentMap.has(tag.label)) duplicateLocalTags += 1
        else currentMap.set(tag.label, tag)
    }
    const nextMap = new Map(nextTags.map(tag => [tag.label, tag]))
    let inserted = 0
    let updated = 0
    let unchanged = 0
    for (const tag of nextTags) {
        const current = currentMap.get(tag.label)
        if (!current) inserted += 1
        else if (current.count !== tag.count || current.type !== tag.type) updated += 1
        else unchanged += 1
    }
    const missing = [...currentMap.keys()].filter(label => !nextMap.has(label)).length

    const currentAliasMap = new Map(currentAliases.map(alias => [alias.alias, alias.canonical]))
    const nextAliasMap = new Map(nextAliases.map(alias => [alias.alias, alias.canonical]))
    let aliasesInserted = 0
    let aliasesUpdated = 0
    for (const [alias, canonical] of nextAliasMap) {
        if (!currentAliasMap.has(alias)) aliasesInserted += 1
        else if (currentAliasMap.get(alias) !== canonical) aliasesUpdated += 1
    }
    const aliasesMissing = [...currentAliasMap.keys()].filter(alias => !nextAliasMap.has(alias)).length
    return { inserted, updated, unchanged, missing, duplicateLocalTags, aliasesInserted, aliasesUpdated, aliasesMissing }
}

async function writeAtomic(filePath, text) {
    const temporaryPath = `${filePath}.tmp`
    await writeFile(temporaryPath, text)
    await rename(temporaryPath, filePath)
}

async function backupAssets() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDirectory = path.join(stateDirectory, 'backups', timestamp)
    await mkdir(backupDirectory, { recursive: true })
    for (const name of ['tags.json', 'tags.bin', 'tag-aliases.json', 'tag-aliases.bin', 'tags.meta.json']) {
        try {
            await copyFile(path.join(assetsDirectory, name), path.join(backupDirectory, name))
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
    }
    return backupDirectory
}

let runId
if (useCache) {
    if (getMeta('sync.status') !== 'complete') throw new Error('No complete cache is available')
    runId = getMeta('sync.last_successful_run_id')
} else {
    const resumable = getMeta('sync.status') === 'in_progress' && getMeta('sync.mode') === mode
    runId = resumable ? getMeta('sync.run_id') : randomUUID()
    if (!resumable) {
        setMeta('sync.status', 'in_progress')
        setMeta('sync.mode', mode)
        setMeta('sync.run_id', runId)
    }
    if (mode === 'incremental') {
        console.log('Incremental mode performs a complete ID scan because updated_at pagination cannot guarantee omission-free results.')
    }
    for (const resource of ['tags', 'tag_aliases', 'tag_implications']) await syncResource(resource, runId)
    setMeta('sync.status', 'complete')
    setMeta('sync.last_successful_run_id', runId)
    setMeta('sync.last_successful_at', new Date().toISOString())
}

const validation = validateDatabase()
const { tags, aliases } = buildAssets()
const currentTags = await readJsonOrEmpty(path.join(assetsDirectory, 'tags.json'))
const currentAliases = await readJsonOrEmpty(path.join(assetsDirectory, 'tag-aliases.json'))
const changes = compareAssets(currentTags, tags, currentAliases, aliases)
const totals = {
    tags: db.prepare('SELECT COUNT(*) AS count FROM tags WHERE remote_missing = 0').get().count,
    deprecated: db.prepare('SELECT COUNT(*) AS count FROM tags WHERE remote_missing = 0 AND is_deprecated = 1').get().count,
    aliases: db.prepare("SELECT COUNT(*) AS count FROM tag_aliases WHERE remote_missing = 0 AND status = 'active'").get().count,
    inactiveAliases: db.prepare("SELECT COUNT(*) AS count FROM tag_aliases WHERE remote_missing = 0 AND status != 'active'").get().count,
    implications: db.prepare("SELECT COUNT(*) AS count FROM tag_implications WHERE remote_missing = 0 AND status = 'active'").get().count,
    inactiveImplications: db.prepare("SELECT COUNT(*) AS count FROM tag_implications WHERE remote_missing = 0 AND status != 'active'").get().count,
}
const summary = { runId, mode, baseUrl, syncedAt: getMeta('sync.last_successful_at'), totals, appTags: tags.length, appAliases: aliases.length, changes, validation }
console.log(JSON.stringify(summary, null, 2))

if (validation.integrity !== 'ok' || validation.duplicateNames > 0) {
    throw new Error('Staging database validation failed')
}

if (shouldApply) {
    const backupDirectory = await backupAssets()
    await writeAtomic(path.join(assetsDirectory, 'tags.json'), JSON.stringify(tags))
    await writeAtomic(path.join(assetsDirectory, 'tag-aliases.json'), JSON.stringify(aliases))
    await writeAtomic(path.join(assetsDirectory, 'tags.meta.json'), JSON.stringify(summary, null, 2))
    await buildTagIndexes()
    console.log(`Applied tag assets. Backup: ${path.relative(root, backupDirectory)}`)
} else {
    console.log('Dry run complete. App assets were not modified.')
}

await writeFile(path.join(stateDirectory, 'last-summary.json'), JSON.stringify(summary, null, 2))
db.close()
