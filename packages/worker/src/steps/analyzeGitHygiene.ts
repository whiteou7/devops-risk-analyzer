import { execa } from 'execa';
import { access } from 'fs/promises';
import path from 'path';
import type { GitHygieneMetrics } from '@devops-risk-analyzer/shared';

export async function analyzeGitHygiene(repoDir: string): Promise<GitHygieneMetrics> {
  const [uniqueAuthors, recentCommitCount, topContributorCommitShare, hasGitignore] =
    await Promise.all([
      countUniqueAuthors(repoDir),
      countRecentCommits(repoDir),
      getTopContributorShare(repoDir),
      checkGitignore(repoDir),
    ]);

  return { uniqueAuthors, recentCommitCount, hasGitignore, topContributorCommitShare };
}

async function countUniqueAuthors(repoDir: string): Promise<number> {
  try {
    const { stdout } = await execa(
      'git', ['log', '--format=%ae'],
      { cwd: repoDir, timeout: 10_000 },
    );
    const emails = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    return new Set(emails).size;
  } catch {
    return 1;
  }
}

async function countRecentCommits(repoDir: string): Promise<number> {
  try {
    const { stdout } = await execa(
      'git', ['rev-list', '--count', 'HEAD'],
      { cwd: repoDir, timeout: 10_000 },
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function getTopContributorShare(repoDir: string): Promise<number> {
  try {
    const { stdout } = await execa(
      'git', ['log', '--format=%ae'],
      { cwd: repoDir, timeout: 10_000 },
    );
    const emails = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (emails.length === 0) return 1;

    const counts = new Map<string, number>();
    for (const e of emails) counts.set(e, (counts.get(e) ?? 0) + 1);
    const max = Math.max(...counts.values());
    return max / emails.length;
  } catch {
    return 1;
  }
}

async function checkGitignore(repoDir: string): Promise<boolean> {
  try {
    await access(path.join(repoDir, '.gitignore'));
    return true;
  } catch {
    return false;
  }
}
