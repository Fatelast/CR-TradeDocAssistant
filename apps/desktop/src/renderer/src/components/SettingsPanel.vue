<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  AppSettings,
  DataCleanupPreview,
  LogCleanupPreview,
  WorkerErrorCode,
} from '@rus-trade/shared';

const emit = defineEmits<{
  error: [code: WorkerErrorCode, message: string]
}>();

const { t } = useI18n();
const settings = ref<AppSettings>();
const busy = ref(false);
const cleanupPlan = ref<DataCleanupPreview>();
const logCleanupPlan = ref<LogCleanupPreview>();
const saved = ref(false);
const form = reactive<{
  defaultOutputDirectory: string | null
  batchSize: number
  logLevel: 'info' | 'error'
}>({
  defaultOutputDirectory: null,
  batchSize: 50,
  logLevel: 'info',
});

const reportError = (code: WorkerErrorCode, message: string): void => {
  emit('error', code, message);
};

const applySettings = (value: AppSettings): void => {
  settings.value = value;
  form.defaultOutputDirectory = value.defaultOutputDirectory;
  form.batchSize = value.batchSize;
  form.logLevel = value.logLevel;
};

const loadSettings = async (): Promise<void> => {
  const response = await window.tradeAssistant.getAppSettings();
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  applySettings(response.data);
};

const selectOutputDirectory = async (): Promise<void> => {
  const result = await window.tradeAssistant.selectOutputDirectory();
  if (!result.cancelled && result.directoryPath) {
    form.defaultOutputDirectory = result.directoryPath;
    saved.value = false;
  }
};

const saveSettings = async (): Promise<void> => {
  busy.value = true;
  saved.value = false;
  const response = await window.tradeAssistant.updateAppSettings({
    defaultOutputDirectory: form.defaultOutputDirectory,
    batchSize: form.batchSize,
    logLevel: form.logLevel,
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  applySettings(response.data);
  saved.value = true;
};

const exportSettings = async (): Promise<void> => {
  const result = await window.tradeAssistant.exportAppSettings();
  if (result.cancelled || !result.response) {
    return;
  }
  if (result.response.type === 'error') {
    reportError(result.response.error.code, result.response.error.message);
  }
};

const previewExpiredCleanup = async (): Promise<void> => {
  const [dataResponse, logResponse] = await Promise.all([
    window.tradeAssistant.previewDataCleanup({
      scopes: ['expired_tasks', 'expired_cache'],
      taskIds: [],
      cacheKeys: [],
    }),
    window.tradeAssistant.previewLogCleanup(),
  ]);
  if (dataResponse.type === 'error') {
    reportError(dataResponse.error.code, dataResponse.error.message);
    return;
  }
  if (logResponse.type === 'error') {
    reportError(logResponse.error.code, logResponse.error.message);
    return;
  }
  cleanupPlan.value = dataResponse.data;
  logCleanupPlan.value = logResponse.data;
};

const runExpiredCleanup = async (): Promise<void> => {
  if (!cleanupPlan.value) {
    return;
  }
  const response = await window.tradeAssistant.runDataCleanup({
    scopes: ['expired_tasks', 'expired_cache'],
    taskIds: [],
    cacheKeys: [],
    planHash: cleanupPlan.value.planHash,
  });
  if (response.type === 'error') {
    cleanupPlan.value = undefined;
    reportError(response.error.code, response.error.message);
    return;
  }
  if (logCleanupPlan.value) {
    const logResponse = await window.tradeAssistant.runLogCleanup({
      planHash: logCleanupPlan.value.planHash,
    });
    if (logResponse.type === 'error') {
      cleanupPlan.value = undefined;
      logCleanupPlan.value = undefined;
      reportError(logResponse.error.code, logResponse.error.message);
      return;
    }
  }
  cleanupPlan.value = undefined;
  logCleanupPlan.value = undefined;
};

const formatBytes = (sizeBytes: number): string => (
  sizeBytes < 1_024
    ? `${sizeBytes} B`
    : `${(sizeBytes / 1_024).toFixed(1)} KiB`
);

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <section class="module-ledger settings-module">
    <header class="module-heading">
      <div>
        <p>04 / LOCAL POLICY & MAINTENANCE</p>
        <h2>{{ t('设置与本地维护') }}</h2>
        <span>{{ t('不配置在线翻译；所有策略只影响本机任务。') }}</span>
      </div>
      <code>CONFIG / v1</code>
    </header>

    <div class="settings-grid">
      <form
        class="settings-card settings-card--primary"
        @submit.prevent="saveSettings"
      >
        <div class="subsection-heading">
          <span>WORKFLOW DEFAULTS</span>
          <strong>{{ t('工作流默认值') }}</strong>
        </div>

        <label>
          <span>{{ t('默认输出目录') }}</span>
          <div class="path-control">
            <input
              :value="form.defaultOutputDirectory ?? t('跟随源文件或系统文档目录')"
              readonly
            >
            <button
              class="secondary-button"
              type="button"
              @click="selectOutputDirectory"
            >
              {{ t('选择目录') }}
            </button>
          </div>
          <button
            v-if="form.defaultOutputDirectory"
            class="text-button"
            type="button"
            @click="form.defaultOutputDirectory = null; saved = false"
          >
            {{ t('恢复系统默认') }}
          </button>
        </label>

        <label>
          <span>{{ t('离线处理批次大小') }}</span>
          <input
            v-model.number="form.batchSize"
            type="number"
            min="1"
            max="200"
          >
          <small>{{ t('允许范围 1～200；默认 50。') }}</small>
        </label>

        <label>
          <span>{{ t('日志级别') }}</span>
          <select v-model="form.logLevel">
            <option value="info">INFO · {{ t('运行信息与错误') }}</option>
            <option value="error">ERROR · {{ t('仅错误') }}</option>
          </select>
          <small>{{ t('日志会隐藏文件路径并按日轮转。') }}</small>
        </label>

        <div class="settings-actions">
          <button
            class="primary-button"
            type="submit"
            :disabled="busy"
          >
            {{ busy ? t('正在保存') : t('保存设置') }}
          </button>
          <button
            class="secondary-button"
            type="button"
            @click="exportSettings"
          >
            {{ t('导出设置 JSON') }}
          </button>
          <span v-if="saved">{{ t('设置已保存') }}</span>
        </div>
      </form>

      <section class="settings-card retention-card">
        <div class="subsection-heading">
          <span>FIXED RETENTION</span>
          <strong>{{ t('固定保留策略') }}</strong>
        </div>
        <dl>
          <div>
            <dt>{{ t('终态任务记录') }}</dt>
            <dd>{{ settings?.retention.taskDays ?? 90 }}<small>{{ t('天') }}</small></dd>
          </div>
          <div>
            <dt>{{ t('精确翻译缓存') }}</dt>
            <dd>{{ settings?.retention.cacheDays ?? 180 }}<small>{{ t('天') }}</small></dd>
          </div>
          <div>
            <dt>{{ t('应用日志') }}</dt>
            <dd>{{ settings?.retention.logDays ?? 30 }}<small>{{ t('天') }}</small></dd>
          </div>
        </dl>
        <p>
          {{ t('应用启动时至多每 24 小时自动清理一次。业务源文件和导出 Excel 永远不在清理范围内。') }}
        </p>
        <button
          class="secondary-button"
          type="button"
          @click="previewExpiredCleanup"
        >
          {{ t('预览当前过期数据') }}
        </button>
      </section>

      <section class="settings-card offline-card">
        <div class="subsection-heading">
          <span>NETWORK BOUNDARY</span>
          <strong>{{ t('完全离线边界') }}</strong>
        </div>
        <strong>NO API · NO UPLOAD</strong>
        <p>{{ t('M4 不提供在线翻译配置，也不会把 Excel、术语、缓存或日志发送到网络。') }}</p>
      </section>
    </div>

    <aside
      v-if="cleanupPlan"
      class="confirmation-dock settings-cleanup"
    >
      <div>
        <strong>{{ t('确认清理已过期的本地数据库记录？') }}</strong>
        <span>
          {{ cleanupPlan.taskCount }} {{ t('个终态任务') }} ·
          {{ cleanupPlan.taskRowCount }} {{ t('行任务') }} ·
          {{ cleanupPlan.cacheCount }} {{ t('条缓存') }} ·
          {{ logCleanupPlan?.fileCount ?? 0 }} {{ t('个过期日志') }}
          ({{ formatBytes(logCleanupPlan?.sizeBytes ?? 0) }})。
          {{ t('不会删除任何 Excel 文件。') }}
        </span>
      </div>
      <button
        class="danger-button"
        type="button"
        @click="runExpiredCleanup"
      >
        {{ t('确认清理过期数据') }}
      </button>
    </aside>
  </section>
</template>
