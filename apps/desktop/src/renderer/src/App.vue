<script setup lang="ts">
import {
  computed,
  onMounted,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  ImportRowsResult,
  TranslationTaskDetail,
  TranslationTaskSummary,
  WorkbookSelectionResult,
  WorkbookSession,
  WorkerErrorCode,
  WorkerInfo,
  WorksheetPreview,
} from '@rus-trade/shared';

import TranslationTaskPanel from './components/TranslationTaskPanel.vue';

type DiagnosticStatus = 'checking' | 'healthy' | 'error';
type ImportStatus =
  | 'idle'
  | 'opening'
  | 'previewing'
  | 'ready'
  | 'building'
  | 'creating';

const { t } = useI18n();
const diagnosticStatus = ref<DiagnosticStatus>('checking');
const workerInfo = ref<WorkerInfo>();
const importStatus = ref<ImportStatus>('idle');
const workbook = ref<WorkbookSession>();
const preview = ref<WorksheetPreview>();
const generatedRows = ref<ImportRowsResult>();
const activeTask = ref<TranslationTaskDetail>();
const recentTasks = ref<TranslationTaskSummary[]>([]);
const selectedSheetName = ref('');
const headerRow = ref(1);
const sourceColumn = ref<number | null>(null);
const containerColumn = ref<number | null>(null);
const targetColumn = ref<number | null>(null);
const errorCode = ref<WorkerErrorCode>();
const errorMessage = ref<string>();
const isDragging = ref(false);

const isBusy = computed(() => (
  ['opening', 'previewing', 'building', 'creating'].includes(importStatus.value)
));
const diagnosticCaption = computed(() => {
  if (diagnosticStatus.value === 'healthy') {
    return t('Worker 正常');
  }
  if (diagnosticStatus.value === 'error') {
    return t('Worker 异常');
  }
  return t('正在检测');
});
const selectedSheet = computed(() => (
  workbook.value?.sheets.find(
    (sheet) => sheet.name === selectedSheetName.value,
  )
));
const formattedFileSize = computed(() => {
  if (!workbook.value) {
    return '—';
  }
  return `${(workbook.value.fileSizeBytes / 1024 / 1024).toFixed(2)} MiB`;
});
const previewTableColumns = computed(() => preview.value?.columns ?? []);
const previewRows = computed(() => preview.value?.rows ?? []);
const generatedPreviewRows = computed(() => (
  generatedRows.value?.rows.slice(0, 20) ?? []
));
const isReviewStage = computed(() => (
  Boolean(activeTask.value)
  && activeTask.value?.task.pendingRows === 0
));
const stageKicker = computed(() => {
  if (!activeTask.value) {
    return 'M1 · WORKBOOK INTAKE';
  }
  return isReviewStage.value
    ? 'M3 · REVIEW & VERIFIED EXPORT'
    : 'M2 · OFFLINE TRANSLATION';
});
const stageTitle = computed(() => {
  if (!activeTask.value) {
    return t('Excel 结构预检');
  }
  return isReviewStage.value
    ? t('翻译审核与安全导出')
    : t('离线翻译任务');
});

const clearError = (): void => {
  errorCode.value = undefined;
  errorMessage.value = undefined;
};

const setError = (code: WorkerErrorCode, message: string): void => {
  errorCode.value = code;
  errorMessage.value = message;
};

const runDiagnostic = async (): Promise<void> => {
  diagnosticStatus.value = 'checking';

  try {
    const response = await window.tradeAssistant.getWorkerInfo();
    if (response.type === 'completed') {
      workerInfo.value = response.data;
      diagnosticStatus.value = 'healthy';
      return;
    }
    diagnosticStatus.value = 'error';
  } catch {
    diagnosticStatus.value = 'error';
  }
};

const loadRecentTasks = async (): Promise<void> => {
  const response = await window.tradeAssistant.listTranslationTasks({
    includeCompleted: true,
    limit: 8,
  });
  if (response.type === 'error') {
    setError(response.error.code, response.error.message);
    return;
  }
  recentTasks.value = response.data.tasks;
};

const openTask = async (taskId: string): Promise<void> => {
  clearError();
  const response = await window.tradeAssistant.getTranslationTask({ taskId });
  if (response.type === 'error') {
    setError(response.error.code, response.error.message);
    return;
  }
  activeTask.value = response.data;
};

const handleTaskUpdated = (detail: TranslationTaskDetail): void => {
  activeTask.value = detail;
  void loadRecentTasks();
};

const handleTaskError = (code: WorkerErrorCode, message: string): void => {
  setError(code, message);
};

const loadPreview = async (): Promise<void> => {
  if (!workbook.value || !selectedSheetName.value) {
    return;
  }

  clearError();
  generatedRows.value = undefined;
  importStatus.value = 'previewing';
  const response = await window.tradeAssistant.previewWorkbookSheet({
    workbookId: workbook.value.workbookId,
    sheetName: selectedSheetName.value,
    headerRow: headerRow.value,
  });

  if (response.type === 'error') {
    setError(response.error.code, response.error.message);
    importStatus.value = 'ready';
    return;
  }

  preview.value = response.data;
  sourceColumn.value = response.data.recommendations.sourceColumn;
  containerColumn.value = response.data.recommendations.containerColumn;
  targetColumn.value = response.data.recommendations.targetColumn;
  importStatus.value = 'ready';
};

const applyWorkbookSelection = async (
  result: WorkbookSelectionResult,
): Promise<void> => {
  if (result.cancelled) {
    importStatus.value = workbook.value ? 'ready' : 'idle';
    return;
  }

  if (!result.response) {
    setError('FILE_SELECTION_FAILED', '未获得文件解析结果');
    importStatus.value = workbook.value ? 'ready' : 'idle';
    return;
  }

  if (result.response.type === 'error') {
    setError(result.response.error.code, result.response.error.message);
    importStatus.value = workbook.value ? 'ready' : 'idle';
    return;
  }

  const session = result.response.data;
  activeTask.value = undefined;
  workbook.value = session;
  selectedSheetName.value = session.defaultSheetName;
  headerRow.value = session.sheets.find(
    (sheet) => sheet.name === session.defaultSheetName,
  )?.recommendedHeaderRow ?? 1;
  preview.value = undefined;
  generatedRows.value = undefined;
  await loadPreview();
};

const selectWorkbook = async (): Promise<void> => {
  clearError();
  importStatus.value = 'opening';
  await applyWorkbookSelection(
    await window.tradeAssistant.selectWorkbook(),
  );
};

const startNewWorkbook = async (): Promise<void> => {
  activeTask.value = undefined;
  await selectWorkbook();
};

const handleDrop = async (event: DragEvent): Promise<void> => {
  event.preventDefault();
  isDragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (!file) {
    return;
  }

  clearError();
  importStatus.value = 'opening';
  await applyWorkbookSelection(
    await window.tradeAssistant.openDroppedWorkbook(file),
  );
};

const handleSheetChange = async (): Promise<void> => {
  headerRow.value = selectedSheet.value?.recommendedHeaderRow ?? 1;
  await loadPreview();
};

const buildRows = async (): Promise<void> => {
  if (!workbook.value || !sourceColumn.value) {
    setError('SOURCE_COLUMN_INVALID', '请选择原文列');
    return;
  }

  clearError();
  importStatus.value = 'building';
  const response = await window.tradeAssistant.buildWorkbookRows({
    workbookId: workbook.value.workbookId,
    sheetName: selectedSheetName.value,
    headerRow: headerRow.value,
    sourceColumn: sourceColumn.value,
    containerColumn: containerColumn.value,
    targetColumn: targetColumn.value,
  });

  if (response.type === 'error') {
    setError(response.error.code, response.error.message);
    importStatus.value = 'ready';
    return;
  }

  generatedRows.value = response.data;
  importStatus.value = 'ready';
};

const createTranslationTask = async (): Promise<void> => {
  if (!workbook.value || !sourceColumn.value || !generatedRows.value) {
    setError('TASK_ROWS_EMPTY', '请先生成稳定数据行');
    return;
  }

  clearError();
  importStatus.value = 'creating';
  const response = await window.tradeAssistant.createTranslationTask({
    workbookId: workbook.value.workbookId,
    sheetName: selectedSheetName.value,
    headerRow: headerRow.value,
    sourceColumn: sourceColumn.value,
    containerColumn: containerColumn.value,
    targetColumn: targetColumn.value,
    sourceLanguage: 'ru',
    targetLanguage: 'zh-CN',
  });
  importStatus.value = 'ready';

  if (response.type === 'error') {
    setError(response.error.code, response.error.message);
    return;
  }
  activeTask.value = response.data;
  await loadRecentTasks();
};

onMounted(() => {
  document.title = t('中俄贸易文件助手');
  void runDiagnostic();
  void loadRecentTasks();
});
</script>

<template>
  <main
    class="workspace-shell"
    @dragenter.prevent="isDragging = true"
    @dragover.prevent="isDragging = true"
    @dragleave.self="isDragging = false"
    @drop="handleDrop"
  >
    <div
      class="ambient-grid"
      aria-hidden="true"
    />

    <header class="masthead">
      <div class="brand-lockup">
        <span class="brand-seal">CR</span>
        <div>
          <p class="eyebrow">
            LOCAL-FIRST · TRADE OPERATIONS
          </p>
          <h1>{{ t('中俄贸易文件助手') }}</h1>
          <p class="brand-subtitle">
            {{ t('Excel 导入、离线翻译与审核导出工作台') }}
          </p>
        </div>
      </div>

      <div class="system-strip">
        <span
          class="status-dot"
          :class="`status-dot--${diagnosticStatus}`"
        />
        <div>
          <small>{{ t('系统基线') }} · M3</small>
          <strong>{{ diagnosticCaption }}</strong>
        </div>
        <code>{{ workerInfo?.workerVersion ?? '—' }}</code>
      </div>
    </header>

    <section class="stage-shell">
      <aside class="stage-rail">
        <p>WORK SEQUENCE</p>
        <ol>
          <li :class="{ active: !workbook && !activeTask }">
            <span>01</span>
            <div>
              <strong>{{ t('选择文件') }}</strong>
              <small>LOCAL XLSX</small>
            </div>
          </li>
          <li :class="{ active: workbook && !generatedRows && !activeTask }">
            <span>02</span>
            <div>
              <strong>{{ t('确认结构') }}</strong>
              <small>SHEET / HEADER</small>
            </div>
          </li>
          <li :class="{ active: generatedRows && !activeTask }">
            <span>03</span>
            <div>
              <strong>{{ t('生成数据行') }}</strong>
              <small>ROW MAPPING</small>
            </div>
          </li>
          <li :class="{ active: activeTask && !isReviewStage }">
            <span>04</span>
            <div>
              <strong>{{ t('离线翻译') }}</strong>
              <small>GLOSSARY / MANUAL</small>
            </div>
          </li>
          <li :class="{ active: isReviewStage }">
            <span>05</span>
            <div>
              <strong>{{ t('审核导出') }}</strong>
              <small>REVIEW / VERIFIED XLSX</small>
            </div>
          </li>
        </ol>

        <div class="limit-card">
          <span>{{ t('当前模式') }}</span>
          <strong>{{ t('完全离线') }}</strong>
          <small>NO FILE UPLOAD / NO API</small>
        </div>
      </aside>

      <div class="stage-content">
        <section class="stage-heading">
          <div>
            <p class="section-kicker">
              {{ stageKicker }}
            </p>
            <h2>{{ stageTitle }}</h2>
          </div>
          <button
            class="secondary-button"
            type="button"
            :disabled="isBusy"
            @click="startNewWorkbook"
          >
            {{ workbook || activeTask ? t('新建文件任务') : t('选择 Excel 文件') }}
          </button>
        </section>

        <section
          v-if="recentTasks.length && !activeTask"
          class="resume-shelf"
        >
          <div>
            <span>{{ t('本机最近任务') }}</span>
            <strong>{{ recentTasks.length }}</strong>
          </div>
          <button
            v-for="task in recentTasks"
            :key="task.taskId"
            type="button"
            @click="openTask(task.taskId)"
          >
            <span>{{ task.sourceFileName }}</span>
            <small>
              {{ task.completedRows }}/{{ task.totalRows }} ·
              {{ t(task.status) }}
            </small>
          </button>
        </section>

        <button
          v-if="!workbook && !activeTask"
          class="drop-zone"
          :class="{ 'drop-zone--active': isDragging }"
          type="button"
          :disabled="isBusy"
          @click="selectWorkbook"
        >
          <span class="drop-mark">XLSX</span>
          <strong>
            {{ isBusy ? t('正在执行兼容性预检') : t('选择或拖入 Excel 文件') }}
          </strong>
          <small>{{ t('文件与译文只保存在本机，不会上传。') }}</small>
        </button>

        <div
          v-if="errorCode"
          class="error-callout"
          role="alert"
        >
          <strong>{{ errorCode }}</strong>
          <span>{{ t(errorMessage ?? '未知错误') }}</span>
        </div>

        <template v-if="workbook && !activeTask">
          <section class="file-ledger">
            <div class="file-primary">
              <span class="file-type">XLSX</span>
              <div>
                <strong>{{ workbook.fileName }}</strong>
                <small>{{ workbook.filePath }}</small>
              </div>
            </div>
            <dl>
              <div>
                <dt>{{ t('文件大小') }}</dt>
                <dd>{{ formattedFileSize }}</dd>
              </div>
              <div>
                <dt>{{ t('工作表') }}</dt>
                <dd>{{ workbook.sheets.length }}</dd>
              </div>
              <div>
                <dt>{{ t('预检状态') }}</dt>
                <dd :class="workbook.restricted ? 'restricted' : 'clear'">
                  {{ workbook.restricted ? t('受限预览') : t('可继续') }}
                </dd>
              </div>
            </dl>
          </section>

          <section
            v-if="workbook.risks.length"
            class="risk-strip"
          >
            <div>
              <span>{{ t('兼容性提示') }}</span>
              <strong>{{ workbook.risks.length }}</strong>
            </div>
            <ul>
              <li
                v-for="risk in workbook.risks"
                :key="risk.code"
                :class="`risk-${risk.severity}`"
              >
                <code>{{ risk.code }}</code>
                {{ t(risk.message) }}
              </li>
            </ul>
          </section>

          <section class="configuration-panel">
            <div class="configuration-heading">
              <div>
                <span>02 / STRUCTURE MAP</span>
                <h3>{{ t('确认工作表与字段') }}</h3>
              </div>
              <small>{{ t('推荐结果可手动修正') }}</small>
            </div>

            <div class="configuration-grid">
              <label>
                <span>{{ t('工作表') }}</span>
                <select
                  v-model="selectedSheetName"
                  :disabled="isBusy"
                  @change="handleSheetChange"
                >
                  <option
                    v-for="sheet in workbook.sheets"
                    :key="sheet.name"
                    :value="sheet.name"
                  >
                    {{ sheet.name }}{{ sheet.state === 'visible' ? '' : ` · ${t('隐藏')}` }}
                  </option>
                </select>
                <small>
                  {{ selectedSheet?.rowCount ?? 0 }} {{ t('行') }} ·
                  {{ selectedSheet?.columnCount ?? 0 }} {{ t('列') }}
                </small>
              </label>

              <label>
                <span>{{ t('表头所在行') }}</span>
                <input
                  v-model.number="headerRow"
                  type="number"
                  min="1"
                  :max="selectedSheet?.rowCount ?? 1"
                  :disabled="isBusy"
                  @change="loadPreview"
                >
                <small>
                  {{ t('候选') }}：
                  {{ selectedSheet?.headerCandidateRows.join(' / ') }}
                </small>
              </label>

              <label>
                <span>{{ t('箱号列') }}</span>
                <select
                  v-model="containerColumn"
                  :disabled="isBusy || !preview"
                >
                  <option :value="null">{{ t('未选择') }}</option>
                  <option
                    v-for="column in previewTableColumns"
                    :key="column.index"
                    :value="column.index"
                  >
                    {{ column.letter }} · {{ column.label }}
                  </option>
                </select>
              </label>

              <label>
                <span>{{ t('原文列') }} *</span>
                <select
                  v-model="sourceColumn"
                  :disabled="isBusy || !preview"
                >
                  <option :value="null">{{ t('请选择') }}</option>
                  <option
                    v-for="column in previewTableColumns"
                    :key="column.index"
                    :value="column.index"
                  >
                    {{ column.letter }} · {{ column.label }}
                  </option>
                </select>
              </label>

              <label>
                <span>{{ t('已有译文列') }}</span>
                <select
                  v-model="targetColumn"
                  :disabled="isBusy || !preview"
                >
                  <option :value="null">{{ t('当前不存在') }}</option>
                  <option
                    v-for="column in previewTableColumns"
                    :key="column.index"
                    :value="column.index"
                  >
                    {{ column.letter }} · {{ column.label }}
                  </option>
                </select>
              </label>
            </div>
          </section>

          <section
            v-if="preview"
            class="preview-panel"
          >
            <div class="preview-heading">
              <div>
                <span>PREVIEW / {{ preview.sheetName }}</span>
                <strong>{{ preview.totalRows }} {{ t('条数据') }}</strong>
              </div>
              <button
                class="primary-button"
                type="button"
                :disabled="isBusy || !sourceColumn"
                @click="buildRows"
              >
                {{ importStatus === 'building' ? t('正在生成') : t('生成稳定数据行') }}
              </button>
            </div>

            <div class="table-viewport">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th
                      v-for="column in previewTableColumns"
                      :key="column.index"
                    >
                      <span>{{ column.letter }}</span>
                      {{ column.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in previewRows"
                    :key="row.excelRowNumber"
                  >
                    <th>{{ row.excelRowNumber }}</th>
                    <td
                      v-for="(value, index) in row.values"
                      :key="`${row.excelRowNumber}-${index}`"
                    >
                      {{ value ?? '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section
            v-if="generatedRows"
            class="rows-panel"
          >
            <div class="rows-summary">
              <span>03 / ROW MAPPING COMPLETE</span>
              <strong>{{ generatedRows.totalRows }}</strong>
              <p>{{ t('条原文数据已建立稳定行号与单元格映射。') }}</p>
            </div>
            <div class="mapped-list">
              <article
                v-for="row in generatedPreviewRows"
                :key="row.rowId"
              >
                <code>{{ row.sourceCell }}</code>
                <span>{{ row.containerValue ?? '—' }}</span>
                <p>{{ row.sourceText }}</p>
                <small>{{ t('等待建立离线任务') }}</small>
              </article>
            </div>
            <div class="translation-launch">
              <div>
                <span>LOCAL PIPELINE READY</span>
                <strong>{{ t('术语匹配、精确缓存与人工填写') }}</strong>
                <small>{{ t('已有译文不会被覆盖，未命中内容保持待人工填写。') }}</small>
              </div>
              <button
                class="primary-button"
                type="button"
                :disabled="isBusy"
                @click="createTranslationTask"
              >
                {{ importStatus === 'creating' ? t('正在建立任务') : t('建立离线翻译任务') }}
              </button>
            </div>
          </section>
        </template>

        <TranslationTaskPanel
          v-if="activeTask"
          :detail="activeTask"
          @updated="handleTaskUpdated"
          @error="handleTaskError"
        />
      </div>
    </section>

    <div
      v-if="isDragging"
      class="drop-overlay"
      aria-hidden="true"
    >
      <strong>{{ t('释放文件开始本地预检') }}</strong>
    </div>

    <footer class="workspace-footer">
      <span>RUS-TRADE-FILE-ASSISTANT / M3</span>
      <span>REVIEW LEDGER · VERIFIED XLSX · PROTOCOL 1.0</span>
    </footer>
  </main>
</template>
