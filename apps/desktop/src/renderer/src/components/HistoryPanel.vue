<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  DataCleanupPreview,
  TaskHistoryDetail,
  TaskHistoryItem,
  TranslationTaskStatus,
  WorkerErrorCode,
} from '@rus-trade/shared';

const emit = defineEmits<{
  error: [code: WorkerErrorCode, message: string]
  openTask: [taskId: string]
}>();

const { t } = useI18n();
const items = ref<TaskHistoryItem[]>([]);
const selected = ref<TaskHistoryDetail>();
const search = ref('');
const status = ref<TranslationTaskStatus | ''>('');
const days = ref<7 | 30 | 90 | ''>('');
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const busy = ref(false);
const cleanupPreview = ref<DataCleanupPreview>();

const selectedCanDelete = computed(() => (
  selected.value?.task.status === 'completed'
  || selected.value?.task.status === 'cancelled'
));

const reportError = (code: WorkerErrorCode, message: string): void => {
  emit('error', code, message);
};

const formatDate = (value: string | null): string => (
  value
    ? new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
    : '—'
);

const loadHistory = async (nextPage = 1): Promise<void> => {
  busy.value = true;
  const response = await window.tradeAssistant.listTaskHistory({
    page: nextPage,
    pageSize: 20,
    search: search.value.trim(),
    status: status.value || undefined,
    days: days.value || undefined,
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  items.value = response.data.items;
  page.value = response.data.page;
  total.value = response.data.total;
  totalPages.value = response.data.totalPages;
};

const selectTask = async (taskId: string): Promise<void> => {
  cleanupPreview.value = undefined;
  const response = await window.tradeAssistant.getTaskHistoryDetail({ taskId });
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  selected.value = response.data;
};

const rerunTask = async (): Promise<void> => {
  if (!selected.value) {
    return;
  }
  busy.value = true;
  const response = await window.tradeAssistant.createRerunTask({
    taskId: selected.value.task.taskId,
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  emit('openTask', response.data.task.taskId);
};

const openFile = async (
  entityType: 'source' | 'export',
  entityId: string,
): Promise<void> => {
  const response = await window.tradeAssistant.openHistoryFile({
    entityType,
    entityId,
  });
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
  }
};

const previewDelete = async (): Promise<void> => {
  if (!selected.value || !selectedCanDelete.value) {
    return;
  }
  const response = await window.tradeAssistant.previewDataCleanup({
    scopes: ['selected_tasks'],
    taskIds: [selected.value.task.taskId],
    cacheKeys: [],
  });
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  cleanupPreview.value = response.data;
};

const confirmDelete = async (): Promise<void> => {
  if (!selected.value || !cleanupPreview.value) {
    return;
  }
  const response = await window.tradeAssistant.runDataCleanup({
    scopes: ['selected_tasks'],
    taskIds: [selected.value.task.taskId],
    cacheKeys: [],
    planHash: cleanupPreview.value.planHash,
  });
  if (response.type === 'error') {
    cleanupPreview.value = undefined;
    reportError(response.error.code, response.error.message);
    return;
  }
  selected.value = undefined;
  cleanupPreview.value = undefined;
  await loadHistory(Math.min(page.value, totalPages.value));
};

onMounted(() => {
  void loadHistory();
});
</script>

<template>
  <section class="module-ledger history-module">
    <header class="module-heading">
      <div>
        <p>04 / LOCAL TASK ARCHIVE</p>
        <h2>{{ t('任务与导出历史') }}</h2>
        <span>{{ t('历史记录只保存在本机；重新执行始终创建新任务。') }}</span>
      </div>
      <strong>{{ total }} {{ t('条记录') }}</strong>
    </header>

    <form
      class="module-filter"
      @submit.prevent="loadHistory(1)"
    >
      <label>
        <span>{{ t('搜索文件名') }}</span>
        <input
          v-model="search"
          type="search"
          :placeholder="t('输入 Excel 文件名')"
        >
      </label>
      <label>
        <span>{{ t('任务状态') }}</span>
        <select v-model="status">
          <option value="">{{ t('全部状态') }}</option>
          <option value="draft">{{ t('draft') }}</option>
          <option value="running">{{ t('running') }}</option>
          <option value="paused">{{ t('paused') }}</option>
          <option value="awaiting_manual">{{ t('awaiting_manual') }}</option>
          <option value="completed">{{ t('completed') }}</option>
          <option value="cancelled">{{ t('cancelled') }}</option>
        </select>
      </label>
      <label>
        <span>{{ t('时间范围') }}</span>
        <select v-model="days">
          <option value="">{{ t('全部时间') }}</option>
          <option :value="7">{{ t('最近 7 天') }}</option>
          <option :value="30">{{ t('最近 30 天') }}</option>
          <option :value="90">{{ t('最近 90 天') }}</option>
        </select>
      </label>
      <button
        class="primary-button"
        type="submit"
        :disabled="busy"
      >
        {{ t('查询历史') }}
      </button>
    </form>

    <div class="history-layout">
      <div class="history-list">
        <button
          v-for="item in items"
          :key="item.taskId"
          type="button"
          :class="{ active: selected?.task.taskId === item.taskId }"
          @click="selectTask(item.taskId)"
        >
          <span class="history-list__status">{{ t(item.status) }}</span>
          <strong>{{ item.sourceFileName }}</strong>
          <small>{{ item.sheetName }} · {{ item.completedRows }}/{{ item.totalRows }}</small>
          <code>{{ formatDate(item.updatedAt) }}</code>
          <em>{{ item.exportCount }} {{ t('次导出') }}</em>
        </button>
        <p
          v-if="!items.length && !busy"
          class="module-empty"
        >
          {{ t('没有符合条件的历史任务') }}
        </p>
      </div>

      <article
        v-if="selected"
        class="history-detail"
      >
        <header>
          <div>
            <span>TRACE / {{ selected.task.taskId.slice(0, 8) }}</span>
            <h3>{{ selected.task.sourceFileName }}</h3>
            <p>{{ selected.task.sourceFilePath }}</p>
          </div>
          <b>{{ t(selected.task.status) }}</b>
        </header>

        <dl class="detail-metrics">
          <div><dt>{{ t('工作表') }}</dt><dd>{{ selected.task.sheetName }}</dd></div>
          <div><dt>{{ t('总行数') }}</dt><dd>{{ selected.task.totalRows }}</dd></div>
          <div><dt>{{ t('已确认') }}</dt><dd>{{ selected.task.completedRows }}</dd></div>
          <div><dt>{{ t('术语版本') }}</dt><dd>v{{ selected.task.glossaryVersion }}</dd></div>
        </dl>

        <div class="history-actions">
          <button
            class="primary-button"
            type="button"
            :disabled="busy"
            @click="emit('openTask', selected.task.taskId)"
          >
            {{ t('打开任务') }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="busy || !selected.sourceExists"
            @click="openFile('source', selected.task.taskId)"
          >
            {{ t('打开源文件') }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="busy || !selected.sourceExists"
            @click="rerunTask"
          >
            {{ t('重新执行为新任务') }}
          </button>
          <button
            class="text-button text-button--danger"
            type="button"
            :disabled="busy || !selectedCanDelete"
            @click="previewDelete"
          >
            {{ t('删除历史记录') }}
          </button>
        </div>

        <section class="export-history">
          <div class="subsection-heading">
            <span>EXPORT LEDGER</span>
            <strong>{{ selected.exports.length }} {{ t('条导出记录') }}</strong>
          </div>
          <button
            v-for="record in selected.exports"
            :key="record.exportId"
            type="button"
            :disabled="!record.outputExists"
            @click="openFile('export', record.exportId)"
          >
            <span :class="`export-state export-state--${record.status}`">
              {{ record.status }}
            </span>
            <strong>{{ record.outputFileName }}</strong>
            <small>
              {{ record.writtenRows }} {{ t('行写入') }} ·
              {{ formatDate(record.completedAt) }}
            </small>
          </button>
          <p
            v-if="!selected.exports.length"
            class="module-empty"
          >
            {{ t('该任务尚无导出记录') }}
          </p>
        </section>

        <aside
          v-if="cleanupPreview"
          class="confirmation-dock"
        >
          <div>
            <strong>{{ t('确认只删除数据库历史记录？') }}</strong>
            <span>
              {{ cleanupPreview.taskRowCount }} {{ t('行任务') }} ·
              {{ cleanupPreview.exportCount }} {{ t('条导出记录') }}。
              {{ t('源文件和导出 Excel 不会被删除。') }}
            </span>
          </div>
          <button
            class="danger-button"
            type="button"
            @click="confirmDelete"
          >
            {{ t('确认删除记录') }}
          </button>
        </aside>
      </article>

      <div
        v-else
        class="history-placeholder"
      >
        <span>SELECT A RECORD</span>
        <strong>{{ t('选择左侧任务查看完整轨迹') }}</strong>
      </div>
    </div>

    <footer class="module-pagination">
      <button
        type="button"
        :disabled="page <= 1 || busy"
        @click="loadHistory(page - 1)"
      >
        {{ t('上一页') }}
      </button>
      <span>{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        :disabled="page >= totalPages || busy"
        @click="loadHistory(page + 1)"
      >
        {{ t('下一页') }}
      </button>
    </footer>
  </section>
</template>
