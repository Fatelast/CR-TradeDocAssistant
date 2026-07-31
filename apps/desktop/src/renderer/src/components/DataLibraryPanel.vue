<script setup lang="ts">
import {
  onMounted,
  reactive,
  ref,
} from 'vue';
import { useI18n } from 'vue-i18n';

import type {
  DataCleanupPreview,
  DataCleanupRequest,
  GlossaryImportPreflightResult,
  GlossaryTerm,
  TranslationCacheItem,
  WorkerErrorCode,
} from '@rus-trade/shared';

const emit = defineEmits<{
  error: [code: WorkerErrorCode, message: string]
}>();

const { t } = useI18n();
const activeTab = ref<'glossary' | 'cache'>('glossary');
const glossaryItems = ref<GlossaryTerm[]>([]);
const categories = ref<string[]>([]);
const glossaryVersion = ref(1);
const glossarySearch = ref('');
const categoryFilter = ref('');
const enabledFilter = ref<'' | 'true' | 'false'>('');
const glossaryPage = ref(1);
const glossaryPages = ref(1);
const glossaryTotal = ref(0);
const cacheItems = ref<TranslationCacheItem[]>([]);
const cacheSearch = ref('');
const cachePage = ref(1);
const cachePages = ref(1);
const cacheTotal = ref(0);
const selectedCacheKeys = ref<string[]>([]);
const importPlan = ref<GlossaryImportPreflightResult>();
const cleanupPlan = ref<DataCleanupPreview>();
const cleanupRequest = ref<DataCleanupRequest>();
const busy = ref(false);

const termForm = reactive({
  termId: '',
  sourceText: '',
  targetText: '',
  category: '通用',
  exactMatch: true,
  caseSensitive: false,
  enabled: true,
  note: '',
});

const reportError = (code: WorkerErrorCode, message: string): void => {
  emit('error', code, message);
};

const loadGlossary = async (nextPage = 1): Promise<void> => {
  busy.value = true;
  const response = await window.tradeAssistant.listGlossaryTerms({
    page: nextPage,
    pageSize: 20,
    search: glossarySearch.value.trim(),
    category: categoryFilter.value || undefined,
    enabled: enabledFilter.value === ''
      ? undefined
      : enabledFilter.value === 'true',
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  glossaryItems.value = response.data.items;
  categories.value = response.data.categories;
  glossaryVersion.value = response.data.glossaryVersion;
  glossaryPage.value = response.data.page;
  glossaryPages.value = response.data.totalPages;
  glossaryTotal.value = response.data.total;
};

const loadCache = async (nextPage = 1): Promise<void> => {
  busy.value = true;
  const response = await window.tradeAssistant.listTranslationCache({
    page: nextPage,
    pageSize: 20,
    search: cacheSearch.value.trim(),
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  cacheItems.value = response.data.items;
  cachePage.value = response.data.page;
  cachePages.value = response.data.totalPages;
  cacheTotal.value = response.data.total;
  selectedCacheKeys.value = selectedCacheKeys.value.filter((key) => (
    response.data.items.some((item) => item.cacheKey === key)
  ));
};

const resetForm = (): void => {
  Object.assign(termForm, {
    termId: '',
    sourceText: '',
    targetText: '',
    category: '通用',
    exactMatch: true,
    caseSensitive: false,
    enabled: true,
    note: '',
  });
};

const editTerm = (term: GlossaryTerm): void => {
  Object.assign(termForm, {
    termId: term.termId,
    sourceText: term.sourceText,
    targetText: term.targetText,
    category: term.category,
    exactMatch: term.exactMatch,
    caseSensitive: term.caseSensitive,
    enabled: term.enabled,
    note: term.note ?? '',
  });
};

const saveTerm = async (): Promise<void> => {
  busy.value = true;
  const response = await window.tradeAssistant.upsertGlossaryTerm({
    termId: termForm.termId || undefined,
    sourceText: termForm.sourceText,
    targetText: termForm.targetText,
    category: termForm.category,
    exactMatch: termForm.exactMatch,
    caseSensitive: termForm.caseSensitive,
    enabled: termForm.enabled,
    note: termForm.note || null,
  });
  busy.value = false;
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  resetForm();
  await loadGlossary(glossaryPage.value);
};

const selectImport = async (): Promise<void> => {
  const result = await window.tradeAssistant.selectGlossaryImport();
  if (result.cancelled || !result.response) {
    return;
  }
  if (result.response.type === 'error') {
    reportError(result.response.error.code, result.response.error.message);
    return;
  }
  importPlan.value = result.response.data;
};

const applyImport = async (): Promise<void> => {
  if (!importPlan.value) {
    return;
  }
  busy.value = true;
  const response = await window.tradeAssistant.applyGlossaryImport({
    expectedSha256: importPlan.value.fileSha256,
  });
  busy.value = false;
  if (response.type === 'error') {
    importPlan.value = undefined;
    reportError(response.error.code, response.error.message);
    return;
  }
  importPlan.value = undefined;
  await loadGlossary(1);
};

const exportGlossary = async (): Promise<void> => {
  const result = await window.tradeAssistant.exportGlossary();
  if (result.cancelled || !result.response) {
    return;
  }
  if (result.response.type === 'error') {
    reportError(result.response.error.code, result.response.error.message);
  }
};

const previewCacheCleanup = async (
  mode: 'expired' | 'selected' | 'all',
): Promise<void> => {
  let scopes: DataCleanupRequest['scopes'] = ['all_cache'];
  if (mode === 'expired') {
    scopes = ['expired_cache'];
  } else if (mode === 'selected') {
    scopes = ['selected_cache'];
  }
  const request: DataCleanupRequest = {
    scopes,
    taskIds: [],
    cacheKeys: mode === 'selected' ? selectedCacheKeys.value : [],
  };
  const response = await window.tradeAssistant.previewDataCleanup(request);
  if (response.type === 'error') {
    reportError(response.error.code, response.error.message);
    return;
  }
  cleanupRequest.value = request;
  cleanupPlan.value = response.data;
};

const runCacheCleanup = async (): Promise<void> => {
  if (!cleanupPlan.value || !cleanupRequest.value) {
    return;
  }
  const response = await window.tradeAssistant.runDataCleanup({
    ...cleanupRequest.value,
    planHash: cleanupPlan.value.planHash,
  });
  if (response.type === 'error') {
    cleanupPlan.value = undefined;
    reportError(response.error.code, response.error.message);
    return;
  }
  cleanupPlan.value = undefined;
  cleanupRequest.value = undefined;
  selectedCacheKeys.value = [];
  await loadCache(1);
};

const toggleCacheSelection = (cacheKey: string): void => {
  selectedCacheKeys.value = selectedCacheKeys.value.includes(cacheKey)
    ? selectedCacheKeys.value.filter((key) => key !== cacheKey)
    : [...selectedCacheKeys.value, cacheKey];
};

onMounted(() => {
  void Promise.all([loadGlossary(), loadCache()]);
});
</script>

<template>
  <section class="module-ledger data-module">
    <header class="module-heading">
      <div>
        <p>04 / LOCAL LANGUAGE ASSETS</p>
        <h2>{{ t('术语库与翻译缓存') }}</h2>
        <span>{{ t('标准术语可维护；精确缓存只读展示并按需清理。') }}</span>
      </div>
      <div
        class="module-tabs"
        role="tablist"
      >
        <button
          type="button"
          :class="{ active: activeTab === 'glossary' }"
          @click="activeTab = 'glossary'"
        >
          {{ t('术语库') }} · v{{ glossaryVersion }}
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'cache' }"
          @click="activeTab = 'cache'"
        >
          {{ t('精确缓存') }} · {{ cacheTotal }}
        </button>
      </div>
    </header>

    <template v-if="activeTab === 'glossary'">
      <form
        class="module-filter module-filter--actions"
        @submit.prevent="loadGlossary(1)"
      >
        <label>
          <span>{{ t('搜索术语') }}</span>
          <input
            v-model="glossarySearch"
            type="search"
            :placeholder="t('俄文或中文')"
          >
        </label>
        <label>
          <span>{{ t('分类') }}</span>
          <select v-model="categoryFilter">
            <option value="">{{ t('全部分类') }}</option>
            <option
              v-for="category in categories"
              :key="category"
              :value="category"
            >
              {{ category }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t('启用状态') }}</span>
          <select v-model="enabledFilter">
            <option value="">{{ t('全部') }}</option>
            <option value="true">{{ t('已启用') }}</option>
            <option value="false">{{ t('已停用') }}</option>
          </select>
        </label>
        <button
          class="primary-button"
          type="submit"
        >
          {{ t('查询术语') }}
        </button>
        <button
          class="secondary-button"
          type="button"
          @click="selectImport"
        >
          {{ t('导入 XLSX') }}
        </button>
        <button
          class="secondary-button"
          type="button"
          @click="exportGlossary"
        >
          {{ t('导出 XLSX') }}
        </button>
      </form>

      <aside
        v-if="importPlan"
        class="confirmation-dock confirmation-dock--brass"
      >
        <div>
          <strong>{{ importPlan.fileName }}</strong>
          <span>
            {{ t('新增') }} {{ importPlan.createdRows }} ·
            {{ t('更新') }} {{ importPlan.updatedRows }} ·
            {{ t('不变') }} {{ importPlan.unchangedRows }}
          </span>
        </div>
        <button
          class="primary-button"
          type="button"
          :disabled="busy"
          @click="applyImport"
        >
          {{ t('确认原子导入') }}
        </button>
      </aside>

      <div class="library-layout">
        <form
          class="term-editor"
          @submit.prevent="saveTerm"
        >
          <div class="subsection-heading">
            <span>TERM EDITOR</span>
            <strong>{{ termForm.termId ? t('编辑术语') : t('新建术语') }}</strong>
          </div>
          <label>
            <span>{{ t('俄文原文') }} *</span>
            <input
              v-model="termForm.sourceText"
              required
            >
          </label>
          <label>
            <span>{{ t('中文译文') }} *</span>
            <input
              v-model="termForm.targetText"
              required
            >
          </label>
          <label>
            <span>{{ t('分类') }}</span>
            <input v-model="termForm.category">
          </label>
          <label>
            <span>{{ t('备注') }}</span>
            <textarea
              v-model="termForm.note"
              rows="3"
            />
          </label>
          <label class="check-line">
            <input
              v-model="termForm.exactMatch"
              type="checkbox"
            >
            <span>{{ t('精确匹配') }}</span>
          </label>
          <label class="check-line">
            <input
              v-model="termForm.caseSensitive"
              type="checkbox"
            >
            <span>{{ t('区分大小写') }}</span>
          </label>
          <label class="check-line">
            <input
              v-model="termForm.enabled"
              type="checkbox"
            >
            <span>{{ t('启用') }}</span>
          </label>
          <div class="editor-actions">
            <button
              class="primary-button"
              type="submit"
              :disabled="busy"
            >
              {{ t('保存术语') }}
            </button>
            <button
              class="text-button"
              type="button"
              @click="resetForm"
            >
              {{ t('清空') }}
            </button>
          </div>
        </form>

        <div class="library-table-wrap">
          <table class="library-table">
            <thead>
              <tr>
                <th>{{ t('俄文原文') }}</th>
                <th>{{ t('中文译文') }}</th>
                <th>{{ t('分类') }}</th>
                <th>{{ t('匹配规则') }}</th>
                <th>{{ t('状态') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="term in glossaryItems"
                :key="term.termId"
                @click="editTerm(term)"
              >
                <td>{{ term.sourceText }}</td>
                <td>{{ term.targetText }}</td>
                <td>{{ term.category }}</td>
                <td>{{ term.exactMatch ? t('精确') : t('包含') }}</td>
                <td>{{ term.enabled ? t('已启用') : t('已停用') }}</td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="!glossaryItems.length"
            class="module-empty"
          >
            {{ t('没有符合条件的术语') }}
          </p>
          <footer class="module-pagination">
            <button
              type="button"
              :disabled="glossaryPage <= 1"
              @click="loadGlossary(glossaryPage - 1)"
            >
              {{ t('上一页') }}
            </button>
            <span>{{ glossaryTotal }} · {{ glossaryPage }}/{{ glossaryPages }}</span>
            <button
              type="button"
              :disabled="glossaryPage >= glossaryPages"
              @click="loadGlossary(glossaryPage + 1)"
            >
              {{ t('下一页') }}
            </button>
          </footer>
        </div>
      </div>
    </template>

    <template v-else>
      <form
        class="module-filter module-filter--actions"
        @submit.prevent="loadCache(1)"
      >
        <label>
          <span>{{ t('搜索缓存') }}</span>
          <input
            v-model="cacheSearch"
            type="search"
            :placeholder="t('原文或译文')"
          >
        </label>
        <button
          class="primary-button"
          type="submit"
        >
          {{ t('查询缓存') }}
        </button>
        <button
          class="secondary-button"
          type="button"
          @click="previewCacheCleanup('expired')"
        >
          {{ t('预览过期清理') }}
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="!selectedCacheKeys.length"
          @click="previewCacheCleanup('selected')"
        >
          {{ t('预览所选清理') }}
        </button>
        <button
          class="text-button text-button--danger"
          type="button"
          @click="previewCacheCleanup('all')"
        >
          {{ t('预览清空缓存') }}
        </button>
      </form>

      <aside
        v-if="cleanupPlan"
        class="confirmation-dock"
      >
        <div>
          <strong>{{ t('确认清理精确缓存？') }}</strong>
          <span>{{ cleanupPlan.cacheCount }} {{ t('条缓存将被永久删除') }}</span>
        </div>
        <button
          class="danger-button"
          type="button"
          @click="runCacheCleanup"
        >
          {{ t('确认清理') }}
        </button>
      </aside>

      <div class="cache-list">
        <label
          v-for="item in cacheItems"
          :key="item.cacheKey"
          :class="{ expired: item.expired }"
        >
          <input
            type="checkbox"
            :checked="selectedCacheKeys.includes(item.cacheKey)"
            @change="toggleCacheSelection(item.cacheKey)"
          >
          <div>
            <strong>{{ item.sourceText }}</strong>
            <span>{{ item.translation }}</span>
          </div>
          <small>v{{ item.glossaryVersion }} · {{ item.expiresAt.slice(0, 10) }}</small>
        </label>
        <p
          v-if="!cacheItems.length"
          class="module-empty"
        >
          {{ t('当前没有精确缓存') }}
        </p>
      </div>
      <footer class="module-pagination">
        <button
          type="button"
          :disabled="cachePage <= 1"
          @click="loadCache(cachePage - 1)"
        >
          {{ t('上一页') }}
        </button>
        <span>{{ cachePage }} / {{ cachePages }}</span>
        <button
          type="button"
          :disabled="cachePage >= cachePages"
          @click="loadCache(cachePage + 1)"
        >
          {{ t('下一页') }}
        </button>
      </footer>
    </template>
  </section>
</template>
