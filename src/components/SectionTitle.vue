<script setup lang="ts">
defineProps<{
  title: string;
  suffix?: string;
}>();
</script>

<template>
  <div class="section-title">
    <span>{{ title }}</span>
    <small v-if="suffix">{{ suffix }}</small>
  </div>
</template>

<style scoped>
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid var(--ai-primary);
  color: #222;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
}

.section-title small {
  color: var(--ai-text-3);
  font-size: 11px;
  font-weight: 400;
}
</style>
