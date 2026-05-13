<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { submitAnalysis } from '../api/client.ts';
import { useJobStore } from '../stores/jobStore.ts';

const router = useRouter();
const store = useJobStore();

const repoUrl = ref('');
const githubToken = ref('');
const showToken = ref(false);
const loading = ref(false);
const formError = ref('');

async function submit(): Promise<void> {
  formError.value = '';
  if (!repoUrl.value.trim()) {
    formError.value = 'Repository URL is required';
    return;
  }
  loading.value = true;
  try {
    const job = await submitAnalysis({
      repoUrl: repoUrl.value.trim(),
      ...(githubToken.value ? { githubToken: githubToken.value } : {}),
    });
    store.setJob(job.jobId);
    await router.push(`/results/${job.jobId}`);
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
        Scan a GitHub repository for Dev and Ops phase risks.<br />
        Results are plotted on an impact × likelihood risk matrix.
      </p>
    </div>

    <form
      class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5"
      @submit.prevent="submit"
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
