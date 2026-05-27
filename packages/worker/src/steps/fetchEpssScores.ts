const EPSS_API = 'https://api.first.org/data/v1/epss';
const BATCH_SIZE = 100;
const TIMEOUT_MS = 10_000;

interface EpssEntry {
  cve: string;
  epss: string;
}

interface EpssApiResponse {
  data?: EpssEntry[];
}

/**
 * Fetches EPSS exploitation-probability scores for a list of CVE IDs.
 * Returns a map of uppercase CVE ID → probability (0–1).
 * Missing or failed CVEs are simply absent from the map.
 */
export async function fetchEpssScores(cveIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const valid = cveIds.filter(id => /^CVE-\d{4}-\d+$/i.test(id));

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE);
    try {
      const url = `${EPSS_API}?cve=${batch.join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        console.warn(`[epss] API returned ${res.status} for batch starting at index ${i}`);
        continue;
      }
      const json = await res.json() as EpssApiResponse;
      for (const entry of json.data ?? []) {
        const score = parseFloat(entry.epss);
        if (!isNaN(score)) result.set(entry.cve.toUpperCase(), score);
      }
    } catch (err) {
      console.warn('[epss] fetch failed:', (err as Error).message);
    }
  }

  return result;
}
