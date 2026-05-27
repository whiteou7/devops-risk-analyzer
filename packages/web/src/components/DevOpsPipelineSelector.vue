<script setup lang="ts">
import type { RiskPhase } from '@devops-risk-analyzer/shared';
import pipelineSvg from '../assets/devops-pipeline.svg?url';

const props = defineProps<{ modelValue: RiskPhase }>();
const emit = defineEmits<{ 'update:modelValue': [phase: RiskPhase] }>();

/**
 * Positions derived from path transform clusters in the source SVG (1982×1020).
 * Each (x, y) is the visual centre of that label's glyph cluster.
 */
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
  <!--
    Outer SVG matches the source file's coordinate space (1982×1020).
    The pipeline artwork is embedded as an <image>; interactive labels sit on top.
  -->
  <svg
    viewBox="0 0 1982 1020"
    class="w-full"
    style="max-height: 210px;"
    role="group"
    aria-label="DevOps pipeline phase selector"
  >
    <!-- The vectorised pipeline artwork -->
    <image :href="pipelineSvg" x="0" y="0" width="1982" height="1020"/>

    <!-- Interactive phase labels -->
    <g
      v-for="node in phases"
      :key="node.phase"
      class="cursor-pointer"
      @click="emit('update:modelValue', node.phase)"
      role="button"
      :aria-label="`Select ${node.phase} phase`"
      :aria-pressed="modelValue === node.phase"
    >
      <!-- Large invisible hit area -->
      <circle :cx="node.x" :cy="node.y" r="180" fill="transparent"/>
    </g>
  </svg>
</template>
