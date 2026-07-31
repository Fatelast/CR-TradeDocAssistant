export const PROTOCOL_VERSION = '1.0' as const

export const IMPORT_LIMITS = {
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxRows: 5_000,
  maxColumns: 200,
  headerScanRows: 12,
  previewRows: 12,
} as const

export const IPC_CHANNELS = {
  getWorkerInfo: 'worker:get-info',
  selectWorkbook: 'workbook:select',
  openDroppedWorkbook: 'workbook:open-dropped',
  previewWorkbookSheet: 'workbook:preview-sheet',
  buildWorkbookRows: 'workbook:build-rows',
  createTranslationTask: 'translation:create-task',
  getTranslationTask: 'translation:get-task',
  listTranslationTasks: 'translation:list-tasks',
  processTranslationBatch: 'translation:process-batch',
  updateTranslationRow: 'translation:update-row',
  changeTranslationTaskState: 'translation:change-state',
  reviewTranslationRow: 'translation:review-row',
  preflightExport: 'export:preflight',
  exportTranslationTask: 'export:select-and-run',
  listTaskHistory: 'history:list',
  getTaskHistoryDetail: 'history:get-detail',
  createRerunTask: 'history:rerun',
  openHistoryFile: 'history:open-file',
  listGlossaryTerms: 'glossary:list',
  upsertGlossaryTerm: 'glossary:upsert',
  selectGlossaryImport: 'glossary:select-import',
  applyGlossaryImport: 'glossary:apply-import',
  exportGlossary: 'glossary:export',
  listTranslationCache: 'cache:list',
  previewDataCleanup: 'maintenance:preview-cleanup',
  runDataCleanup: 'maintenance:run-cleanup',
  previewLogCleanup: 'maintenance:preview-log-cleanup',
  runLogCleanup: 'maintenance:run-log-cleanup',
  getAppSettings: 'settings:get',
  selectOutputDirectory: 'settings:select-output-directory',
  updateAppSettings: 'settings:update',
  exportAppSettings: 'settings:export',
} as const

export const WORKER_ACTIONS = {
  getWorkerInfo: 'get_worker_info',
  parseWorkbook: 'parse_workbook',
  previewSheet: 'preview_sheet',
  buildImportRows: 'build_import_rows',
  createTranslationTask: 'create_translation_task',
  getTranslationTask: 'get_translation_task',
  listTranslationTasks: 'list_translation_tasks',
  processTranslationBatch: 'process_translation_batch',
  updateTranslationRow: 'update_translation_row',
  changeTranslationTaskState: 'change_translation_task_state',
  reviewTranslationRow: 'review_translation_row',
  preflightExport: 'preflight_export',
  exportTranslationTask: 'export_translation_task',
  upsertGlossaryTerm: 'upsert_glossary_term',
  listGlossaryTerms: 'list_glossary_terms',
  preflightGlossaryImport: 'preflight_glossary_import',
  applyGlossaryImport: 'apply_glossary_import',
  exportGlossary: 'export_glossary',
  listTaskHistory: 'list_task_history',
  getTaskHistoryDetail: 'get_task_history_detail',
  createRerunTask: 'create_rerun_task',
  resolveHistoryPath: 'resolve_history_path',
  recoverPendingExports: 'recover_pending_exports',
  listTranslationCache: 'list_translation_cache',
  previewDataCleanup: 'preview_data_cleanup',
  runDataCleanup: 'run_data_cleanup',
  runScheduledCleanup: 'run_scheduled_cleanup',
  getAppSettings: 'get_app_settings',
  updateAppSettings: 'update_app_settings',
  exportAppSettings: 'export_app_settings',
} as const

export type WorkerAction =
  (typeof WORKER_ACTIONS)[keyof typeof WORKER_ACTIONS]

export type WorkerErrorCode =
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'UNSUPPORTED_ACTION'
  | 'WORKER_INTERNAL_ERROR'
  | 'WORKER_START_FAILED'
  | 'WORKER_TIMEOUT'
  | 'WORKER_EXITED'
  | 'FILE_SELECTION_FAILED'
  | 'FILE_NOT_FOUND'
  | 'FILE_UNSUPPORTED'
  | 'FILE_LOCKED'
  | 'FILE_TOO_LARGE'
  | 'WORKBOOK_OPEN_FAILED'
  | 'WORKBOOK_ENCRYPTED'
  | 'WORKBOOK_ARCHIVE_TOO_LARGE'
  | 'WORKBOOK_SESSION_INVALID'
  | 'ROW_LIMIT_EXCEEDED'
  | 'COLUMN_LIMIT_EXCEEDED'
  | 'SHEET_NOT_FOUND'
  | 'HEADER_NOT_FOUND'
  | 'SOURCE_COLUMN_INVALID'
  | 'TARGET_COLUMN_INVALID'
  | 'DATABASE_ERROR'
  | 'TASK_NOT_FOUND'
  | 'TASK_ROW_NOT_FOUND'
  | 'TASK_ROWS_EMPTY'
  | 'TASK_STATE_INVALID'
  | 'TRANSLATOR_UNAVAILABLE'
  | 'TRANSLATION_TIMEOUT'
  | 'TRANSLATION_OUTPUT_INVALID'
  | 'TOKEN_RESTORE_FAILED'
  | 'INITIAL_TRANSLATION_MISSING'
  | 'SOURCE_FINGERPRINT_MISSING'
  | 'SOURCE_FILE_CHANGED'
  | 'EXPORT_TASK_INCOMPLETE'
  | 'EXPORT_RESTRICTED'
  | 'EXPORT_PATH_INVALID'
  | 'EXPORT_PATH_EXISTS'
  | 'EXPORT_CELL_MERGED'
  | 'EXPORT_WRITE_FAILED'
  | 'EXPORT_VALIDATION_FAILED'
  | 'GLOSSARY_TERM_DUPLICATE'
  | 'GLOSSARY_IMPORT_INVALID'
  | 'GLOSSARY_IMPORT_LIMIT_EXCEEDED'
  | 'GLOSSARY_IMPORT_CHANGED'
  | 'HISTORY_TASK_NOT_FOUND'
  | 'EXPORT_RECORD_NOT_FOUND'
  | 'TASK_SOURCE_RESELECT_REQUIRED'
  | 'CLEANUP_PLAN_CHANGED'
  | 'SETTINGS_INVALID'
  | 'OUTPUT_DIRECTORY_UNAVAILABLE'

export interface WorkerRequest<
  TAction extends WorkerAction = WorkerAction,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  protocolVersion: typeof PROTOCOL_VERSION
  id: string
  type: 'request'
  action: TAction
  payload: TPayload
}

export interface WorkerInfo {
  workerVersion: string
  protocolVersion: typeof PROTOCOL_VERSION
  pythonVersion: string
  platform: string
}

export type WorksheetState = 'visible' | 'hidden' | 'veryHidden'

export type WorkbookRiskCode =
  | 'EXTERNAL_LINKS'
  | 'CHARTS'
  | 'DRAWINGS'
  | 'DATA_VALIDATION'
  | 'CONDITIONAL_FORMATTING'
  | 'MERGED_CELLS'
  | 'FORMULAS'
  | 'HIDDEN_SHEETS'

export interface WorkbookRisk {
  code: WorkbookRiskCode
  severity: 'notice' | 'restricted'
  message: string
}

export interface ImportLimits {
  maxFileSizeBytes: number
  maxRows: number
  maxColumns: number
  headerScanRows: number
  previewRows: number
}

export interface WorksheetSummary {
  name: string
  state: WorksheetState
  rowCount: number
  columnCount: number
  headerCandidateRows: number[]
  recommendedHeaderRow: number
}

export interface WorkbookSummary {
  fileName: string
  fileSizeBytes: number
  defaultSheetName: string
  sheets: WorksheetSummary[]
  risks: WorkbookRisk[]
  restricted: boolean
  limits: ImportLimits
}

export interface WorkbookSession extends WorkbookSummary {
  workbookId: string
  filePath: string
}

export interface WorkbookSelectionResult {
  cancelled: boolean
  response?: WorkerResponse<WorkbookSession>
}

export type CellValue = string | number | boolean | null

export interface WorkbookColumn {
  index: number
  letter: string
  label: string
}

export interface ColumnRecommendations {
  containerColumn: number | null
  sourceColumn: number | null
  targetColumn: number | null
}

export interface WorksheetPreviewRow {
  excelRowNumber: number
  values: CellValue[]
}

export interface WorksheetPreview {
  sheetName: string
  headerRow: number
  totalRows: number
  columns: WorkbookColumn[]
  recommendations: ColumnRecommendations
  rows: WorksheetPreviewRow[]
}

export interface WorkbookSheetRequest {
  workbookId: string
  sheetName: string
  headerRow: number
}

export interface BuildWorkbookRowsRequest {
  workbookId: string
  sheetName: string
  headerRow: number
  sourceColumn: number
  containerColumn?: number | null
  targetColumn?: number | null
}

export interface ImportRow {
  rowId: string
  excelRowNumber: number
  sourceCell: string
  targetCell: string | null
  containerCell: string | null
  containerValue: CellValue
  sourceText: string
  existingTarget: CellValue
  status: 'pending'
}

export interface ImportRowsResult {
  sheetName: string
  totalRows: number
  rows: ImportRow[]
}

export type TranslationTaskStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'awaiting_manual'
  | 'completed'
  | 'cancelled'

export type TranslationRowStatus =
  | 'pending'
  | 'candidate'
  | 'needs_manual'
  | 'completed'
  | 'failed'
  | 'ignored'

export type TranslationCandidateSource =
  | 'existing'
  | 'cache'
  | 'glossary'
  | 'manual'

export interface CreateTranslationTaskRequest
  extends BuildWorkbookRowsRequest {
  sourceLanguage?: 'ru'
  targetLanguage?: 'zh-CN'
}

export interface TranslationTaskSummary {
  taskId: string
  sourceFilePath: string
  sourceFileName: string
  sheetName: string
  headerRow: number
  sourceColumn: number
  containerColumn: number | null
  targetColumn: number | null
  sourceLanguage: string
  targetLanguage: string
  translatorId: string
  glossaryVersion: number
  protectionVersion: string
  sourceFingerprintAvailable: boolean
  sourceRestricted: boolean
  sourceRisks: WorkbookRisk[]
  status: TranslationTaskStatus
  totalRows: number
  pendingRows: number
  candidateRows: number
  manualRows: number
  completedRows: number
  failedRows: number
  rerunOfTaskId: string | null
  progress: number
  createdAt: string
  updatedAt: string
}

export interface TranslationTaskRow {
  rowId: string
  excelRowNumber: number
  sourceCell: string
  targetCell: string | null
  containerCell: string | null
  containerValue: CellValue
  sourceText: string
  existingTarget: CellValue
  translation: string | null
  initialTranslation: string | null
  candidateSource: TranslationCandidateSource | null
  initialCandidateSource: TranslationCandidateSource | null
  status: TranslationRowStatus
  errorCode: WorkerErrorCode | null
  userModified: boolean
  updatedAt: string
}

export interface TranslationTaskDetail {
  task: TranslationTaskSummary
  rows: TranslationTaskRow[]
}

export interface TranslationTaskIdRequest {
  taskId: string
}

export interface ListTranslationTasksRequest {
  includeCompleted?: boolean
  limit?: number
}

export interface TranslationTaskListResult {
  tasks: TranslationTaskSummary[]
}

export interface ProcessTranslationBatchRequest {
  taskId: string
  batchSize?: number
}

export interface UpdateTranslationRowRequest {
  taskId: string
  rowId: string
  translation: string
  saveToCache?: boolean
}

export interface ChangeTranslationTaskStateRequest {
  taskId: string
  action: 'pause' | 'resume' | 'cancel' | 'retry_failed'
}

export interface ReviewTranslationRowRequest {
  taskId: string
  rowId: string
  action: 'ignore' | 'restore_initial' | 'rematch'
}

export interface ExportPreflightRequest {
  taskId: string
}

export interface ExportPreflightResult {
  taskId: string
  ready: true
  sourceFilePath: string
  sourceFileName: string
  sourceSha256: string
  sheetName: string
  targetColumn: number
  targetColumnLetter: string
  createsTargetColumn: boolean
  writableRows: number
  unchangedRows: number
  ignoredRows: number
  suggestedFileName: string
  risks: WorkbookRisk[]
}

export interface WorkerExportTranslationTaskRequest {
  taskId: string
  outputPath: string
}

export interface TranslationExportResult {
  exportId: string
  taskId: string
  outputPath: string
  outputFileName: string
  outputSha256: string
  sheetName: string
  targetColumn: number
  targetColumnLetter: string
  createdTargetColumn: boolean
  writtenRows: number
  skippedRows: number
  validated: boolean
}

export interface TranslationExportSelectionResult {
  cancelled: boolean
  response?: WorkerResponse<TranslationExportResult>
}

export interface ListTaskHistoryRequest {
  page?: number
  pageSize?: number
  search?: string
  status?: TranslationTaskStatus
  days?: 7 | 30 | 90
}

export interface TaskHistoryItem extends TranslationTaskSummary {
  sourceExists: boolean
  exportCount: number
  latestExportStatus: TaskExportStatus | null
}

export type TaskExportStatus =
  | 'pending'
  | 'completed'
  | 'recovered'
  | 'failed'

export interface TaskExportRecord {
  exportId: string
  taskId: string
  outputFilePath: string
  outputFileName: string
  outputSha256: string | null
  status: TaskExportStatus
  sheetName: string
  targetColumn: number | null
  targetColumnLetter: string | null
  createdTargetColumn: boolean
  writtenRows: number
  skippedRows: number
  validated: boolean
  errorCode: WorkerErrorCode | null
  outputExists: boolean
  createdAt: string
  completedAt: string | null
}

export interface TaskHistoryListResult {
  items: TaskHistoryItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface TaskHistoryDetail {
  task: TranslationTaskSummary
  sourceExists: boolean
  exports: TaskExportRecord[]
}

export interface HistoryPathRequest {
  entityType: 'source' | 'export'
  entityId: string
}

export interface HistoryPathResult {
  path: string
  fileName: string
  exists: boolean
  opened?: boolean
}

export interface GlossaryTerm {
  termId: string
  sourceText: string
  targetText: string
  category: string
  exactMatch: boolean
  caseSensitive: boolean
  enabled: boolean
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface ListGlossaryTermsRequest {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  enabled?: boolean
}

export interface GlossaryTermListResult {
  glossaryVersion: number
  items: GlossaryTerm[]
  categories: string[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface UpsertGlossaryTermRequest {
  termId?: string
  sourceText: string
  targetText: string
  category?: string
  exactMatch?: boolean
  caseSensitive?: boolean
  enabled?: boolean
  note?: string | null
}

export interface UpsertGlossaryTermResult {
  termId: string
  glossaryVersion: number
}

export interface GlossaryImportPreflightResult {
  fileName: string
  fileSha256: string
  totalRows: number
  createdRows: number
  updatedRows: number
  unchangedRows: number
}

export interface GlossaryImportSelectionResult {
  cancelled: boolean
  response?: WorkerResponse<GlossaryImportPreflightResult>
}

export interface ApplyGlossaryImportRequest {
  expectedSha256: string
}

export interface ApplyGlossaryImportResult {
  glossaryVersion: number
  createdRows: number
  updatedRows: number
  unchangedRows: number
}

export interface LocalExportResult {
  outputPath: string
  outputFileName: string
  validated: boolean
  termCount?: number
}

export interface LocalExportSelectionResult {
  cancelled: boolean
  response?: WorkerResponse<LocalExportResult>
}

export interface TranslationCacheItem {
  cacheKey: string
  sourceText: string
  translation: string
  translatorId: string
  glossaryVersion: number
  confirmedAt: string
  lastUsedAt: string
  expiresAt: string
  expired: boolean
}

export interface ListTranslationCacheRequest {
  page?: number
  pageSize?: number
  search?: string
}

export interface TranslationCacheListResult {
  items: TranslationCacheItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type DataCleanupScope =
  | 'expired_tasks'
  | 'selected_tasks'
  | 'expired_cache'
  | 'selected_cache'
  | 'all_cache'

export interface DataCleanupRequest {
  scopes: DataCleanupScope[]
  taskIds?: string[]
  cacheKeys?: string[]
}

export interface DataCleanupPreview {
  scopes: DataCleanupScope[]
  taskIds: string[]
  cacheKeys: string[]
  planHash: string
  taskCount: number
  taskRowCount: number
  exportCount: number
  cacheCount: number
}

export interface RunDataCleanupRequest extends DataCleanupRequest {
  planHash: string
}

export interface DataCleanupResult {
  taskCount: number
  taskRowCount: number
  exportCount: number
  cacheCount: number
  completedAt: string
}

export interface LogCleanupPreview {
  planHash: string
  fileCount: number
  sizeBytes: number
}

export interface RunLogCleanupRequest {
  planHash: string
}

export interface LogCleanupResult {
  fileCount: number
  sizeBytes: number
}

export interface AppSettings {
  defaultOutputDirectory: string | null
  batchSize: number
  logLevel: 'info' | 'error'
  retention: {
    taskDays: 90
    cacheDays: 180
    logDays: 30
  }
  updatedAt: string
}

export interface UpdateAppSettingsRequest {
  defaultOutputDirectory: string | null
  batchSize: number
  logLevel: 'info' | 'error'
}

export interface DirectorySelectionResult {
  cancelled: boolean
  directoryPath?: string
}

export interface WorkerCompletedResponse<TData = unknown> {
  protocolVersion: typeof PROTOCOL_VERSION
  id: string
  type: 'completed'
  data: TData
}

export interface WorkerErrorResponse {
  protocolVersion: typeof PROTOCOL_VERSION
  id: string
  type: 'error'
  error: {
    code: WorkerErrorCode
    message: string
  }
}

export type WorkerResponse<TData = unknown> =
  | WorkerCompletedResponse<TData>
  | WorkerErrorResponse

export interface DesktopApi {
  getWorkerInfo: () => Promise<WorkerResponse<WorkerInfo>>
  selectWorkbook: () => Promise<WorkbookSelectionResult>
  openDroppedWorkbook: (file: unknown) => Promise<WorkbookSelectionResult>
  previewWorkbookSheet: (
    request: WorkbookSheetRequest,
  ) => Promise<WorkerResponse<WorksheetPreview>>
  buildWorkbookRows: (
    request: BuildWorkbookRowsRequest,
  ) => Promise<WorkerResponse<ImportRowsResult>>
  createTranslationTask: (
    request: CreateTranslationTaskRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  getTranslationTask: (
    request: TranslationTaskIdRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  listTranslationTasks: (
    request?: ListTranslationTasksRequest,
  ) => Promise<WorkerResponse<TranslationTaskListResult>>
  processTranslationBatch: (
    request: ProcessTranslationBatchRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  updateTranslationRow: (
    request: UpdateTranslationRowRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  changeTranslationTaskState: (
    request: ChangeTranslationTaskStateRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  reviewTranslationRow: (
    request: ReviewTranslationRowRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  preflightExport: (
    request: ExportPreflightRequest,
  ) => Promise<WorkerResponse<ExportPreflightResult>>
  exportTranslationTask: (
    request: ExportPreflightRequest,
  ) => Promise<TranslationExportSelectionResult>
  listTaskHistory: (
    request?: ListTaskHistoryRequest,
  ) => Promise<WorkerResponse<TaskHistoryListResult>>
  getTaskHistoryDetail: (
    request: TranslationTaskIdRequest,
  ) => Promise<WorkerResponse<TaskHistoryDetail>>
  createRerunTask: (
    request: TranslationTaskIdRequest,
  ) => Promise<WorkerResponse<TranslationTaskDetail>>
  openHistoryFile: (
    request: HistoryPathRequest,
  ) => Promise<WorkerResponse<HistoryPathResult>>
  listGlossaryTerms: (
    request?: ListGlossaryTermsRequest,
  ) => Promise<WorkerResponse<GlossaryTermListResult>>
  upsertGlossaryTerm: (
    request: UpsertGlossaryTermRequest,
  ) => Promise<WorkerResponse<UpsertGlossaryTermResult>>
  selectGlossaryImport: () => Promise<GlossaryImportSelectionResult>
  applyGlossaryImport: (
    request: ApplyGlossaryImportRequest,
  ) => Promise<WorkerResponse<ApplyGlossaryImportResult>>
  exportGlossary: () => Promise<LocalExportSelectionResult>
  listTranslationCache: (
    request?: ListTranslationCacheRequest,
  ) => Promise<WorkerResponse<TranslationCacheListResult>>
  previewDataCleanup: (
    request: DataCleanupRequest,
  ) => Promise<WorkerResponse<DataCleanupPreview>>
  runDataCleanup: (
    request: RunDataCleanupRequest,
  ) => Promise<WorkerResponse<DataCleanupResult>>
  previewLogCleanup: () => Promise<WorkerResponse<LogCleanupPreview>>
  runLogCleanup: (
    request: RunLogCleanupRequest,
  ) => Promise<WorkerResponse<LogCleanupResult>>
  getAppSettings: () => Promise<WorkerResponse<AppSettings>>
  selectOutputDirectory: () => Promise<DirectorySelectionResult>
  updateAppSettings: (
    request: UpdateAppSettingsRequest,
  ) => Promise<WorkerResponse<AppSettings>>
  exportAppSettings: () => Promise<LocalExportSelectionResult>
}
