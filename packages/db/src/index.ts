import postgres from 'postgres';
import type { AnalysisResult } from '@devops-risk-analyzer/shared';

let _sql: ReturnType<typeof postgres> | undefined;

function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL environment variable is not set');
    _sql = postgres(url, { max: 10, idle_timeout: 30 });
  }
  return _sql;
}

export async function migrate(): Promise<void> {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS analysis_results (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      repo_url    TEXT        NOT NULL,
      commit_sha  TEXT        NOT NULL,
      project_key TEXT        NOT NULL,
      result      JSONB       NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Add doc_hash column (migration — no-op if already present)
  await sql`
    ALTER TABLE analysis_results ADD COLUMN IF NOT EXISTS doc_hash TEXT NOT NULL DEFAULT ''
  `;

  // Drop old two-column unique constraint if it still exists
  await sql`
    ALTER TABLE analysis_results DROP CONSTRAINT IF EXISTS analysis_results_repo_url_commit_sha_key
  `;

  // Unique index that includes doc_hash so the same repo+commit can be cached
  // with and without documentation
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS analysis_results_unique_idx
    ON analysis_results (repo_url, commit_sha, doc_hash)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS doc_content (
      hash        TEXT        PRIMARY KEY,
      content     TEXT        NOT NULL,
      file_names  TEXT[]      NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export interface CachedAnalysis {
  id: string;
  repoUrl: string;
  commitSha: string;
  projectKey: string;
  result: AnalysisResult;
  createdAt: Date;
}

export async function findAnalysis(
  repoUrl: string,
  commitSha: string,
  docHash = '',
): Promise<CachedAnalysis | null> {
  const sql = getDb();
  const rows = await sql<CachedAnalysis[]>`
    SELECT
      id,
      repo_url    AS "repoUrl",
      commit_sha  AS "commitSha",
      project_key AS "projectKey",
      result,
      created_at  AS "createdAt"
    FROM analysis_results
    WHERE repo_url = ${repoUrl} AND commit_sha = ${commitSha} AND doc_hash = ${docHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const result = typeof row.result === 'string'
    ? (JSON.parse(row.result as unknown as string) as AnalysisResult)
    : row.result;
  return { ...row, result };
}

export async function saveAnalysis(
  repoUrl: string,
  commitSha: string,
  projectKey: string,
  result: AnalysisResult,
  docHash = '',
): Promise<void> {
  const sql = getDb();
  const resultJson = JSON.stringify(result);
  await sql`
    INSERT INTO analysis_results (repo_url, commit_sha, project_key, result, doc_hash)
    VALUES (${repoUrl}, ${commitSha}, ${projectKey}, ${resultJson}::jsonb, ${docHash})
    ON CONFLICT (repo_url, commit_sha, doc_hash) DO UPDATE SET result = EXCLUDED.result
  `;
}

export interface DocContent {
  hash: string;
  content: string;
  fileNames: string[];
}

export async function findDocContent(hash: string): Promise<DocContent | null> {
  const sql = getDb();
  const rows = await sql<{ hash: string; content: string; file_names: string[] }[]>`
    SELECT hash, content, file_names FROM doc_content WHERE hash = ${hash} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { hash: row.hash, content: row.content, fileNames: row.file_names };
}

export async function saveDocContent(
  hash: string,
  content: string,
  fileNames: string[],
): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO doc_content (hash, content, file_names)
    VALUES (${hash}, ${content}, ${sql.array(fileNames)})
    ON CONFLICT (hash) DO NOTHING
  `;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = undefined;
  }
}
