<script setup lang="ts">
import { computed } from 'vue';
import type { FilePreviewData } from '@/types/review';

// 预览内容仍以后端短时地址为准；本组件只复刻原型中的双侧栏外壳和证据位置导航。
const props = defineProps<{
  preview: FilePreviewData | null;
  loading: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  close: [];
  navigate: [direction: 'previous' | 'next'];
}>();

const pager = computed(() => {
  if (!props.preview) return '第 0 处 / 共 0 处';
  const position = props.preview.currentPosition;
  return `第 ${position.positionIndex} 处 / 共 ${position.positionCount} 处`;
});

const sectionText = computed(() => props.preview?.currentPosition.locationText || '正文');
</script>

<template>
  <section class="preview-panel" role="dialog" aria-modal="true" aria-label="投标文件原文">
    <header class="preview-header">
      <span>{{ title || preview?.fileName || '投标文件原文' }}</span>
      <button type="button" title="关闭" aria-label="关闭原文预览" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="preview-toolbar">
      <button
        type="button"
        class="position-button"
        :disabled="!preview?.previousPosition || loading"
        @click="emit('navigate', 'previous')"
      >
        ‹ 上一处
      </button>
      <span>{{ pager }}</span>
      <button
        type="button"
        class="position-button"
        :disabled="!preview?.nextPosition || loading"
        @click="emit('navigate', 'next')"
      >
        下一处 ›
      </button>
      <strong class="preview-section" :title="sectionText">{{ sectionText }}</strong>
    </div>

    <div class="preview-content">
      <a-spin v-if="loading" tip="正在取得预览地址…" />
      <iframe
        v-else-if="preview"
        :src="preview.previewUrl"
        :title="preview.fileName"
        referrerpolicy="no-referrer"
      />
    </div>

    <footer class="preview-footer">
      <button type="button" class="close-button" @click="emit('close')">关闭</button>
    </footer>
  </section>
</template>

<style scoped>
.preview-panel {
  position: fixed;
  z-index: 1101;
  top: 0;
  right: min(560px, 92vw);
  bottom: 0;
  display: flex;
  width: min(560px, calc(100vw - min(560px, 92vw)));
  min-width: 0;
  flex-direction: column;
  border-left: 1px solid var(--ai-border);
  background: #fff;
}

.preview-header {
  display: flex;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--ai-border);
  padding: 0 16px;
  color: #333;
  font-size: 14px;
}

.preview-header > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-header button {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  margin-left: auto;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #999;
  font-family: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.preview-header button:hover {
  background: var(--ai-border-light);
  color: #333;
}

.preview-toolbar {
  display: flex;
  height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--ai-border-light);
  background: var(--ai-table-head);
  padding: 0 16px;
  color: var(--ai-text-2);
  font-size: 12px;
}

.preview-toolbar > span {
  flex-shrink: 0;
  white-space: nowrap;
}

.position-button {
  display: inline-flex;
  height: 20px;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--ai-primary);
  border-radius: 2px;
  background: #fff;
  padding: 0 8px;
  color: var(--ai-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s;
}

.position-button:hover:not(:disabled) {
  border-color: var(--ai-primary-hover);
  background: var(--ai-primary-tint);
  color: var(--ai-primary-hover);
}

.position-button:disabled {
  opacity: 0.6;
  cursor: default;
}

.preview-section {
  min-width: 0;
  overflow: hidden;
  margin-left: auto;
  color: var(--ai-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-content {
  display: grid;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  place-items: center;
  background: var(--ai-bg);
}

.preview-content iframe {
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--ai-bg);
}

.preview-footer {
  display: flex;
  height: 52px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid var(--ai-border);
  background: #fff;
  padding: 0 16px;
}

.close-button {
  height: 30px;
  border: 1px solid var(--ai-border);
  border-radius: 2px;
  background: #fff;
  padding: 0 18px;
  color: #333;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.close-button:hover {
  border-color: var(--ai-primary);
  color: var(--ai-primary);
}

@media (max-width: 640px) {
  .preview-panel {
    right: 0;
    width: 100%;
  }

  .preview-section {
    display: none;
  }
}
</style>
