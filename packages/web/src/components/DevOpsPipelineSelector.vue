<script setup lang="ts">
import type { RiskPhase } from '@devops-risk-analyzer/shared';
import pipelineSvg from '../assets/devops-pipeline.svg?url';

type PhaseFilter = RiskPhase | 'overall';

const props = defineProps<{ modelValue: PhaseFilter }>();
const emit = defineEmits<{ 'update:modelValue': [phase: PhaseFilter] }>();

const phases = [
  { phase: 'plan'    as RiskPhase, x:  820, y: 320 },
  { phase: 'code'    as RiskPhase, x:  495, y: 165 },
  { phase: 'build'   as RiskPhase, x:  138, y: 493 },
  { phase: 'test'    as RiskPhase, x:  518, y: 840 },
  { phase: 'release' as RiskPhase, x: 1002, y: 480 },
  { phase: 'deploy'  as RiskPhase, x: 1528, y: 158 },
  { phase: 'operate' as RiskPhase, x: 1835, y: 530 },
  { phase: 'monitor' as RiskPhase, x: 1400, y: 837 },
] as const;
</script>

<template>
  <div class="flex flex-col gap-2">
    <svg
      viewBox="0 0 1982 1020"
      class="w-full"
      style="max-height: 210px;"
      role="group"
      aria-label="DevOps pipeline phase selector"
    >
      <image :href="pipelineSvg" x="0" y="0" width="1982" height="1020"/>

      <g
        v-for="node in phases"
        :key="node.phase"
        class="cursor-pointer"
        @click="emit('update:modelValue', node.phase)"
        role="button"
        :aria-label="`Select ${node.phase} phase`"
        :aria-pressed="modelValue === node.phase"
      >
        <circle
          v-if="modelValue === node.phase"
          :cx="node.x"
          :cy="node.y"
          r="110"
          fill="none"
          stroke="white"
          stroke-width="10"
          opacity="0.35"
        />
        <circle :cx="node.x" :cy="node.y" r="180" fill="transparent"/>
      </g>
    </svg>

    <div class="flex justify-center">
      <button
        @click="emit('update:modelValue', 'overall')"
        :class="modelValue === 'overall'
          ? 'bg-blue-600 text-white border-blue-500'
          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:border-slate-600'"
        class="px-5 py-1.5 rounded-lg text-sm font-medium border transition-colors"
        aria-label="View overall risk across all phases"
      >
        Overall
      </button>
    </div>
  </div>
</template>
