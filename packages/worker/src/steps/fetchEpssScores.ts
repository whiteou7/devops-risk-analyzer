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
  const totalBatches = Math.ceil(valid.length / BATCH_SIZE);
  console.log(`[epss] fetching scores for ${valid.length} CVE(s) in ${totalBatches} batch(es)`);

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = valid.slice(i, i + BATCH_SIZE);
    console.debug(`[epss] batch ${batchNum}/${totalBatches}: requesting ${batch.length} CVEs`);
    try {
      const url = `${EPSS_API}?cve=${batch.join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        console.error(`[epss] API returned HTTP ${res.status} for batch ${batchNum}`);
        console.warn(`[epss] API returned ${res.status} for batch starting at index ${i}`);
        continue;
      }
      const json = await res.json() as EpssApiResponse;
      const batchScores = json.data ?? [];
      console.debug(`[epss] batch ${batchNum}/${totalBatches}: received ${batchScores.length} score(s)`);
      for (const entry of batchScores) {
        const score = parseFloat(entry.epss);
        if (!isNaN(score)) result.set(entry.cve.toUpperCase(), score);
      }
    } catch (err) {
      console.error('[epss] fetch failed:', (err as Error).message);
      console.warn('[epss] fetch failed:', (err as Error).message);
    }
  }

  console.debug(`[epss] total scores resolved: ${result.size}/${valid.length}`);
  console.debug('[epss] full result:', JSON.stringify(Object.fromEntries(result), null, 2));
  return result;
}
