import { execa } from 'execa';
import fs from 'node:fs/promises';

const CLONE_TIMEOUT_MS = 120_000;

export async function cloneRepo(
  repoUrl: string,
  destDir: string,
  githubToken?: string,
  depth: number = 1,
): Promise<void> {
  // Wipe destination if it already exists (stalled job retry scenario)
  await fs.rm(destDir, { recursive: true, force: true });

  const cloneUrl = githubToken
    ? repoUrl.replace('https://', `https://${githubToken}@`)
    : repoUrl;

  try {
    await execa('git', ['clone', '--depth', String(depth), cloneUrl, destDir], {
      reject: true,
      timeout: CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
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
