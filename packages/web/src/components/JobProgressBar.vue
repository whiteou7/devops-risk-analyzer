<script setup lang="ts">
defineProps<{ progress: number; stage: string; status: string }>();
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
    <div class="flex items-center justify-between text-sm">
      <span class="text-slate-300 font-medium">
        {{ status === 'waiting' ? 'Queued…' : stage || 'Analyzing…' }}
      </span>
      <span class="text-slate-400">{{ progress }}%</span>
    </div>
    <div class="h-2 bg-slate-800 rounded-full overflow-hidden">
      <div
        class="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out"
        :style="{ width: `${progress}%` }"
      />
    </div>
    <p class="text-xs text-slate-500">
      This may take 3–5 minutes. SonarQube analysis runs in parallel with Trivy, Gitleaks, Hadolint, and Checkov.
    </p>
  </div>
</template>
