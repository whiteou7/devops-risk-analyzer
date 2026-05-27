import { execa } from 'execa';
import fs from 'node:fs/promises';

const CLONE_TIMEOUT_MS = 120_000;

/**
 * Clones a repository and optionally checks out a specific commit.
 * Returns the resolved full commit SHA (HEAD after checkout).
 */
export async function cloneRepo(
  repoUrl: string,
  destDir: string,
  githubToken?: string,
  depth: number = 1,
  commitSha?: string,
): Promise<string> {
  console.log(`[clone] cloning ${repoUrl}${commitSha ? `@${commitSha}` : ''} depth=${depth} → ${destDir}`);
  await fs.rm(destDir, { recursive: true, force: true });

  const cloneUrl = githubToken
    ? repoUrl.replace('https://', `https://${githubToken}@`)
    : repoUrl;

  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

  try {
    await execa('git', ['clone', '--depth', String(depth), cloneUrl, destDir], {
      reject: true,
      timeout: CLONE_TIMEOUT_MS,
      env: gitEnv,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('Authentication failed') || message.includes('Repository not found')) {
      const authErr = 'Repository is private or does not exist. Provide a githubToken.';
      console.error('[clone] auth error:', authErr);
      throw new Error(authErr);
    }

    if ((err as { timedOut?: boolean }).timedOut) {
      const timeoutErr = `Clone timed out after ${CLONE_TIMEOUT_MS / 1000}s — repository may be too large`;
      console.error('[clone] timeout:', timeoutErr);
      throw new Error(timeoutErr);
    }

    console.error('[clone] git clone failed:', message);
    throw new Error(`git clone failed: ${message}`);
  }

  if (commitSha) {
    console.debug(`[clone] checking out specific commit ${commitSha}`);
    try {
      // The commit may not be in the shallow history; fetch it explicitly.
      await execa('git', ['-C', destDir, 'fetch', '--depth', '1', 'origin', commitSha], {
        reject: true,
        timeout: CLONE_TIMEOUT_MS,
        env: gitEnv,
      });
      await execa('git', ['-C', destDir, 'checkout', commitSha], {
        reject: true,
        timeout: 30_000,
        env: gitEnv,
      });
    } catch {
      console.error(`[clone] commit ${commitSha} not found or could not be checked out`);
      throw new Error(`Commit ${commitSha} not found or could not be checked out`);
    }
  }

  const { stdout } = await execa('git', ['-C', destDir, 'rev-parse', 'HEAD'], {
    reject: true,
    timeout: 10_000,
    env: gitEnv,
  });

  const resolvedSha = stdout.trim();
  console.debug(`[clone] resolved HEAD → ${resolvedSha}`);
  return resolvedSha;
}
