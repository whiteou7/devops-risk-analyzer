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
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (repo_url, commit_sha)
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
    WHERE repo_url = ${repoUrl} AND commit_sha = ${commitSha}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  // postgres.js should auto-parse JSONB, but guard against it returning a string
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
): Promise<void> {
  const sql = getDb();
  const resultJson = JSON.stringify(result);
  await sql`
    INSERT INTO analysis_results (repo_url, commit_sha, project_key, result)
    VALUES (${repoUrl}, ${commitSha}, ${projectKey}, ${resultJson}::jsonb)
    ON CONFLICT (repo_url, commit_sha) DO UPDATE SET result = EXCLUDED.result
  `;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = undefined;
  }
}
