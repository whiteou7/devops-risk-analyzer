import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCANNER_TIMEOUT_MS = 300_000; // 5 min

/**
 * Run sonar-scanner against repoDir. The properties file (which contains the
 * auth token) is written to a temp path outside the repo so that gitleaks
 * never sees it.
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
    `sonar.projectBaseDir=${repoDir}`,
    'sonar.sources=.',
    `sonar.host.url=${sonarUrl}`,
    `sonar.token=${sonarToken}`,
    // Disable SCM on shallow clones — git blame is unreliable and slow
    'sonar.scm.disabled=true',
    'sonar.sourceEncoding=UTF-8',
  ].join('\n');

  // Write properties to a temp file outside the repo so gitleaks never sees the token.
  const propsPath = path.join(os.tmpdir(), `sonar-${projectKey}-${Date.now()}.properties`);
  console.log(`[sonar-scanner] starting scan — projectKey=${projectKey} dir=${repoDir}`);
  await fs.writeFile(propsPath, propsContent, 'utf8');
  console.debug('[sonar-scanner] sonar-project.properties written');

  let stdout = '';
  let stderr = '';

  console.debug('[sonar-scanner] executing sonar-scanner process');
  try {
    const result = await execa('sonar-scanner', ['-Dproject.settings=' + propsPath], {
      cwd: repoDir,
      timeout: SCANNER_TIMEOUT_MS,
      reject: true,
      env: { ...process.env },
    });
    stdout = result.stdout;
    stderr = result.stderr;
    console.debug('[sonar-scanner] process exited successfully');
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; timedOut?: boolean; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';

    if (e.timedOut) {
      console.error(`[sonar-scanner] timed out after ${SCANNER_TIMEOUT_MS / 1000}s`);
      await fs.unlink(propsPath).catch(() => undefined);
      throw new Error(`sonar-scanner timed out after ${SCANNER_TIMEOUT_MS / 1000}s`);
    }

    console.error('[sonar-scanner] failed:', stderr || e.message);
    await fs.unlink(propsPath).catch(() => undefined);
    throw new Error(
      `sonar-scanner failed:\n${stderr || e.message}`,
    );
  }

  await fs.unlink(propsPath).catch(() => undefined);

  // sonar-scanner prints the CE task URL in stdout:
  // INFO: More about the report processing at http://sonarqube:9000/api/ce/task?id=AXXXX
  const match = /api\/ce\/task\?id=([A-Za-z0-9_-]+)/.exec(stdout + stderr);

  if (!match) {
    console.error('[sonar-scanner] CE task ID not found in output');
    throw new Error(
      `sonar-scanner completed but CE task ID not found in output.\nstdout: ${stdout}`,
    );
  }

  console.log(`[sonar-scanner] CE task submitted — taskId=${match[1]}`);
  return match[1];
}
