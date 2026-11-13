import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const active = alias => `${alias}.report_json IS NOT NULL AND ${alias}.withdrawn_at IS NULL AND ${alias}.expires_at > ${now}`
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i
const handle = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/
const catalogEntry = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/
const reasons = {
  accepted: ['verified'],
  rejected: ['unreadable', 'insufficient-evidence', 'duplicate', 'out-of-scope'],
  conflict: ['conflicting-evidence'],
}
const usage = `Usage: node scripts/review-symbol-reports.mjs [--remote --config PATH] [--database DB] COMMAND
  list [REPORT_ID]
  claim REPORT_ID REVIEWER
  evidence REPORT_ID CLAIM_ID
  decide REPORT_ID CLAIM_ID STATUS REASON [CANONICAL_REPORT_ID]
  release REPORT_ID CLAIM_ID
  catalog REPORT_ID REVIEWER MERGED_COMMIT_SHA CATALOG_ENTRY`

function validated(value, pattern, label) {
  if (!value || !pattern.test(value)) throw new Error(`Invalid ${label}.`)
  return `'${value}'`
}

export function reviewQuery(command, args, claimId = randomUUID()) {
  const [rawId, actor, status, reason, duplicate] = args
  if (command === 'list' && args.length <= 1) {
    const scope = rawId ? `AND r.id = ${validated(rawId.toLowerCase(), uuid, 'report ID')}` : ''
    return `SELECT r.id, r.recorded_at, r.expires_at,
    CASE WHEN v.status = 'pending' AND v.claim_until > ${now} THEN 'in-review'
      WHEN v.status IS NULL OR v.status = 'pending' THEN 'pending' ELSE v.status END AS status,
    CASE WHEN v.claim_until > ${now} OR v.status <> 'pending' THEN v.reviewer END AS reviewer,
    v.claim_until, v.reason, v.duplicate_of, v.decided_at, v.catalog_revision, v.catalog_entry, v.catalog_recorded_at
    FROM symbol_reports r LEFT JOIN symbol_report_reviews v ON v.report_id = r.id
    WHERE ((${active('r')}) OR v.status <> 'pending') ${scope}
    ORDER BY (v.status IS NOT NULL AND v.status <> 'pending'),
      CASE WHEN v.status IS NULL OR v.status = 'pending' THEN r.recorded_at END,
      v.decided_at DESC, r.id LIMIT 50`
  }
  if (!['claim', 'evidence', 'decide', 'release', 'catalog'].includes(command)) throw new Error(usage)
  const id = validated(rawId?.toLowerCase(), uuid, 'report ID')
  const liveReport = `EXISTS (SELECT 1 FROM symbol_reports r WHERE r.id = ${id} AND ${active('r')})`
  if (command === 'claim' && args.length === 2) {
    const reviewer = validated(actor, handle, 'reviewer handle')
    const claim = validated(claimId, uuid, 'claim ID')
    return `INSERT INTO symbol_report_reviews (report_id, reviewer, claim_id, claim_until)
      SELECT ${id}, ${reviewer}, ${claim}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 minutes')
      WHERE ${liveReport}
      ON CONFLICT(report_id) DO UPDATE SET reviewer = excluded.reviewer,
        claim_id = excluded.claim_id, claim_until = excluded.claim_until
      WHERE symbol_report_reviews.status = 'pending' AND symbol_report_reviews.claim_until <= ${now}
      RETURNING report_id, reviewer, claim_id, claim_until`
  }
  if (command === 'catalog' && args.length === 4) {
    const reviewer = validated(actor, handle, 'reviewer handle')
    const revision = validated(status?.toLowerCase(), /^[a-f0-9]{40}$/, 'merged commit SHA')
    const entry = validated(reason, catalogEntry, 'catalog entry')
    return `UPDATE symbol_report_reviews SET catalog_revision = ${revision}, catalog_entry = ${entry},
      catalog_reviewer = ${reviewer}, catalog_recorded_at = ${now}
      WHERE report_id = ${id} AND status = 'accepted' AND catalog_revision IS NULL
      RETURNING report_id, catalog_revision, catalog_entry, catalog_reviewer, catalog_recorded_at`
  }
  const claim = validated(actor?.toLowerCase(), uuid, 'claim ID')
  const owned = `report_id = ${id} AND status = 'pending' AND claim_id = ${claim} AND claim_until > ${now}`
  // Exact evidence matching ignores report IDs and capture references. Other
  // variants and conflicting thresholds require a human decision.
  const matchingImages = `json_extract(candidate.report_json, '$.icon.dataBase64') = json_extract(r.report_json, '$.icon.dataBase64')
    AND json_extract(candidate.report_json, '$.tooltip.dataBase64') = json_extract(r.report_json, '$.tooltip.dataBase64')`
  if (command === 'evidence' && args.length === 2) return `SELECT r.id, r.report_json, r.expires_at, r.withdrawn_at,
    (SELECT json_group_array(id) FROM (
      SELECT candidate.id FROM symbol_reports candidate
      WHERE candidate.id <> r.id AND ${active('candidate')} AND ${matchingImages}
      ORDER BY candidate.recorded_at, candidate.id LIMIT 10
    )) AS possible_duplicate_ids
    FROM symbol_reports r WHERE r.id = ${id} AND ${active('r')}
      AND EXISTS (SELECT 1 FROM symbol_report_reviews WHERE ${owned})`
  if (command === 'release' && args.length === 2) return `DELETE FROM symbol_report_reviews WHERE ${owned} RETURNING report_id`
  if (command === 'decide' && args.length === (reason === 'duplicate' ? 5 : 4)) {
    if (!Object.hasOwn(reasons, status) || !reasons[status].includes(reason)) throw new Error('Invalid review status or reason.')
    const duplicateOf = reason === 'duplicate' ? validated(duplicate?.toLowerCase(), uuid, 'canonical report ID') : 'NULL'
    const alreadyAccepted = `EXISTS (
      SELECT 1 FROM symbol_reports r, symbol_reports candidate
      JOIN symbol_report_reviews verified ON verified.report_id = candidate.id AND verified.status = 'accepted'
      WHERE r.id = ${id} AND candidate.id <> r.id
        ${reason === 'duplicate' ? `AND candidate.id = ${duplicateOf}` : ''}
        AND ${active('candidate')} AND ${matchingImages}
    )`
    const dedupe = status === 'accepted' ? `AND NOT ${alreadyAccepted}` : reason === 'duplicate' ? `AND ${alreadyAccepted}` : ''
    return `UPDATE symbol_report_reviews SET status = '${status}', reason = '${reason}',
      duplicate_of = ${duplicateOf}, decided_at = ${now}, claim_id = NULL, claim_until = NULL
      WHERE ${owned} AND ${liveReport} ${dedupe}
      RETURNING report_id, reviewer, status, reason, duplicate_of, decided_at`
  }
  throw new Error(usage)
}

function main() {
  const { values, positionals } = parseArgs({
    options: { config: { type: 'string' }, database: { type: 'string', default: 'DB' }, remote: { type: 'boolean' } },
    allowPositionals: true,
  })
  const [command, ...args] = positionals
  if (values.remote && !values.config) throw new Error('Specify the deployment Wrangler config for remote review.')
  const sql = reviewQuery(command, args)
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
  const result = spawnSync(process.execPath, [
    wrangler, 'd1', 'execute', values.database, values.remote ? '--remote' : '--local',
    ...(values.config ? ['--config', resolve(values.config)] : []), '--command', sql, '--json',
  ], {
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, WRANGLER_LOG_SANITIZE: 'true' },
  })
  if (result.error || result.status !== 0) throw new Error('Wrangler D1 failed. Check the selected config, migration and operator access.')
  let output
  try { output = JSON.parse(result.stdout) }
  catch { throw new Error('Wrangler returned an invalid D1 result.') }
  if (!Array.isArray(output) || !output.length || output.some(part => part.success !== true || !Array.isArray(part.results))) throw new Error('Wrangler returned an invalid D1 result.')
  if (command !== 'list' && !output.some(part => part.results.length)) throw new Error('No matching active claim, evidence or eligible report. Refresh the queue.')
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
