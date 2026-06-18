import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK_DOCS_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../mock-docs');

/** Fetch plain-text content from a publicly shared Google Drive / Docs URL.
 *  Supports `mock://<filename>` for local mock-doc testing. */
export async function fetchGoogleDriveContent(driveUrl: string): Promise<string> {
  // Local mock-doc shortcut: mock://01-user-acceptance-checklist-incomplete.txt
  if (driveUrl.startsWith('mock://')) {
    const filename = driveUrl.slice('mock://'.length);
    if (!filename || filename.includes('..') || filename.includes('/')) {
      throw new Error(`Invalid mock doc filename: ${filename}`);
    }
    return fs.readFile(path.join(MOCK_DOCS_DIR, filename), 'utf-8');
  }

  // Folder URLs can't be fetched as a single document
  if (/\/folders\//.test(driveUrl)) {
    throw new Error(
      'Google Drive folder URL detected — please share the link to an individual document (open the file in Google Docs and copy its URL), not the folder.',
    );
  }

  const fileId = extractFileId(driveUrl);
  if (!fileId) throw new Error(`Cannot extract file ID from Google Drive URL: ${driveUrl}`);

  // Google Docs → export as plain text
  if (driveUrl.includes('docs.google.com/document')) {
    return fetchUrl(`https://docs.google.com/document/d/${fileId}/export?format=txt`);
  }

  // Google Sheets → export as CSV
  if (driveUrl.includes('docs.google.com/spreadsheets')) {
    return fetchUrl(`https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`);
  }

  // Generic Drive file (PDF, docx, etc.) — attempt direct download
  return fetchUrl(`https://drive.google.com/uc?export=download&id=${fileId}`);
}

function extractFileId(url: string): string | null {
  // https://drive.google.com/file/d/{id}/view
  // https://docs.google.com/document/d/{id}/edit
  // https://docs.google.com/spreadsheets/d/{id}/edit
  const slashD = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (slashD) return slashD[1] ?? null;

  // https://drive.google.com/open?id={id}
  const queryId = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (queryId) return queryId[1] ?? null;

  return null;
}

async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DevOpsRiskAnalyzer/1.0' },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Google Drive fetch failed: ${res.status} ${res.statusText} — ensure the document is shared as "Anyone with the link"`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  // Guard against accidentally downloading large binary files
  if (contentType.startsWith('application/octet-stream') || contentType.startsWith('video/') || contentType.startsWith('image/')) {
    throw new Error('Google Drive file appears to be a binary — only text documents (Google Docs, plain text, CSV) are supported');
  }

  const text = await res.text();
  if (text.length > 200_000) {
    // Truncate to keep token usage reasonable
    return text.slice(0, 200_000) + '\n[Document truncated at 200,000 characters]';
  }
  return text;
}
