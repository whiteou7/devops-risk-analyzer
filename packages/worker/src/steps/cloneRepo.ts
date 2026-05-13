import { execa } from 'execa';
import fs from 'node:fs/promises';

const CLONE_TIMEOUT_MS = 120_000;

/**
 * Clone a GitHub repo to a local directory.
 * Uses --depth 1 (shallow clone) to minimize time and disk usage.
 */
export async function cloneRepo(
  repoUrl: string,
  destDir: string,
  githubToken?: string,
): Promise<void> {
  // Wipe destination if it already exists (stalled job retry scenario)
  await fs.rm(destDir, { recursive: true, force: true });

  const cloneUrl = githubToken
    ? repoUrl.replace('https://', `https://${githubToken}@`)
    : repoUrl;

  const clonePromise = execa('git', ['clone', '--depth', '1', cloneUrl, destDir], {
    reject: true,
    timeout: CLONE_TIMEOUT_MS,
    env: {
      ...process.env,
      // Prevent git from prompting for credentials (would hang)
      GIT_TERMINAL_PROMPT: '0',
    },
  });

  try {
    await clonePromise;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('Authentication failed') || message.includes('Repository not found')) {
      throw new Error(
        'Repository is private or does not exist. Provide a githubToken.',
      );
    }

    if ((err as { timedOut?: boolean }).timedOut) {
      throw new Error(`Clone timed out after ${CLONE_TIMEOUT_MS / 1000}s — repository may be too large`);
    }

    throw new Error(`git clone failed: ${message}`);
  }
}
