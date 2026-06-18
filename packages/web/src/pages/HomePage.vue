<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { submitAnalysis, submitTimeline, uploadDocs } from '../api/client.ts';
import { useJobStore } from '../stores/jobStore.ts';
const router = useRouter();
const store = useJobStore();

const repoUrl = ref('');
const selectedSha = ref('');
const githubToken = ref('');
const showToken = ref(false);
const loading = ref(false);
const formError = ref('');
const useCached = ref(true);
const includeTimeline = ref(false);
const docFiles = ref<File[]>([]);
const docHash = ref('');
const docUploadStatus = ref<'idle' | 'uploading' | 'done' | 'error'>('idle');
const docUploadError = ref('');

interface CommitOption {
  sha: string;
  message: string;
  date: string;
  author: string;
}

const commits = ref<CommitOption[]>([]);
const commitsLoading = ref(false);
const commitsError = ref('');

let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

async function fetchCommits(url: string, token: string): Promise<void> {
  const parsed = parseGithubRepo(url);
  if (!parsed) {
    commits.value = [];
    commitsError.value = '';
    return;
  }

  commitsLoading.value = true;
  commitsError.value = '';
  commits.value = [];
  selectedSha.value = '';

  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=30`,
      { headers },
    );

    if (!res.ok) {
      if (res.status === 404) commitsError.value = 'Repository not found or private — add a token below.';
      else if (res.status === 401 || res.status === 403) commitsError.value = 'Access denied — check your GitHub token.';
      else commitsError.value = `GitHub API error: ${res.status}`;
      return;
    }

    const data = await res.json();
    commits.value = data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message.split('\n')[0].slice(0, 72),
      date: new Date(c.commit.author.date).toLocaleDateString(),
      author: c.commit.author.name,
    }));
  } catch {
    commitsError.value = 'Failed to reach GitHub API.';
  } finally {
    commitsLoading.value = false;
  }
}

watch(repoUrl, (url: string) => {
  if (fetchDebounceTimer) clearTimeout(fetchDebounceTimer);
  if (!parseGithubRepo(url)) {
    commits.value = [];
    commitsError.value = '';
    selectedSha.value = '';
    return;
  }
  fetchDebounceTimer = setTimeout(() => fetchCommits(url, githubToken.value), 600);
});

watch(githubToken, (token: string) => {
  if (commitsError.value && repoUrl.value) {
    fetchCommits(repoUrl.value, token);
  }
});

function onDocFilesChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  docFiles.value = input.files ? Array.from(input.files) : [];
  docHash.value = '';
  docUploadStatus.value = 'idle';
  docUploadError.value = '';
}

async function submit(): Promise<void> {
  formError.value = '';
  if (!repoUrl.value.trim()) {
    formError.value = 'Repository URL is required';
    return;
  }
  loading.value = true;
  try {
    // Upload docs first if files are selected and not yet uploaded
    if (docFiles.value.length > 0 && !docHash.value) {
      docUploadStatus.value = 'uploading';
      docUploadError.value = '';
      try {
        const filePayloads = await Promise.all(
          docFiles.value.map(f => f.text().then(content => ({ name: f.name, content }))),
        );
        const result = await uploadDocs(filePayloads);
        docHash.value = result.docHash;
        docUploadStatus.value = 'done';
      } catch (err) {
        docUploadStatus.value = 'error';
        docUploadError.value = (err as Error).message;
        loading.value = false;
        return;
      }
    }

    const response = await submitAnalysis({
      repoUrl: repoUrl.value.trim(),
      ...(selectedSha.value ? { commitSha: selectedSha.value } : {}),
      ...(githubToken.value ? { githubToken: githubToken.value } : {}),
      ...(!useCached.value ? { forceRefresh: true } : {}),
      ...(docHash.value ? { docHash: docHash.value } : {}),
    });

    if (response.data.cached) {
      store.setJob('cached');
      store.applyCompleted(response.data.result);
    } else {
      store.setJob(response.data.id);
    }

    let timelineId: string | undefined;
    if (includeTimeline.value) {
      try {
        const tlResponse = await submitTimeline({
          repoUrl: repoUrl.value.trim(),
          ...(githubToken.value ? { githubToken: githubToken.value } : {}),
          ...(!useCached.value ? { forceRefresh: true } : {}),
        });
        store.setTimeline(tlResponse.data.id);
        timelineId = tlResponse.data.id;
      } catch {
        // Timeline submission failure is non-fatal; continue to results
      }
    }

    const query = timelineId ? { timeline: timelineId } : {};
    if (response.data.cached) {
      await router.push({ path: '/results/cached', query });
    } else {
      await router.push({ path: `/results/${response.data.id}`, query });
    }
  } catch (err) {
    formError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[70vh] gap-8">
    <div class="text-center">
      <h1 class="text-4xl font-bold text-white mb-3">DevOps Risk Analyzer</h1>
      <p class="text-slate-400 text-lg max-w-xl">
        Analyze a GitHub repository across four artifact types — Source Code, Testing, Deployment, and Documentation.<br />
        Results are plotted on an impact × likelihood risk matrix per DevOps phase.
      </p>
    </div>

    <form
      class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5"
      @submit.prevent="submit()"
    >
      <div class="space-y-1.5">
        <label class="text-sm font-medium text-slate-300">GitHub Repository URL</label>
        <input
          v-model="repoUrl"
          type="url"
          placeholder="https://github.com/owner/repo"
          class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-sm font-medium text-slate-300">
          Commit
          <span class="text-slate-500 font-normal">(optional — defaults to latest)</span>
        </label>

        <div v-if="commitsLoading" class="flex items-center gap-2 text-slate-400 text-sm py-2">
          <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Fetching commits…
        </div>

        <p v-else-if="commitsError" class="text-amber-400 text-sm">{{ commitsError }}</p>

        <select
          v-else-if="commits.length"
          v-model="selectedSha"
          class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Latest (HEAD)</option>
          <option v-for="c in commits" :key="c.sha" :value="c.sha">
            {{ c.sha.slice(0, 7) }} · {{ c.message }} ({{ c.author }}, {{ c.date }})
          </option>
        </select>

        <p v-else-if="!repoUrl" class="text-slate-500 text-sm italic">
          Enter a repo URL to load commits.
        </p>
      </div>

      <div class="space-y-1.5">
        <button
          type="button"
          class="text-sm text-slate-400 hover:text-slate-200 transition-colors"
          @click="showToken = !showToken"
        >
          {{ showToken ? '− Hide' : '+ Add' }} GitHub token (private repos)
        </button>
        <input
          v-if="showToken"
          v-model="githubToken"
          type="password"
          placeholder="ghp_..."
          class="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-sm font-medium text-slate-300">
          Documentation
          <span class="text-slate-500 font-normal">(optional — local folder)</span>
        </label>
        <label
          class="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 cursor-pointer hover:border-slate-500 transition-colors"
        >
          <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span class="text-sm truncate">
            {{ docFiles.length > 0 ? `${docFiles.length} file(s) selected` : 'Select a folder…' }}
          </span>
          <input
            type="file"
            class="hidden"
            webkitdirectory
            multiple
            accept=".txt,.md,.rst,.csv,.json,.yaml,.yml"
            @change="onDocFilesChange"
          />
        </label>
        <p v-if="docUploadStatus === 'uploading'" class="text-xs text-blue-400 animate-pulse">Uploading documentation…</p>
        <p v-else-if="docUploadStatus === 'done'" class="text-xs text-emerald-400">Documentation uploaded ✓</p>
        <p v-else-if="docUploadStatus === 'error'" class="text-xs text-red-400">{{ docUploadError }}</p>
        <p v-else class="text-xs text-slate-500">Select a local folder of text documents to analyze for DevOps risks using AI.</p>
      </div>

      <label class="flex items-center gap-2 text-sm text-slate-300 select-none cursor-pointer">
        <input
          v-model="useCached"
          type="checkbox"
          class="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
        />
        Use cached result if available
      </label>

      <label class="flex items-center gap-2 text-sm text-slate-300 select-none cursor-pointer">
        <input
          v-model="includeTimeline"
          type="checkbox"
          class="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
        />
        Include risk trend graph
        <span class="text-slate-500 font-normal">(analyzes past month's commits)</span>
      </label>

      <p v-if="formError" class="text-red-400 text-sm">{{ formError }}</p>

      <button
        type="submit"
        :disabled="loading"
        class="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
      >
        {{ loading ? 'Submitting…' : 'Analyze Repository' }}
      </button>
    </form>
  </div>
</template>
