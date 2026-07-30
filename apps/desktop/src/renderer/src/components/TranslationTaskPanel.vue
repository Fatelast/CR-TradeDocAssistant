<script setup lang="ts">
import {
  computed,
  ref,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  ExportPreflightResult,
  ReviewTranslationRowRequest,
  TranslationExportResult,
  TranslationTaskDetail,
  TranslationTaskRow,
  WorkerErrorCode,
} from '@rus-trade/shared';

const props = defineProps<{
  detail: TranslationTaskDetail
}>();
const emit = defineEmits<{
  updated: [detail: TranslationTaskDetail]
  error: [code: WorkerErrorCode, message: string]
}>();

const { t } = useI18n();
const isProcessing = ref(false);
const pauseRequested = ref(false);
const showCancelConfirmation = ref(false);
const savingRowId = ref<string>();
const reviewingRowId = ref<string>();
const rowFilter = ref<'all' | 'attention' | 'modified' | 'completed' | 'ignored'>('all');
const searchTerm = ref('');
const rowDrafts = ref<Record<string, string>>({});
const exportPreflight = ref<ExportPreflightResult>();
const exportResult = ref<TranslationExportResult>();
const isExporting = ref(false);

watch(
  () => props.detail,
  (detail) => {
    rowDrafts.value = Object.fromEntries(
      detail.rows.map((row) => [row.rowId, row.translation ?? '']),
    );
    if (detail.task.status !== 'completed') {
      exportPreflight.value = undefined;
      exportResult.value = undefined;
    }
  },
  { immediate: true },
);

const task = computed(() => props.detail.task);
const progressPercent = computed(() => Math.round(task.value.progress * 100));
const normalizedSearch = computed(() => searchTerm.value.trim().toLocaleLowerCase());
const filteredRows = computed(() => props.detail.rows.filter((row) => {
  const matchesFilter = (() => {
    if (rowFilter.value === 'attention') {
      return ['candidate', 'needs_manual', 'failed', 'pending'].includes(row.status);
    }
    if (rowFilter.value === 'modified') {
      return row.userModified;
    }
    if (rowFilter.value === 'completed') {
      return row.status === 'completed';
    }
    if (rowFilter.value === 'ignored') {
      return row.status === 'ignored';
    }
    return true;
  })();
  if (!matchesFilter || !normalizedSearch.value) {
    return matchesFilter;
  }
  return [
    row.sourceCell,
    row.containerValue,
    row.sourceText,
    row.translation,
  ].some((value) => String(value ?? '')
    .toLocaleLowerCase()
    .includes(normalizedSearch.value));
}));
const canProcess = computed(() => (
  task.value.pendingRows > 0
  && !['completed', 'cancelled'].includes(task.value.status)
));
const canPreflightExport = computed(() => (
  task.value.status === 'completed'
  && task.value.sourceFingerprintAvailable
  && !task.value.sourceRestricted
));
const statusLabel = computed(() => t({
  draft: '待开始',
  running: '处理中',
  paused: '已暂停',
  awaiting_manual: '待人工确认',
  completed: '任务已完成',
  cancelled: '任务已中止',
}[task.value.status]));

const applyResponse = (
  response: Awaited<ReturnType<typeof window.tradeAssistant.getTranslationTask>>,
): TranslationTaskDetail | undefined => {
  if (response.type === 'error') {
    emit('error', response.error.code, response.error.message);
    return undefined;
  }
  emit('updated', response.data);
  return response.data;
};

const changeState = async (
  action: 'pause' | 'resume' | 'cancel' | 'retry_failed',
): Promise<TranslationTaskDetail | undefined> => applyResponse(
  await window.tradeAssistant.changeTranslationTaskState({
    taskId: task.value.taskId,
    action,
  }),
);

const processRemainingBatches = async (
  currentDetail: TranslationTaskDetail,
): Promise<TranslationTaskDetail> => {
  if (currentDetail.task.pendingRows === 0 || pauseRequested.value) {
    return currentDetail;
  }

  const response = await window.tradeAssistant.processTranslationBatch({
    taskId: currentDetail.task.taskId,
    batchSize: 50,
  });
  const nextDetail = applyResponse(response);
  if (!nextDetail) {
    return currentDetail;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  return processRemainingBatches(nextDetail);
};

const processTask = async (): Promise<void> => {
  if (!canProcess.value || isProcessing.value) {
    return;
  }

  isProcessing.value = true;
  pauseRequested.value = false;
  let currentDetail = props.detail;

  if (currentDetail.task.status === 'paused') {
    const resumed = await changeState('resume');
    if (!resumed) {
      isProcessing.value = false;
      return;
    }
    currentDetail = resumed;
  }

  currentDetail = await processRemainingBatches(currentDetail);
  if (pauseRequested.value && currentDetail.task.status === 'running') {
    await changeState('pause');
  }
  isProcessing.value = false;
};

const pauseTask = (): void => {
  pauseRequested.value = true;
};

const retryFailed = async (): Promise<void> => {
  const detail = await changeState('retry_failed');
  if (detail?.task.pendingRows) {
    await processTask();
  }
};

const cancelTask = async (): Promise<void> => {
  pauseRequested.value = true;
  showCancelConfirmation.value = false;
  await changeState('cancel');
};

const saveRow = async (
  row: TranslationTaskRow,
  saveToCache: boolean,
): Promise<void> => {
  const translation = rowDrafts.value[row.rowId]?.trim();
  if (!translation) {
    emit('error', 'TRANSLATION_OUTPUT_INVALID', '译文不能为空');
    return;
  }

  savingRowId.value = row.rowId;
  applyResponse(await window.tradeAssistant.updateTranslationRow({
    taskId: task.value.taskId,
    rowId: row.rowId,
    translation,
    saveToCache,
  }));
  savingRowId.value = undefined;
};

const reviewRow = async (
  row: TranslationTaskRow,
  action: ReviewTranslationRowRequest['action'],
): Promise<void> => {
  reviewingRowId.value = row.rowId;
  applyResponse(await window.tradeAssistant.reviewTranslationRow({
    taskId: task.value.taskId,
    rowId: row.rowId,
    action,
  }));
  reviewingRowId.value = undefined;
};

const runExportPreflight = async (): Promise<void> => {
  exportResult.value = undefined;
  const response = await window.tradeAssistant.preflightExport({
    taskId: task.value.taskId,
  });
  if (response.type === 'error') {
    emit('error', response.error.code, response.error.message);
    exportPreflight.value = undefined;
    return;
  }
  exportPreflight.value = response.data;
};

const exportWorkbook = async (): Promise<void> => {
  isExporting.value = true;
  const selection = await window.tradeAssistant.exportTranslationTask({
    taskId: task.value.taskId,
  });
  isExporting.value = false;
  if (selection.cancelled || !selection.response) {
    return;
  }
  if (selection.response.type === 'error') {
    emit(
      'error',
      selection.response.error.code,
      selection.response.error.message,
    );
    return;
  }
  exportResult.value = selection.response.data;
};

const candidateSourceLabel = (row: TranslationTaskRow): string => t({
  existing: '原表已有译文',
  cache: '历史精确缓存',
  glossary: '本地术语候选',
  manual: '人工填写',
}[row.candidateSource ?? 'manual']);

const rowStatusLabel = (row: TranslationTaskRow): string => t({
  pending: '待处理',
  candidate: '待确认候选',
  needs_manual: '待人工填写',
  completed: '已确认',
  failed: '处理失败',
  ignored: '已忽略',
}[row.status]);
</script>

<template>
  <section class="translation-console">
    <header class="translation-console__header">
      <div>
        <span>04—05 / OFFLINE TRANSLATION · REVIEW · EXPORT</span>
        <h3>{{ t('翻译审核与安全导出') }}</h3>
        <p>
          {{ task.sourceFileName }} · {{ task.sheetName }} ·
          {{ task.translatorId }}
        </p>
      </div>
      <div
        class="task-state"
        :class="`task-state--${task.status}`"
      >
        <small>{{ t('任务状态') }}</small>
        <strong>{{ statusLabel }}</strong>
      </div>
    </header>

    <div class="task-progress">
      <div class="task-progress__copy">
        <span>{{ t('已确认进度') }}</span>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <div
        class="task-progress__track"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <i :style="{ width: `${progressPercent}%` }" />
      </div>
    </div>

    <dl class="task-metrics">
      <div>
        <dt>{{ t('总行数') }}</dt>
        <dd>{{ task.totalRows }}</dd>
      </div>
      <div>
        <dt>{{ t('待处理') }}</dt>
        <dd>{{ task.pendingRows }}</dd>
      </div>
      <div>
        <dt>{{ t('术语/缓存候选') }}</dt>
        <dd>{{ task.candidateRows }}</dd>
      </div>
      <div>
        <dt>{{ t('待人工填写') }}</dt>
        <dd>{{ task.manualRows }}</dd>
      </div>
      <div>
        <dt>{{ t('已确认') }}</dt>
        <dd>{{ task.completedRows }}</dd>
      </div>
      <div>
        <dt>{{ t('失败') }}</dt>
        <dd>{{ task.failedRows }}</dd>
      </div>
    </dl>

    <div class="task-toolbar task-toolbar--review">
      <div>
        <button
          v-if="canProcess && !isProcessing"
          class="primary-button"
          type="button"
          @click="processTask"
        >
          {{ task.status === 'paused' ? t('继续处理') : t('开始离线匹配') }}
        </button>
        <button
          v-if="isProcessing"
          class="secondary-button"
          type="button"
          @click="pauseTask"
        >
          {{ pauseRequested ? t('将在当前批次后暂停') : t('暂停') }}
        </button>
        <button
          v-if="task.failedRows > 0 && !isProcessing"
          class="secondary-button"
          type="button"
          @click="retryFailed"
        >
          {{ t('重试失败项') }}
        </button>
        <button
          v-if="
            !['completed', 'cancelled'].includes(task.status)
              && !showCancelConfirmation
          "
          class="text-button text-button--danger"
          type="button"
          :disabled="isProcessing"
          @click="showCancelConfirmation = true"
        >
          {{ t('中止任务') }}
        </button>
        <template v-if="showCancelConfirmation">
          <button
            class="text-button text-button--danger"
            type="button"
            @click="cancelTask"
          >
            {{ t('确认中止') }}
          </button>
          <button
            class="text-button"
            type="button"
            @click="showCancelConfirmation = false"
          >
            {{ t('返回') }}
          </button>
        </template>
      </div>

      <div class="review-query">
        <label>
          <span>{{ t('搜索审核行') }}</span>
          <input
            v-model="searchTerm"
            type="search"
            :placeholder="t('搜索箱号、坐标、原文或译文')"
          >
        </label>
        <label class="row-filter">
          <span>{{ t('行筛选') }}</span>
          <select v-model="rowFilter">
            <option value="all">{{ t('全部行') }}</option>
            <option value="attention">{{ t('需要处理') }}</option>
            <option value="modified">{{ t('人工修改') }}</option>
            <option value="completed">{{ t('仅已确认') }}</option>
            <option value="ignored">{{ t('仅已忽略') }}</option>
          </select>
        </label>
      </div>
    </div>

    <div
      v-if="task.status === 'completed'"
      class="completion-ribbon"
    >
      <strong>{{ t('任务已满足导出完成度要求') }}</strong>
      <span>{{ t('导出前仍会重新校验源文件指纹和 Excel 风险。') }}</span>
    </div>

    <div
      v-if="!task.sourceFingerprintAvailable"
      class="review-warning"
    >
      <strong>SOURCE_FINGERPRINT_MISSING</strong>
      <span>{{ t('该任务创建于 M3 之前，请重新导入源文件后再导出。') }}</span>
    </div>

    <div class="translation-rows">
      <article
        v-for="row in filteredRows"
        :key="row.rowId"
        class="translation-row"
        :class="[
          `translation-row--${row.status}`,
          { 'translation-row--modified': row.userModified },
        ]"
      >
        <div class="translation-row__meta">
          <code>{{ row.sourceCell }}</code>
          <span>{{ row.containerValue ?? '—' }}</span>
          <small>{{ candidateSourceLabel(row) }}</small>
          <em>{{ rowStatusLabel(row) }}</em>
          <b v-if="row.userModified">{{ t('已人工修改') }}</b>
        </div>

        <div class="translation-row__source">
          <small>RU / {{ t('原文') }}</small>
          <p>{{ row.sourceText }}</p>
          <span v-if="row.errorCode">{{ row.errorCode }}</span>
          <small
            v-if="row.initialTranslation"
            class="initial-candidate"
          >
            {{ t('初始候选') }}：{{ row.initialTranslation }}
          </small>
        </div>

        <div class="translation-row__target">
          <label :for="`translation-${row.rowId}`">
            ZH-CN / {{ t('审核译文') }}
          </label>
          <textarea
            :id="`translation-${row.rowId}`"
            v-model="rowDrafts[row.rowId]"
            rows="2"
            :disabled="task.status === 'cancelled'"
            :placeholder="t('输入中文译文')"
          />
          <div class="translation-row__actions">
            <button
              class="row-action"
              type="button"
              :disabled="savingRowId === row.rowId || task.status === 'cancelled'"
              @click="saveRow(row, false)"
            >
              {{ t('确认译文') }}
            </button>
            <button
              class="row-action row-action--cache"
              type="button"
              :disabled="savingRowId === row.rowId || task.status === 'cancelled'"
              @click="saveRow(row, true)"
            >
              {{ t('确认并加入缓存') }}
            </button>
            <button
              class="row-action row-action--quiet"
              type="button"
              :disabled="reviewingRowId === row.rowId || task.status === 'cancelled'"
              @click="reviewRow(row, 'ignore')"
            >
              {{ t('忽略该行') }}
            </button>
            <button
              v-if="row.initialTranslation"
              class="row-action row-action--quiet"
              type="button"
              :disabled="reviewingRowId === row.rowId || task.status === 'cancelled'"
              @click="reviewRow(row, 'restore_initial')"
            >
              {{ t('恢复初始候选') }}
            </button>
            <button
              class="row-action row-action--quiet"
              type="button"
              :disabled="reviewingRowId === row.rowId || task.status === 'cancelled'"
              @click="reviewRow(row, 'rematch')"
            >
              {{ t('离线重新匹配') }}
            </button>
          </div>
        </div>
      </article>

      <div
        v-if="filteredRows.length === 0"
        class="empty-review"
      >
        {{ t('没有符合当前条件的审核行') }}
      </div>
    </div>

    <section class="export-dock">
      <div class="export-dock__heading">
        <div>
          <span>05 / VERIFIED XLSX OUTPUT</span>
          <h4>{{ t('安全导出 Excel 副本') }}</h4>
        </div>
        <code>SHA-256 · REOPEN CHECK</code>
      </div>

      <div class="export-dock__controls">
        <p>
          {{ t('仅写入已确认译文，忽略行保持原值；原文件不会被覆盖。') }}
        </p>
        <div>
          <button
            class="secondary-button"
            type="button"
            :disabled="!canPreflightExport || isExporting"
            @click="runExportPreflight"
          >
            {{ t('执行导出预检') }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="!exportPreflight || isExporting"
            @click="exportWorkbook"
          >
            {{ isExporting ? t('正在导出并校验') : t('选择位置并导出') }}
          </button>
        </div>
      </div>

      <dl
        v-if="exportPreflight"
        class="export-ledger"
      >
        <div>
          <dt>{{ t('写入目标') }}</dt>
          <dd>
            {{ exportPreflight.sheetName }} ·
            {{ exportPreflight.targetColumnLetter }}
          </dd>
        </div>
        <div>
          <dt>{{ t('计划写入') }}</dt>
          <dd>{{ exportPreflight.writableRows }}</dd>
        </div>
        <div>
          <dt>{{ t('保持原值') }}</dt>
          <dd>
            {{ exportPreflight.unchangedRows + exportPreflight.ignoredRows }}
          </dd>
        </div>
        <div>
          <dt>{{ t('目标列策略') }}</dt>
          <dd>
            {{ exportPreflight.createsTargetColumn
              ? t('追加数据区右侧新列')
              : t('使用已有译文列') }}
          </dd>
        </div>
      </dl>

      <div
        v-if="exportResult"
        class="export-success"
      >
        <strong>{{ t('导出完成并通过重新打开校验') }}</strong>
        <span>{{ exportResult.outputPath }}</span>
        <code>SHA-256 {{ exportResult.outputSha256.slice(0, 16) }}…</code>
        <small>
          {{ t('写入') }} {{ exportResult.writtenRows }} ·
          {{ t('跳过') }} {{ exportResult.skippedRows }}
        </small>
      </div>
    </section>
  </section>
</template>
