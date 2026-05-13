import { execa } from 'execa';
import fs from 'node:fs/promises';
import path from 'node:path';

const SCANNER_TIMEOUT_MS = 300_000; // 5 min

/**
 * Write sonar-project.properties into the repo dir and run sonar-scanner.
 * Returns the CE task ID parsed from scanner stdout.
 */
export async function runSonarScanner(
  repoDir: string,
  projectKey: string,
): Promise<string> {
  const sonarUrl = process.env.SONAR_URL;
  const sonarToken = process.env.SONAR_TOKEN;

  if (!sonarUrl) throw new Error('SONAR_URL environment variable is required');
  if (!sonarToken) throw new Error('SONAR_TOKEN environment variable is required');

  const propsContent = [
    `sonar.projectKey=${projectKey}`,
    `sonar.projectName=${projectKey}`,
    'sonar.sources=.',
    `sonar.host.url=${sonarUrl}`,
    `sonar.token=${sonarToken}`,
    // Disable SCM on shallow clones — git blame is unreliable and slow
    'sonar.scm.disabled=true',
    'sonar.sourceEncoding=UTF-8',
  ].join('\n');

  await fs.writeFile(path.join(repoDir, 'sonar-project.properties'), propsContent, 'utf8');

  // Ignore the generated properties file so Gitleaks doesn't flag the token we wrote into it.
  const ignorePath = path.join(repoDir, '.gitleaksignore');
  const ignoreEntry = 'sonar-project.properties\n';
  try {
    const existing = await fs.readFile(ignorePath, 'utf8');
    if (!existing.includes('sonar-project.properties')) {
      await fs.appendFile(ignorePath, ignoreEntry, 'utf8');
    }
  } catch {
    await fs.writeFile(ignorePath, ignoreEntry, 'utf8');
  }

  let stdout = '';
  let stderr = '';

  try {
    const result = await execa('sonar-scanner', [], {
      cwd: repoDir,
      timeout: SCANNER_TIMEOUT_MS,
      reject: true,
      env: { ...process.env },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; timedOut?: boolean; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';

    if (e.timedOut) {
      throw new Error(`sonar-scanner timed out after ${SCANNER_TIMEOUT_MS / 1000}s`);
    }

    throw new Error(
      `sonar-scanner failed:\n${stderr || e.message}`,
    );
  }

  // sonar-scanner prints the CE task URL in stdout:
  // INFO: More about the report processing at http://sonarqube:9000/api/ce/task?id=AXXXX
  const match = /api\/ce\/task\?id=([A-Za-z0-9_-]+)/.exec(stdout + stderr);

  if (!match) {
    throw new Error(
      `sonar-scanner completed but CE task ID not found in output.\nstdout: ${stdout}`,
    );
  }

  return match[1];
}
