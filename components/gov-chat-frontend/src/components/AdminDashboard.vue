<template>
  <div class="admin-backdrop" @click="$emit('close')"></div>

  <div class="admin-dashboard">
    <button
      class="close-dashboard-btn"
      @click="$emit('close')"
      :aria-label="translate('admin.close', 'Close dashboard')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <div class="dashboard">
      <div class="sidebar">
        <div class="logo">
          <span>{{ translate("admin.appName", "Agrivisory") }}</span>
        </div>

        <div class="nav-section" v-if="isAdmin">
          <div class="nav-header">
            {{ translate("admin.dashboard", "Dashboard") }}
          </div>
          <ul class="nav-items">
            <li class="nav-item">
              <a
                href="#"
                class="nav-link active"
                @click.prevent="setActiveTab('overview')"
              >
                <i>📊</i>
                <span>{{ translate("admin.overview", "Overview") }}</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="nav-section">
          <div class="nav-header">
            {{ translate("admin.contentManagement", "CONTENT MANAGEMENT") }}
          </div>
          <ul class="nav-items">
            <li class="nav-item">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('hierarchy')"
              >
                <i>🔀</i>
                <span>{{
                  translate("admin.knowledgeHierarchy", "Knowledge Hierarchy")
                }}</span>
              </a>
            </li>
            <li class="nav-item" v-if="isAdmin">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('quickhelp')"
              >
                <i>💬</i>
                <span>{{
                  translate("admin.quickHelpButtons", "Quick Help Buttons")
                }}</span>
              </a>
            </li>
            <li class="nav-item">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('documents')"
              >
                <i>📂</i>
                <span>{{
                  translate("admin.documentManagement", "Document Management")
                }}</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="nav-section" v-if="isAIEngineerOrAbove">
          <div class="nav-header">
            {{ translate("admin.system", "System") }}
          </div>
          <ul class="nav-items">
            <li class="nav-item">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('queryInspector')"
              >
                <i>🔍</i>
                <span>{{
                  translate("admin.queryInspector", "Query Inspector")
                }}</span>
              </a>
            </li>
            <li class="nav-item" v-if="isAdmin">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('pipelineSettings')"
              >
                <i>⚙️</i>
                <span>{{
                  translate("admin.pipelineSettings.tab", "Pipeline Settings")
                }}</span>
              </a>
            </li>
            <li class="nav-item" v-if="isAdmin">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('database')"
              >
                <i>💾</i>
                <span>{{ translate("admin.database", "Database") }}</span>
              </a>
            </li>
            <li class="nav-item" v-if="isAdmin">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('logs')"
              >
                <i>📋</i>
                <span>{{ translate("admin.logs", "Logs") }}</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="nav-section" v-if="isAdmin">
          <div class="nav-header">
            {{ translate("admin.settings", "Settings") }}
          </div>
          <ul class="nav-items">
            <li class="nav-item">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('users')"
              >
                <i>👥</i>
                <span>{{
                  translate("admin.userManagement", "User Management")
                }}</span>
              </a>
            </li>
            <li class="nav-item">
              <a
                href="#"
                class="nav-link"
                @click.prevent="setActiveTab('security')"
              >
                <i>🔒</i>
                <span>{{ translate("admin.tabs.security", "Security") }}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div class="main">
        <div class="header">
          <h1 class="page-title">
            {{
              translate("admin.systemAdministration", "System Dashboard")
            }}
          </h1>
        </div>

        <div class="quick-stats" v-if="isAdmin">
          <div class="stat-card">
            <div class="stat-title">
              {{ translate("admin.systemUptime", "System Uptime") }}
            </div>
            <div class="stat-value">{{ metrics.systemUptime }}%</div>
            <div class="stat-trend trend-up">
              <span>↑ 0.2%</span>
              {{ translate("admin.fromLastMonth", "from last month") }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">
              {{ translate("admin.avgResponseTime", "Average Response Time") }}
            </div>
            <div class="stat-value">{{ metrics.avgResponseTime }}ms</div>
            <div class="stat-trend trend-down">
              <span>↓ 12%</span>
              {{ translate("admin.fromLastMonth", "from last month") }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">
              {{ translate("admin.errorRate", "Error Rate") }}
            </div>
            <div class="stat-value">{{ metrics.errorRate }}%</div>
            <div class="stat-trend trend-up">
              <span>↑ 0.01%</span>
              {{ translate("admin.fromLastMonth", "from last month") }}
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-title">
              {{
                translate(
                  "admin.monthlyActiveUsers",
                  "Monthly Active Users (MAU)"
                )
              }}
            </div>
            <div class="stat-value">
              {{ (metrics.monthlyActiveUsers ?? 0).toLocaleString() }}
            </div>
            <div class="stat-trend trend-up">
              <span>↑ 15%</span>
              {{ translate("admin.fromLastMonth", "from last month") }}
            </div>
          </div>
        </div>

        <div class="tabs">
          <div class="tab-header">
            <button
              v-for="tab in filteredTabs"
              :key="tab.id"
              class="tab-btn"
              :class="{ active: activeTab === tab.id }"
              @click="setActiveTab(tab.id)"
            >
              {{ translate(`admin.tabs.${tab.id}`, tab.label) }}
            </button>
          </div>

          <div class="tab-content">
            <div class="dashboard-grid">
              <div class="dashboard-card" v-if="activeTab === 'overview' && isAdmin">
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.systemHealthStatus",
                        "System Health Status"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="runDiagnostics">
                      {{ translate("admin.runDiagnostics", "Run Diagnostics") }}
                    </button>
                  </div>
                </div>

                <div class="health-status">
                  <div
                    v-for="service in healthServices"
                    :key="service.name"
                    :class="['health-item', `status-${service.status}`]"
                  >
                    <div
                      :class="['status-badge', `badge-${service.status}`]"
                    ></div>
                    <div class="health-item-info">
                      <span>{{
                        translate(`admin.services.${service.id}`, service.name)
                      }}</span>
                      <span v-if="service.message" class="health-item-message">{{ service.message }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="dashboard-card" v-if="activeTab === 'overview' && isAdmin">
                <div class="card-header">
                  <div class="card-title">
                    {{ translate("admin.resourceUsage", "Resource Usage") }}
                  </div>
                </div>

                <div class="resource-usage">
                  <div
                    v-for="resource in resourceUsage"
                    :key="resource.id"
                    class="usage-item"
                  >
                    <div class="usage-header">
                      <div class="usage-label">{{ resource.label }}</div>
                      <div class="usage-value">{{ resource.value }}%</div>
                    </div>
                    <div class="usage-bar">
                      <div
                        :class="[
                          'usage-fill',
                          `usage-${getUsageLevel(resource.value)}`,
                        ]"
                        :style="{ width: `${resource.value}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- AI Configuration Card -->
              <div class="dashboard-card" v-if="activeTab === 'overview' && isAIEngineerOrAbove && aiConfig" style="grid-column: span 2">
                <div class="card-header">
                  <div class="card-title">
                    {{ translate("admin.aiConfig", "AI Configuration") }}
                  </div>
                </div>

                <div class="ai-config-grid">
                  <!-- LLM -->
                  <div class="ai-config-section">
                    <h4 class="ai-config-section-title">🤖 LLM</h4>
                    <div class="ai-config-items">
                      <div class="ai-config-item">
                        <span class="ai-config-label">Model</span>
                        <span class="ai-config-value">{{ aiConfig.llm.modelId }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Max Context</span>
                        <span class="ai-config-value">{{ aiConfig.llm.maxModelLen }} tokens</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">GPU Memory</span>
                        <span class="ai-config-value">{{ (aiConfig.llm.gpuMemoryUtilization * 100).toFixed(0) }}%</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Dtype</span>
                        <span class="ai-config-value">{{ aiConfig.llm.dtype }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Translation (DEC-30: ACTIVE backend only — the CPU
                       fallback row is deliberately gone; threads/batches are
                       CPU-only knobs, so they render only when cpu is active) -->
                  <div class="ai-config-section">
                    <h4 class="ai-config-section-title">🌐 Translation</h4>
                    <div class="ai-config-items">
                      <div class="ai-config-item">
                        <span class="ai-config-label">Backend</span>
                        <span class="ai-config-value">{{ translationBackendDisplay }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Model</span>
                        <span class="ai-config-value">{{
                          aiConfig.translation.activeModel || "not initialized"
                        }}</span>
                      </div>
                      <div
                        class="ai-config-item"
                        v-if="aiConfig.translation.activeType === 'cpu'"
                      >
                        <span class="ai-config-label">Threads</span>
                        <span class="ai-config-value">{{ aiConfig.translation.threads }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Cache</span>
                        <span class="ai-config-value">{{ aiConfig.translation.cacheEnabled }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Embedding & Reranker -->
                  <div class="ai-config-section">
                    <h4 class="ai-config-section-title">🔍 Retrieval</h4>
                    <div class="ai-config-items">
                      <div class="ai-config-item">
                        <span class="ai-config-label">Embedding Model</span>
                        <span class="ai-config-value">{{ aiConfig.embedding.modelId }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Reranker Model</span>
                        <span class="ai-config-value">{{ aiConfig.reranker.modelId }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Strategy</span>
                        <span class="ai-config-value">{{ aiConfig.reranker.strategy }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Threshold</span>
                        <span class="ai-config-value">{{ aiConfig.reranker.threshold }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- RAG Pipeline -->
                  <div class="ai-config-section">
                    <h4 class="ai-config-section-title">📚 RAG Pipeline</h4>
                    <div class="ai-config-items">
                      <div class="ai-config-item">
                        <span class="ai-config-label">Weather Augmentation</span>
                        <span class="ai-config-value">{{ aiConfig.rag.weatherAugmentation }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Forecast Days</span>
                        <span class="ai-config-value">{{ aiConfig.rag.weatherForecastDays }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Guardrail Model</span>
                        <span class="ai-config-value">{{ aiConfig.rag.guardrailModel }}</span>
                      </div>
                      <div class="ai-config-item ai-config-item-wide" v-if="aiConfig.rag.systemPrompt">
                        <span class="ai-config-label">System Prompt</span>
                        <span class="ai-config-value ai-config-prompt">{{ aiConfig.rag.systemPrompt }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Ingestion -->
                  <div class="ai-config-section">
                    <h4 class="ai-config-section-title">📥 Ingestion</h4>
                    <div class="ai-config-items">
                      <div class="ai-config-item">
                        <span class="ai-config-label">Extraction</span>
                        <span class="ai-config-value">{{ aiConfig.ingestion.contentExtractionMethod }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Labeling</span>
                        <span class="ai-config-value">{{ aiConfig.ingestion.labelingStrategy }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Max Batches</span>
                        <span class="ai-config-value">{{ aiConfig.ingestion.maxConcurrentBatches }}</span>
                      </div>
                      <div class="ai-config-item">
                        <span class="ai-config-label">Chunk Sizes</span>
                        <span class="ai-config-value">PDF:{{ aiConfig.ingestion.chunkSizes.pdf }} | DOCX:{{ aiConfig.ingestion.chunkSizes.docx }} | TXT:{{ aiConfig.ingestion.chunkSizes.txt }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="activeTab === 'hierarchy'"
                class="dashboard-card"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.hierarchy.title",
                        "Knowledge Hierarchy Management (note: always English - add translations)"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button
                      class="btn btn-primary"
                      @click="showAddCategoryForm"
                    >
                      <span style="display: flex; align-items: center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="margin-right: 4px"
                        >
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </svg>
                        {{
                          translate(
                            "admin.hierarchy.addCategory",
                            "Add New Category"
                          )
                        }}
                      </span>
                    </button>
                  </div>
                </div>

                <div class="hierarchy-container">
                  <div class="hierarchy-tree-panel">
                    <div v-if="isHierarchyLoading" class="loading-state">
                      <div class="loading-spinner-small"></div>
                      <span>{{
                        translate(
                          "admin.hierarchy.loading",
                          "Loading Hierarchy..."
                        )
                      }}</span>
                    </div>
                    <ul v-else class="hierarchy-list">
                      <li
                        v-for="category in knowledgeHierarchy"
                        :key="category.id"
                        class="hierarchy-category"
                      >
                        <div class="hierarchy-item">
                          <span class="item-name">{{ category.nameEN }}</span>
                          <div class="item-actions">
                            <button
                              class="action-btn"
                              @click="showAddServiceForm(category)"
                              :aria-label="
                                translate(
                                  'admin.hierarchy.addService',
                                  'Add Service'
                                )
                              "
                            >
                              ➕
                            </button>
                            <button
                              class="action-btn"
                              @click="showEditForm(category)"
                              :aria-label="
                                translate(
                                  'admin.hierarchy.editCategory',
                                  'Edit Category'
                                )
                              "
                            >
                              ✏️
                            </button>
                            <button
                              class="action-btn"
                              @click="deleteHierarchyItem(category)"
                              :aria-label="
                                translate(
                                  'admin.hierarchy.deleteCategory',
                                  'Delete Category'
                                )
                              "
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                        <ul
                          v-if="
                            category.services && category.services.length > 0
                          "
                          class="hierarchy-services-list"
                        >
                          <li
                            v-for="service in category.services"
                            :key="service.id"
                          >
                            <div class="hierarchy-item service-item">
                              <span class="item-name">{{
                                service.nameEN
                              }}</span>
                              <div class="item-actions">
                                <button
                                  class="action-btn"
                                  @click="showEditForm(service, category)"
                                  :aria-label="
                                    translate(
                                      'admin.hierarchy.editService',
                                      'Edit Service'
                                    )
                                  "
                                >
                                  ✏️
                                </button>
                                <button
                                  class="action-btn"
                                  @click="
                                    deleteHierarchyItem(service, category)
                                  "
                                  :aria-label="
                                    translate(
                                      'admin.hierarchy.deleteService',
                                      'Delete Service'
                                    )
                                  "
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          </li>
                        </ul>
                      </li>
                      <li
                        v-if="knowledgeHierarchy.length === 0"
                        class="empty-hierarchy"
                      >
                        {{
                          translate(
                            "admin.hierarchy.empty",
                            'No categories found. Click "Add New Category" to start.'
                          )
                        }}
                      </li>
                    </ul>
                  </div>

                  <div
                    v-if="hierarchyForm.visible"
                    class="hierarchy-form-panel"
                  >
                    <h3 class="form-title">{{ hierarchyForm.title }}</h3>
                    <div class="form-group">
                      <label for="hierarchy-name-en">{{
                        translate(
                          "admin.hierarchy.nameEnLabel",
                          "Name (English)"
                        )
                      }}</label>
                      <input
                        type="text"
                        id="hierarchy-name-en"
                        v-model="hierarchyForm.nameEN"
                        class="form-input"
                      />
                    </div>
                    <div class="translations-section">
                      <h4 class="translations-title">
                        {{
                          translate(
                            "admin.hierarchy.translationsTitle",
                            "Translations for Display"
                          )
                        }}
                      </h4>

                      <div
                        v-if="isTranslationsLoading"
                        class="loading-state"
                        style="padding: 1rem 0"
                      >
                        <div class="loading-spinner-small"></div>
                        <span>{{
                          translate(
                            "admin.hierarchy.loadingTranslations",
                            "Loading translations..."
                          )
                        }}</span>
                      </div>

                      <div v-else>
                        <div
                          v-for="(
                            translation, index
                          ) in hierarchyForm.translations"
                          :key="index"
                          class="translation-row"
                        >
                          <select
                            v-model="translation.lang"
                            class="translation-lang-select"
                          >
                            <option disabled value="">
                              {{
                                translate(
                                  "admin.hierarchy.selectLang",
                                  "Select Language"
                                )
                              }}
                            </option>
                            <option
                              v-for="lang in availableLanguages"
                              :key="lang.code"
                              :value="lang.code"
                            >
                              {{ lang.name }} ({{ lang.code }})
                            </option>
                          </select>
                          <input
                            type="text"
                            v-model="translation.text"
                            class="translation-text-input"
                            :placeholder="
                              translate(
                                'admin.hierarchy.translationPlaceholder',
                                'Enter translation'
                              )
                            "
                          />
                          <button
                            class="translation-delete-btn"
                            @click="removeTranslationRow(index)"
                            :aria-label="
                              translate(
                                'admin.hierarchy.deleteTranslation',
                                'Delete Translation'
                              )
                            "
                          >
                            🗑️
                          </button>
                        </div>
                        <button
                          class="btn btn-outline btn-sm"
                          @click="addTranslationRow"
                        >
                          {{
                            translate(
                              "admin.hierarchy.addTranslation",
                              "+ Add Translation"
                            )
                          }}
                        </button>
                      </div>
                    </div>
                    <div class="form-actions">
                      <button
                        class="btn btn-primary"
                        @click="saveHierarchyItem"
                        :disabled="!hierarchyForm.nameEN"
                      >
                        {{ translate("admin.buttons.save", "Save") }}
                      </button>
                      <button
                        class="btn btn-outline"
                        @click="cancelHierarchyForm"
                      >
                        {{ translate("admin.buttons.cancel", "Cancel") }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="activeTab === 'quickhelp' && isAdmin"
                class="dashboard-card"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate("admin.quickHelp.title", "Quick Help Buttons")
                    }}
                  </div>
                  <div class="card-actions">
                    <button
                      class="btn btn-primary"
                      @click="showQuickHelpForm('create')"
                    >
                      {{
                        translate("admin.quickHelp.addButton", "Add Button")
                      }}
                    </button>
                  </div>
                </div>
                <p class="card-description">
                  {{
                    translate(
                      "admin.quickHelp.description",
                      "Buttons shown on the chat landing page. Prompts start conversations — they carry no retrieval labels (DEC-27). Text is bilingual: English is required, Sesotho optional (falls back to English)."
                    )
                  }}
                </p>

                <div v-if="isQuickHelpLoading" class="loading-state">
                  {{ translate("admin.quickHelp.loading", "Loading buttons…") }}
                </div>

                <div v-else class="quickhelp-admin-list">
                  <div
                    v-for="(button, index) in quickHelpButtons"
                    :key="button._key"
                    class="quickhelp-admin-item"
                  >
                    <div class="quickhelp-admin-order">
                      <button
                        class="action-btn"
                        :title="translate('admin.quickHelp.moveUp', 'Move up')"
                        :disabled="index === 0"
                        @click="moveQuickHelpButton(button, -1)"
                      >
                        ↑
                      </button>
                      <button
                        class="action-btn"
                        :title="translate('admin.quickHelp.moveDown', 'Move down')"
                        :disabled="index === quickHelpButtons.length - 1"
                        @click="moveQuickHelpButton(button, 1)"
                      >
                        ↓
                      </button>
                    </div>
                    <img
                      class="quickhelp-admin-icon"
                      :src="button.icon"
                      alt=""
                    />
                    <div class="quickhelp-admin-text">
                      <div class="quickhelp-admin-title">
                        {{ button.title?.en }}
                        <span v-if="button.title?.st" class="quickhelp-admin-st">
                          ({{ button.title.st }})</span
                        >
                        <span
                          v-if="!button.enabled"
                          class="quickhelp-admin-disabled"
                        >
                          —
                          {{
                            translate("admin.quickHelp.disabled", "disabled")
                          }}</span
                        >
                      </div>
                      <div class="quickhelp-admin-prompt">
                        {{ button.prompt?.en }}
                      </div>
                    </div>
                    <label class="quickhelp-admin-toggle">
                      <input
                        type="checkbox"
                        :checked="button.enabled"
                        @change="toggleQuickHelpButton(button)"
                      />
                      {{ translate("admin.quickHelp.enabled", "Enabled") }}
                    </label>
                    <div class="quickhelp-admin-actions">
                      <button
                        class="action-btn"
                        :title="translate('common.edit', 'Edit')"
                        @click="showQuickHelpForm('edit', button)"
                      >
                        ✏️
                      </button>
                      <button
                        class="action-btn"
                        :title="translate('common.delete', 'Delete')"
                        @click="deleteQuickHelpButton(button)"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div v-if="quickHelpButtons.length === 0" class="empty-state">
                    {{
                      translate(
                        "admin.quickHelp.empty",
                        "No buttons — the chat landing page shows an empty grid."
                      )
                    }}
                  </div>
                </div>

                <div v-if="quickHelpForm.visible" class="quickhelp-admin-form">
                  <h4>
                    {{
                      quickHelpForm.mode === "create"
                        ? translate("admin.quickHelp.new", "New Button")
                        : translate("admin.quickHelp.edit", "Edit Button")
                    }}
                  </h4>
                  <div class="form-group">
                    <label>{{
                      translate("admin.quickHelp.titleEN", "Title (English)")
                    }}</label>
                    <input v-model="quickHelpForm.titleEN" type="text" />
                  </div>
                  <div class="form-group">
                    <label>{{
                      translate("admin.quickHelp.titleST", "Title (Sesotho)")
                    }}</label>
                    <input
                      v-model="quickHelpForm.titleST"
                      type="text"
                      :placeholder="
                        translate('admin.quickHelp.optional', 'optional — English shown if empty')
                      "
                    />
                  </div>
                  <div class="form-group">
                    <label>{{
                      translate("admin.quickHelp.promptEN", "Prompt sent (English)")
                    }}</label>
                    <textarea v-model="quickHelpForm.promptEN" rows="2" />
                  </div>
                  <div class="form-group">
                    <label>{{
                      translate("admin.quickHelp.promptST", "Prompt sent (Sesotho)")
                    }}</label>
                    <textarea
                      v-model="quickHelpForm.promptST"
                      rows="2"
                      :placeholder="
                        translate('admin.quickHelp.optional', 'optional — English sent if empty')
                      "
                    />
                  </div>
                  <div class="form-group">
                    <label>{{ translate("admin.quickHelp.icon", "Icon") }}</label>
                    <select v-model="quickHelpForm.iconFile">
                      <option
                        v-for="icon in quickHelpIconOptions"
                        :key="icon"
                        :value="icon"
                      >
                        {{ icon.replace(".svg", "") }}
                      </option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>
                      <input
                        v-model="quickHelpForm.isJustChat"
                        type="checkbox"
                      />
                      {{
                        translate(
                          "admin.quickHelp.isJustChat",
                          "Style as \"Just chat\" tile"
                        )
                      }}
                    </label>
                  </div>
                  <div class="form-actions">
                    <button
                      class="btn btn-primary"
                      :disabled="!quickHelpForm.titleEN || !quickHelpForm.promptEN"
                      @click="saveQuickHelpButton"
                    >
                      {{ translate("admin.buttons.save", "Save") }}
                    </button>
                    <button class="btn btn-outline" @click="cancelQuickHelpForm">
                      {{ translate("admin.buttons.cancel", "Cancel") }}
                    </button>
                  </div>
                </div>
              </div>
              <div
                v-if="activeTab === 'pipelineSettings' && isAdmin"
                class="dashboard-card"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.pipelineSettings.title",
                        "Pipeline Settings — LLM"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button
                      class="btn btn-outline"
                      :disabled="!isPipelineSettingsDirty"
                      @click="discardPipelineSettingsChanges"
                    >
                      {{ translate("admin.pipelineSettings.reset", "Reset") }}
                    </button>
                    <button
                      class="btn btn-primary"
                      :disabled="!isPipelineSettingsDirty"
                      @click="saveLlmSettings"
                    >
                      {{ translate("admin.buttons.save", "Save") }}
                    </button>
                  </div>
                </div>
                <p class="card-description">
                  {{
                    translate(
                      "admin.pipelineSettings.description",
                      "The system prompt, abstention behavior and generation parameters sent to the LLM. Saved values apply to the next chat request — no restart. Explicit per-request API values still win over these."
                    )
                  }}
                </p>

                <div v-if="isPipelineSettingsLoading" class="loading-state">
                  {{
                    translate("admin.pipelineSettings.loading", "Loading settings…")
                  }}
                </div>

                <div v-else class="pipeline-settings-form">
                  <div v-if="llmSettingsWarnings.length" class="pipeline-settings-warnings">
                    {{
                      translate(
                        "admin.pipelineSettings.invalidFileValues",
                        "Settings file has invalid values — showing them as-is; saving will overwrite them"
                      )
                    }}
                    <ul>
                      <li v-for="warning in llmSettingsWarnings" :key="warning">
                        {{ warning }}
                      </li>
                    </ul>
                  </div>
                  <h4>
                    {{ translate("admin.pipelineSettings.llmSection", "LLM") }}
                  </h4>
                  <div class="form-group">
                    <label>{{
                      translate(
                        "admin.pipelineSettings.systemPrompt",
                        "System prompt"
                      )
                    }}</label>
                    <textarea
                      v-model="pipelineSettingsForm.systemPrompt"
                      rows="18"
                      maxlength="8000"
                    />
                  </div>
                  <div class="form-group">
                    <label>
                      <input
                        v-model="pipelineSettingsForm.enforceAbstention"
                        type="checkbox"
                      />
                      {{
                        translate(
                          "admin.pipelineSettings.enforceAbstention",
                          "Enforce abstention when retrieval returns nothing"
                        )
                      }}
                    </label>
                  </div>
                  <div class="form-group">
                    <label>{{
                      translate(
                        "admin.pipelineSettings.abstentionInstructions",
                        "Abstention instructions (empty = default text)"
                      )
                    }}</label>
                    <textarea
                      v-model="pipelineSettingsForm.abstentionInstructions"
                      rows="6"
                      maxlength="4000"
                    />
                  </div>

                  <div class="pipeline-settings-gen-grid">
                    <div
                      v-for="(range, field) in llmGenParamRanges"
                      :key="field"
                      class="form-group"
                    >
                      <label>{{ field }}</label>
                      <input
                        v-model.number="pipelineSettingsForm.generation[field]"
                        type="number"
                        :min="range.min"
                        :max="range.max"
                        :step="range.int ? 1 : 0.01"
                      />
                    </div>
                  </div>
                  <p class="card-description">
                    {{
                      translate(
                        "admin.pipelineSettings.maxTokensHint",
                        "maxTokens interacts with the model-length budget: values above it are clamped (with a server WARN) so chat history keeps headroom."
                      )
                    }}
                  </p>

                  <h4>
                    {{ translate("admin.pipelineSettings.ingestSection", "Ingest") }}
                  </h4>
                  <p class="card-description">
                    {{
                      translate(
                        "admin.pipelineSettings.ingestCaveatLong",
                        "These prompts run at document ingestion — an edit applies at the next re-ingestion, never to already-ingested documents."
                      )
                    }}
                  </p>
                  <div class="form-group">
                    <label>
                      {{
                        translate(
                          "admin.pipelineSettings.labelSelectorPrompt",
                          "Label-selector prompt"
                        )
                      }}
                      <span class="pipeline-settings-caveat">{{
                        translate(
                          "admin.pipelineSettings.reingestCaveat",
                          "applies at next re-ingestion"
                        )
                      }}</span>
                    </label>
                    <textarea
                      v-model="pipelineSettingsForm.ingest.labelSelectorPrompt"
                      rows="12"
                      maxlength="8000"
                    />
                  </div>
                  <div class="form-group">
                    <label>
                      {{
                        translate(
                          "admin.pipelineSettings.contextualRetrievalPrompt",
                          "Contextual-retrieval prompt"
                        )
                      }}
                      <span class="pipeline-settings-caveat">{{
                        translate(
                          "admin.pipelineSettings.reingestCaveat",
                          "applies at next re-ingestion"
                        )
                      }}</span>
                    </label>
                    <textarea
                      v-model="pipelineSettingsForm.ingest.contextualRetrievalPrompt"
                      rows="12"
                      maxlength="8000"
                    />
                  </div>

                  <div class="pipeline-settings-audit">
                    <span v-if="pipelineSettingsAudit.updatedBy">
                      v{{ pipelineSettingsAudit.version }} ·
                      {{ formatDate(pipelineSettingsAudit.updatedAt) }} ·
                      {{ pipelineSettingsAudit.updatedBy }}
                    </span>
                    <span v-else>
                      {{
                        translate(
                          "admin.pipelineSettings.defaults",
                          "defaults (never edited)"
                        )
                      }}
                    </span>
                  </div>
                </div>
              </div>
              <div
                v-if="activeTab === 'pipelineSettings' && isAdmin"
                class="dashboard-card"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.ragTuning.title",
                        "Pipeline Settings — Retrieval"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button
                      class="btn btn-outline"
                      :disabled="!isRagTuningDirty"
                      @click="discardRagTuningChanges"
                    >
                      {{ translate("admin.pipelineSettings.reset", "Reset") }}
                    </button>
                    <button
                      class="btn btn-primary"
                      :disabled="!isRagTuningDirty"
                      @click="saveRagTuning"
                    >
                      {{ translate("admin.buttons.save", "Save") }}
                    </button>
                  </div>
                </div>
                <p class="card-description">
                  {{
                    translate(
                      "admin.ragTuning.description",
                      "Retriever counts, thresholds, graph traversal, hybrid BM25+RRF fusion and the reranker strategy/adaptive parameters. Saved values apply to the next chat request — no restart. Explicit per-request API values still win over these."
                    )
                  }}
                </p>

                <div v-if="isRagTuningLoading" class="loading-state">
                  {{
                    translate("admin.pipelineSettings.loading", "Loading settings…")
                  }}
                </div>

                <div v-else class="pipeline-settings-form">
                  <div v-if="ragTuningWarnings.length" class="pipeline-settings-warnings">
                    {{
                      translate(
                        "admin.ragTuning.invalidFileValues",
                        "Settings file has invalid values — showing them as-is; saving will overwrite them"
                      )
                    }}
                    <ul>
                      <li v-for="warning in ragTuningWarnings" :key="warning">
                        {{ warning }}
                      </li>
                    </ul>
                  </div>
                  <h4>
                    {{ translate("admin.ragTuning.retrieverSection", "Retriever") }}
                  </h4>
                  <div class="pipeline-settings-gen-grid">
                    <div class="form-group">
                      <label>{{
                        translate("admin.ragTuning.searchStart", "searchStart")
                      }}</label>
                      <select v-model="ragTuningForm.retriever.searchStart">
                        <option v-for="opt in ragEnumOptions.searchStart" :key="opt" :value="opt">
                          {{ opt }}
                        </option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>{{
                        translate("admin.ragTuning.searchMode", "searchMode")
                      }}</label>
                      <select v-model="ragTuningForm.retriever.searchMode">
                        <option v-for="opt in ragEnumOptions.searchMode" :key="opt" :value="opt">
                          {{ opt }}
                        </option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>{{
                        translate("admin.ragTuning.filterStrategy", "filterStrategy")
                      }}</label>
                      <select v-model="ragTuningForm.retriever.filterStrategy">
                        <option v-for="opt in ragEnumOptions.filterStrategy" :key="opt" :value="opt">
                          {{ opt }}
                        </option>
                      </select>
                    </div>
                    <div
                      v-for="(range, field) in ragRetrieverRanges"
                      :key="field"
                      class="form-group"
                    >
                      <label>{{ field }}</label>
                      <input
                        v-model.number="ragTuningForm.retriever[field]"
                        type="number"
                        :min="range.min"
                        :max="range.max"
                        :step="range.int ? 1 : 0.01"
                      />
                    </div>
                  </div>
                  <div class="form-group">
                    <label>
                      <input
                        v-model="ragTuningForm.retriever.enableTraversal"
                        type="checkbox"
                      />
                      {{
                        translate(
                          "admin.ragTuning.enableTraversal",
                          "Enable graph traversal (related information)"
                        )
                      }}
                    </label>
                  </div>
                  <div class="form-group">
                    <label>
                      <input
                        v-model="ragTuningForm.retriever.hybridEnabled"
                        type="checkbox"
                      />
                      {{
                        translate(
                          "admin.ragTuning.hybridEnabled",
                          "Enable hybrid BM25 + RRF fusion"
                        )
                      }}
                    </label>
                  </div>
                  <p class="card-description">
                    {{
                      translate(
                        "admin.ragTuning.concurrencyHint",
                        "traversalConcurrentBatches is hard-capped at 4 by the retriever."
                      )
                    }}
                  </p>

                  <h4>
                    {{ translate("admin.ragTuning.rerankerSection", "Reranker") }}
                  </h4>
                  <div class="pipeline-settings-gen-grid">
                    <div class="form-group">
                      <label>{{
                        translate("admin.ragTuning.strategy", "strategy")
                      }}</label>
                      <select v-model="ragTuningForm.reranker.strategy">
                        <option v-for="opt in ragEnumOptions.strategy" :key="opt" :value="opt">
                          {{ opt }}
                        </option>
                      </select>
                    </div>
                    <div
                      v-for="(range, field) in ragRerankerRanges"
                      :key="field"
                      class="form-group"
                    >
                      <label>{{ field }}</label>
                      <input
                        v-model.number="ragTuningForm.reranker[field]"
                        type="number"
                        :min="range.min"
                        :max="range.max"
                        :step="range.int ? 1 : 0.01"
                      />
                    </div>
                  </div>
                  <p class="card-description">
                    {{
                      translate(
                        "admin.ragTuning.adaptiveHint",
                        "The four novelty/decay/min-value parameters only apply when strategy is adaptive."
                      )
                    }}
                  </p>

                  <div class="pipeline-settings-audit">
                    <span v-if="ragTuningAudit.updatedBy">
                      v{{ ragTuningAudit.version }} ·
                      {{ formatDate(ragTuningAudit.updatedAt) }} ·
                      {{ ragTuningAudit.updatedBy }}
                    </span>
                    <span v-else>
                      {{
                        translate(
                          "admin.pipelineSettings.defaults",
                          "defaults (never edited)"
                        )
                      }}
                    </span>
                  </div>
                </div>
              </div>
              <div
                v-if="activeTab === 'documents'"
                class="dashboard-card"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate("admin.documents.title", "Document Management")
                    }}
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="addFromLink">
                      {{
                        translate("admin.documents.addLink", "Add from Link")
                      }}
                    </button>
                    <button class="btn btn-primary" @click="uploadFiles">
                      {{
                        translate("admin.documents.uploadFiles", "Upload Files")
                      }}
                    </button>
                  </div>
                </div>

                <div class="filter-bar">
                  <div class="search-input-container">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="search-icon"
                    >
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="text"
                      v-model="documentSearchTerm"
                      class="search-input"
                      :placeholder="
                        translate(
                          'admin.documents.searchPlaceholder',
                          'Search by file name...'
                        )
                      "
                    />
                  </div>
                  <select
                    v-model="documentFilters.status"
                    class="filter-select"
                  >
                    <option value="all">
                      {{
                        translate("admin.documents.allStatuses", "All Statuses")
                      }}
                    </option>
                    <option value="pending">
                      {{
                        translate("admin.documents.statusPending", "Pending")
                      }}
                    </option>
                    <option value="ingested">
                      {{
                        translate("admin.documents.statusIngested", "Ingested")
                      }}
                    </option>
                    <option value="retracted">
                      {{
                        translate(
                          "admin.documents.statusRetracted",
                          "Retracted"
                        )
                      }}
                    </option>
                  </select>
                  <div class="card-actions" v-if="showIngestButton">
                    <button
                      class="btn btn-primary"
                      @click="handleBatchAction('ingest')"
                    >
                      {{
                        translate(
                          "admin.documents.ingestSelected",
                          "Ingest Selected"
                        )
                      }}
                      ({{ selectedDocuments.length }})
                    </button>
                  </div>
                </div>

                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th class="col-checkbox">
                          <input type="checkbox" @change="selectAllDocuments" />
                        </th>

                        <th
                          class="col-main sortable"
                          @click="sortBy('file_name')"
                        >
                          {{
                            translate(
                              "admin.documents.colFileName",
                              "File Name"
                            )
                          }}
                          <span
                            v-if="sortKey === 'file_name'"
                            class="sort-arrow"
                            >{{
                              sortOrders[sortKey] === "asc" ? "▲" : "▼"
                            }}</span
                          >
                        </th>

                        <th
                          class="col-status sortable"
                          @click="sortBy('dataprep.status')"
                        >
                          {{ translate("admin.documents.colStatus", "Status") }}
                          <span
                            v-if="sortKey === 'dataprep.status'"
                            class="sort-arrow"
                            >{{
                              sortOrders[sortKey] === "asc" ? "▲" : "▼"
                            }}</span
                          >
                        </th>

                        <th class="col-labels">
                          {{ translate("admin.documents.colLabels", "Labels") }}
                        </th>

                        <th
                          class="col-date sortable"
                          @click="sortBy('upload_date')"
                        >
                          {{
                            translate(
                              "admin.documents.colUploadDate",
                              "Upload Date"
                            )
                          }}
                          <span
                            v-if="sortKey === 'upload_date'"
                            class="sort-arrow"
                            >{{
                              sortOrders[sortKey] === "asc" ? "▲" : "▼"
                            }}</span
                          >
                        </th>

                        <th
                          class="col-size sortable"
                          @click="sortBy('file_size')"
                        >
                          {{ translate("admin.documents.colSize", "Size") }}
                          <span
                            v-if="sortKey === 'file_size'"
                            class="sort-arrow"
                            >{{
                              sortOrders[sortKey] === "asc" ? "▲" : "▼"
                            }}</span
                          >
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="isDocumentsLoading">
                        <td colspan="6" class="table-message">
                          <div class="loading-state">
                            <div class="loading-spinner-small"></div>
                            <span>{{
                              translate(
                                "admin.documents.loading",
                                "Loading documents..."
                              )
                            }}</span>
                          </div>
                        </td>
                      </tr>

                      <tr
                        v-if="
                          !isDocumentsLoading &&
                          sortedAndFilteredDocuments.length === 0
                        "
                      >
                        <td colspan="6" class="table-message">
                          {{
                            translate(
                              "admin.documents.empty",
                              "No documents found."
                            )
                          }}
                        </td>
                      </tr>

                      <tr
                        v-for="doc in sortedAndFilteredDocuments"
                        :key="doc._key"
                        @click="viewDocumentDetails(doc.file_id)"
                        class="document-row"
                      >
                        <td @click.stop>
                          <input
                            type="checkbox"
                            v-model="selectedDocuments"
                            :value="doc._key"
                          />
                        </td>
                        <td class="cell-main">{{ doc.file_name }}</td>
                        <td>
                          <span
                            :class="['status-tag', getStatusClass(doc)]"
                          >
                            {{ getDisplayStatus(doc) }}
                          </span>
                        </td>
                        <td>
                          <span
                            v-for="label in doc.labels.slice(0, 2)"
                            :key="label"
                            class="label-tag"
                          >
                            {{ label }}
                          </span>
                          <span
                            v-if="doc.labels.length > 2"
                            class="label-tag-more"
                          >
                            +{{ doc.labels.length - 2 }}
                          </span>
                        </td>
                        <td>
                          {{ new Date(doc.upload_date).toLocaleDateString() }}
                        </td>
                        <td>{{ formatFileSize(doc.file_size) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div
                  class="pagination"
                  v-if="documentPagination.total > documentPagination.limit"
                >
                  <button
                    class="page-btn"
                    :disabled="documentPagination.page <= 1"
                    @click="
                      handleDocumentPagination(documentPagination.page - 1)
                    "
                  >
                    « {{ translate("admin.previous", "Previous") }}
                  </button>

                  <span class="pagination-info">
                    {{ translate("admin.showing", "Showing") }}
                    {{
                      (documentPagination.page - 1) * documentPagination.limit +
                      1
                    }}-{{
                      Math.min(
                        documentPagination.page * documentPagination.limit,
                        documentPagination.total
                      )
                    }}
                    {{ translate("admin.of", "of") }}
                    {{ documentPagination.total }}
                  </span>

                  <button
                    class="page-btn"
                    :disabled="
                      documentPagination.page * documentPagination.limit >=
                      documentPagination.total
                    "
                    @click="
                      handleDocumentPagination(documentPagination.page + 1)
                    "
                  >
                    {{ translate("admin.next", "Next") }} »
                  </button>
                </div>
              </div>

              <!-- Query Inspector Tab -->
              <div
                class="dashboard-card"
                v-if="activeTab === 'queryInspector' && isAIEngineerOrAbove"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.queryInspector",
                        "Query Inspector"
                      )
                    }}
                  </div>
                </div>
                <QueryInspector />
              </div>

              <div
                class="dashboard-card"
                v-if="activeTab === 'database' && isAdmin"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.databaseManagement",
                        "Database Management"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-primary" @click="reindexDatabase">
                      {{
                        translate("admin.reindexDatabase", "Reindex Database")
                      }}
                    </button>
                  </div>
                </div>

                <div class="db-actions">
                  <div class="db-action-card" @click="reindexDatabase">
                    <div class="action-icon">🔄</div>
                    <div class="action-title">
                      {{ translate("admin.dbActions.reindex", "Reindex") }}
                    </div>
                    <div class="action-desc">
                      {{
                        translate(
                          "admin.dbActions.reindexDesc",
                          "Rebuild database indexes"
                        )
                      }}
                    </div>
                  </div>
                  <div class="db-action-card" @click="backupDatabase">
                    <div class="action-icon">💾</div>
                    <div class="action-title">
                      {{ translate("admin.dbActions.backup", "Backup") }}
                    </div>
                    <div class="action-desc">
                      {{
                        translate(
                          "admin.dbActions.backupDesc",
                          "Create database backup"
                        )
                      }}
                    </div>
                  </div>
                  <div class="db-action-card" @click="optimizeDatabase">
                    <div class="action-icon">📊</div>
                    <div class="action-title">
                      {{ translate("admin.dbActions.optimize", "Optimize") }}
                    </div>
                    <div class="action-desc">
                      {{
                        translate(
                          "admin.dbActions.optimizeDesc",
                          "Optimize query performance"
                        )
                      }}
                    </div>
                  </div>
                </div>

                <div class="db-stats">
                  <div>
                    <strong
                      >{{
                        translate("admin.lastReindex", "Last Reindex")
                      }}:</strong
                    >
                    {{ dbStats.lastReindex }}
                  </div>
                  <div>
                    <strong
                      >{{
                        translate("admin.databaseSize", "Database Size")
                      }}:</strong
                    >
                    {{ dbStats.databaseSize }}
                  </div>
                  <div>
                    <strong
                      >{{
                        translate("admin.totalTables", "Total Tables")
                      }}:</strong
                    >
                    {{ dbStats.totalTables }}
                  </div>
                </div>
              </div>

              <div
                class="dashboard-card"
                v-if="activeTab === 'logs' && isAdmin"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{ translate("admin.logManagement", "Log Management") }}
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-outline" @click="searchLogs">
                      <span style="display: flex; align-items: center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="margin-right: 4px"
                        >
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        {{ translate("admin.searchLogs", "Search Logs") }}
                      </span>
                    </button>
                    <button
                      class="btn btn-outline"
                      @click="rolloverLogs"
                      style="margin-left: 8px"
                    >
                      <span style="display: flex; align-items: center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          style="margin-right: 4px"
                        >
                          <path
                            d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1 -.57-8.38"
                          />
                        </svg>
                        {{ translate("admin.rolloverLogs", "Rollover Logs") }}
                      </span>
                    </button>
                  </div>
                </div>

                <div class="log-config-bar">
                  <div class="config-item">
                    <label>{{ translate("admin.logLevel", "Log Level") }}:</label>
                    <select v-model="currentLogLevel" @change="updateLogLevel" class="log-level-select">
                      <option value="error">ERROR</option>
                      <option value="warn">WARN</option>
                      <option value="info">INFO</option>
                      <option value="debug">DEBUG</option>
                    </select>
                  </div>
                  <div class="config-item">
                    <label>{{ translate("admin.logRetention", "Retention") }}:</label>
                    <select v-model="logRetentionDays" @change="updateLogRetention" class="log-level-select">
                      <option value="7d">7 days</option>
                      <option value="14d">14 days</option>
                      <option value="30d">30 days</option>
                      <option value="60d">60 days</option>
                    </select>
                  </div>
                  <div class="config-status" v-if="logConfigStatus">
                    <span :class="['config-status-text', logConfigStatus.type]">{{ logConfigStatus.message }}</span>
                  </div>
                </div>

                <div class="logs-summary">
                  <h3 class="summary-title">
                    <span class="status-indicator error"></span>
                    {{ translate("admin.errorLogs", "Error Logs") }} ({{
                      translate("admin.today", "Today")
                    }})
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate("admin.logType", "Type") }}</th>
                          <th>
                            {{ translate("admin.logService", "Service") }}
                          </th>
                          <th>{{ translate("admin.logCount", "Count") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(log, index) in errorLogsSummary"
                          :key="'error-' + index"
                        >
                          <td>
                            {{
                              translate(
                                `admin.logTypes.${log.typeKey}`,
                                log.type
                              )
                            }}
                          </td>
                          <td>{{ log.service }}</td>
                          <td class="log-count">{{ log.count }}</td>
                        </tr>
                        <tr v-if="errorLogsSummary.length === 0">
                          <td colspan="3" class="empty-logs">
                            {{
                              translate(
                                "admin.noErrorLogs",
                                "No error logs recorded today."
                              )
                            }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="logs-summary">
                  <h3 class="summary-title">
                    <span class="status-indicator warning"></span>
                    {{ translate("admin.warningLogs", "Warning Logs") }} ({{
                      translate("admin.today", "Today")
                    }})
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate("admin.logType", "Type") }}</th>
                          <th>
                            {{ translate("admin.logService", "Service") }}
                          </th>
                          <th>{{ translate("admin.logCount", "Count") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(log, index) in warningLogsSummary"
                          :key="'warning-' + index"
                        >
                          <td>
                            {{
                              translate(
                                `admin.logTypes.${log.typeKey}`,
                                log.type
                              )
                            }}
                          </td>
                          <td>{{ log.service }}</td>
                          <td class="log-count">{{ log.count }}</td>
                        </tr>
                        <tr v-if="warningLogsSummary.length === 0">
                          <td colspan="3" class="empty-logs">
                            {{
                              translate(
                                "admin.noWarningLogs",
                                "No warning logs recorded today."
                              )
                            }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  class="logs-summary"
                  v-if="searchResults && searchResults.length > 0"
                >
                  <h3 class="summary-title">
                    <span class="status-indicator info"></span>
                    {{
                      translate("admin.searchResults", "Latest Search Results")
                    }}
                    <span class="results-count"
                      >({{ searchResults.length }}
                      {{
                        translate("admin.entriesFound", "entries found")
                      }})</span
                    >
                  </h3>
                  <div class="log-summary-table">
                    <table>
                      <thead>
                        <tr>
                          <th>{{ translate("admin.logTime", "Time") }}</th>
                          <th>{{ translate("admin.logLevel", "Level") }}</th>
                          <th>
                            {{ translate("admin.logService", "Service") }}
                          </th>
                          <th>
                            {{ translate("admin.logMessage", "Message") }}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(log, index) in searchResults.slice(0, 5)"
                          :key="'search-' + index"
                        >
                          <td>{{ log.time }}</td>
                          <td>
                            <span
                              :class="[
                                'log-level',
                                `log-${log.level.toLowerCase()}`,
                              ]"
                            >
                              {{
                                translate(
                                  `admin.logLevels.${log.level.toLowerCase()}`,
                                  log.level
                                )
                              }}
                            </span>
                          </td>
                          <td>{{ log.service }}</td>
                          <td>{{ log.message }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div v-if="searchResults.length > 5" class="view-more-logs">
                      <button
                        class="btn btn-outline btn-sm"
                        @click="searchLogs"
                      >
                        {{
                          translate("admin.viewAllResults", "View All Results")
                        }}
                      </button>
                    </div>
                  </div>
                </div>

                <log-search-dialog
                  v-if="showLogSearchDialog"
                  :theme="currentTheme"
                  @close="showLogSearchDialog = false"
                  @search-results="handleSearchResults"
                />

                <div class="logs-info">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>{{
                    translate(
                      "admin.infoLogsNote",
                      "Info logs are not shown in the summary. Use the search function to view all log types."
                    )
                  }}</span>
                </div>
              </div>

              <div
                class="dashboard-card"
                v-if="activeTab === 'security' && isAdmin"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{
                      translate(
                        "admin.securityMonitoring",
                        "Security Monitoring"
                      )
                    }}
                  </div>
                  <div class="card-actions">
                    <button
                      class="btn btn-primary"
                      @click="runSecurityScan"
                      :disabled="
                        isLoading && currentOperation === 'runSecurityScan'
                      "
                    >
                      <span
                        v-if="
                          isLoading && currentOperation === 'runSecurityScan'
                        "
                      >
                        <span class="loading-indicator-inline"></span>
                        {{
                          translate(
                            "admin.runningSecurityScan",
                            "Running Scan..."
                          )
                        }}
                      </span>
                      <span v-else>
                        {{ translate("admin.securityScan", "Security Scan") }}
                      </span>
                    </button>
                  </div>
                </div>

                <div
                  v-if="isLoading && currentOperation === 'runSecurityScan'"
                  class="loading-state"
                >
                  <div class="loading-spinner-small"></div>
                  <span>{{
                    translate(
                      "admin.security.loadingScan",
                      "Loading scan results..."
                    )
                  }}</span>
                </div>

                <div class="security-details" v-if="!isLoading">
                  <div>
                    <strong
                      >{{
                        translate(
                          "admin.lastSecurityScan",
                          "Last Security Scan"
                        )
                      }}:</strong
                    >
                    {{ securityMetrics.lastScan }}
                    <span v-if="securityDetails && securityDetails.scanAge" class="scan-age-notice">
                      ({{ securityDetails.scanAge }})
                    </span>
                  </div>
                  <div v-if="securityDetails && securityDetails.scanDuration">
                    <strong
                      >{{
                        translate(
                          "admin.scanDuration",
                          "Scan Duration"
                        )
                      }}:</strong
                    >
                    {{ securityDetails.scanDuration }}s
                  </div>
                  <div>
                    <strong
                      >{{
                        translate(
                          "admin.vulnerabilitiesFound",
                          "Vulnerabilities Found"
                        )
                      }}:</strong
                    >
                    <span
                      :class="
                        securityMetrics.vulnerabilities.critical > 0
                          ? 'text-danger'
                          : ''
                      "
                    >
                      {{ securityMetrics.vulnerabilities.critical }}
                      {{ translate("admin.critical", "critical") }} </span
                    >,
                    <span
                      :class="
                        securityMetrics.vulnerabilities.medium > 0
                          ? 'text-warning'
                          : ''
                      "
                    >
                      {{ securityMetrics.vulnerabilities.medium }}
                      {{ translate("admin.medium", "medium") }} </span
                    >,
                    <span
                      :class="
                        securityMetrics.vulnerabilities.low > 0
                          ? 'text-info'
                          : ''
                      "
                    >
                      {{ securityMetrics.vulnerabilities.low }}
                      {{ translate("admin.low", "low") }}
                    </span>
                  </div>
                </div>

                <div
                  v-if="!isLoading && securityDetails"
                  class="security-findings-section"
                >
                  <div
                    v-if="
                      securityDetails.vulnerabilityDetails &&
                      securityDetails.vulnerabilityDetails.critical &&
                      securityDetails.vulnerabilityDetails.critical.length > 0
                    "
                    class="vulnerability-section critical-section"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator critical"></span>
                      {{
                        translate(
                          "admin.security.criticalVulnerabilities",
                          "Critical Vulnerabilities"
                        )
                      }}
                    </h3>
                    <div class="vulnerability-list">
                      <div
                        v-for="(vuln, index) in securityDetails
                          .vulnerabilityDetails.critical"
                        :key="'crit-' + index"
                        class="vulnerability-card"
                      >
                        <div class="vuln-type">{{ vuln.type }}</div>
                        <div class="vuln-description">
                          {{ vuln.description }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.severity", "Severity")
                            }}:</strong
                          >
                          {{ vuln.severity }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.occurrences",
                                "Occurrences"
                              )
                            }}:</strong
                          >
                          {{ vuln.occurrences }}
                        </div>
                        <div v-if="vuln.firstSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.firstSeen",
                                "First Seen"
                              )
                            }}:</strong
                          >
                          {{ vuln.firstSeen }}
                        </div>
                        <div v-if="vuln.lastSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.lastSeen", "Last Seen")
                            }}:</strong
                          >
                          {{ vuln.lastSeen }}
                        </div>
                        <div v-if="vuln.matchedTerm" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.matchedTerm",
                                "Matched Term"
                              )
                            }}:</strong
                          >
                          {{ vuln.matchedTerm }}
                        </div>
                        <div v-if="vuln.timestamp" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.timestamp",
                                "Timestamp"
                              )
                            }}:</strong
                          >
                          {{ vuln.timestamp }}
                        </div>
                        <div v-if="vuln.service" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.service", "Service")
                            }}:</strong
                          >
                          {{ vuln.service }}
                        </div>
                        <div v-if="vuln.lineNumber" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumber",
                                "Line Number"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumber }}
                        </div>
                        <div v-if="vuln.url" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.url", "URL")
                            }}:</strong
                          >
                          {{ vuln.url }}
                        </div>
                        <div v-if="vuln.lineNumbers" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumbers",
                                "Line Numbers"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumbers.join(", ") }}
                        </div>
                        <div
                          v-if="vuln.recommendation"
                          class="vuln-recommendation"
                        >
                          {{ vuln.recommendation }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="
                      securityDetails.vulnerabilityDetails &&
                      securityDetails.vulnerabilityDetails.medium &&
                      securityDetails.vulnerabilityDetails.medium.length > 0
                    "
                    class="vulnerability-section medium-section"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator warning"></span>
                      {{
                        translate(
                          "admin.security.mediumVulnerabilities",
                          "Medium Vulnerabilities"
                        )
                      }}
                    </h3>
                    <div class="vulnerability-list">
                      <div
                        v-for="(vuln, index) in securityDetails
                          .vulnerabilityDetails.medium"
                        :key="'med-' + index"
                        class="vulnerability-card"
                      >
                        <div class="vuln-type">{{ vuln.type }}</div>
                        <div class="vuln-description">
                          {{ vuln.description }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.severity", "Severity")
                            }}:</strong
                          >
                          {{ vuln.severity }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.occurrences",
                                "Occurrences"
                              )
                            }}:</strong
                          >
                          {{ vuln.occurrences }}
                        </div>
                        <div v-if="vuln.firstSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.firstSeen",
                                "First Seen"
                              )
                            }}:</strong
                          >
                          {{ vuln.firstSeen }}
                        </div>
                        <div v-if="vuln.lastSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.lastSeen", "Last Seen")
                            }}:</strong
                          >
                          {{ vuln.lastSeen }}
                        </div>
                        <div v-if="vuln.matchedTerm" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.matchedTerm",
                                "Matched Term"
                              )
                            }}:</strong
                          >
                          {{ vuln.matchedTerm }}
                        </div>
                        <div v-if="vuln.timestamp" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.timestamp",
                                "Timestamp"
                              )
                            }}:</strong
                          >
                          {{ vuln.timestamp }}
                        </div>
                        <div v-if="vuln.service" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.service", "Service")
                            }}:</strong
                          >
                          {{ vuln.service }}
                        </div>
                        <div v-if="vuln.lineNumber" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumber",
                                "Line Number"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumber }}
                        </div>
                        <div v-if="vuln.url" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.url", "URL")
                            }}:</strong
                          >
                          {{ vuln.url }}
                        </div>
                        <div v-if="vuln.lineNumbers" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumbers",
                                "Line Numbers"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumbers.join(", ") }}
                        </div>
                        <div
                          v-if="vuln.recommendation"
                          class="vuln-recommendation"
                        >
                          {{ vuln.recommendation }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="
                      securityDetails.vulnerabilityDetails &&
                      securityDetails.vulnerabilityDetails.low &&
                      securityDetails.vulnerabilityDetails.low.length > 0
                    "
                    class="vulnerability-section low-section"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator info"></span>
                      {{
                        translate(
                          "admin.security.lowVulnerabilities",
                          "Low Vulnerabilities"
                        )
                      }}
                    </h3>
                    <div class="vulnerability-list">
                      <div
                        v-for="(vuln, index) in securityDetails
                          .vulnerabilityDetails.low"
                        :key="'low-' + index"
                        class="vulnerability-card"
                      >
                        <div class="vuln-type">{{ vuln.type }}</div>
                        <div class="vuln-description">
                          {{ vuln.description }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.severity", "Severity")
                            }}:</strong
                          >
                          {{ vuln.severity }}
                        </div>
                        <div class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.occurrences",
                                "Occurrences"
                              )
                            }}:</strong
                          >
                          {{ vuln.occurrences }}
                        </div>
                        <div v-if="vuln.firstSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.firstSeen",
                                "First Seen"
                              )
                            }}:</strong
                          >
                          {{ vuln.firstSeen }}
                        </div>
                        <div v-if="vuln.lastSeen" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.lastSeen", "Last Seen")
                            }}:</strong
                          >
                          {{ vuln.lastSeen }}
                        </div>
                        <div v-if="vuln.matchedTerm" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.matchedTerm",
                                "Matched Term"
                              )
                            }}:</strong
                          >
                          {{ vuln.matchedTerm }}
                        </div>
                        <div v-if="vuln.timestamp" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.timestamp",
                                "Timestamp"
                              )
                            }}:</strong
                          >
                          {{ vuln.timestamp }}
                        </div>
                        <div v-if="vuln.service" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.service", "Service")
                            }}:</strong
                          >
                          {{ vuln.service }}
                        </div>
                        <div v-if="vuln.lineNumber" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumber",
                                "Line Number"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumber }}
                        </div>
                        <div v-if="vuln.url" class="vuln-detail">
                          <strong
                            >{{
                              translate("admin.security.url", "URL")
                            }}:</strong
                          >
                          {{ vuln.url }}
                        </div>
                        <div v-if="vuln.lineNumbers" class="vuln-detail">
                          <strong
                            >{{
                              translate(
                                "admin.security.lineNumbers",
                                "Line Numbers"
                              )
                            }}:</strong
                          >
                          {{ vuln.lineNumbers.join(", ") }}
                        </div>
                        <div
                          v-if="vuln.recommendation"
                          class="vuln-recommendation"
                        >
                          {{ vuln.recommendation }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="
                      securityDetails &&
                      securityDetails.vulnerabilityDetails &&
                      ((securityDetails.vulnerabilityDetails.critical &&
                        securityDetails.vulnerabilityDetails.critical.length > 0) ||
                      (securityDetails.vulnerabilityDetails.medium &&
                        securityDetails.vulnerabilityDetails.medium.length > 0))
                    "
                    class="security-recommendations"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator info"></span>
                      {{
                        translate(
                          "admin.securityRecommendations",
                          "Security Recommendations"
                        )
                      }}
                    </h3>
                    <div class="recommendations-list">
                      <div
                        v-if="
                          securityDetails.vulnerabilityDetails.critical &&
                          securityDetails.vulnerabilityDetails.critical.length > 0
                        "
                        class="recommendation-item severity-critical"
                      >
                        <div class="recommendation-header">
                          <span class="severity-indicator critical"></span>
                          <span class="recommendation-title">{{
                            translate(
                              "admin.security.criticalIssuesDetected",
                              "Critical Security Issues Detected"
                            )
                          }}</span>
                        </div>
                        <div class="recommendation-description">
                          {{
                            securityDetails.vulnerabilityDetails.critical.length
                          }}
                          {{
                            translate(
                              "admin.security.criticalIssuesDesc",
                              "critical vulnerabilities detected that require immediate attention"
                            )
                          }}
                        </div>
                        <div class="recommendation-action">
                          <strong
                            >{{
                              translate(
                                "admin.security.recommendedAction",
                                "Recommended Action"
                              )
                            }}:</strong
                          >
                          {{
                            translate(
                              "admin.security.criticalRecommendation",
                              "Review and address all critical findings immediately. These may include invalid tokens, injection attempts, or command execution attempts that could compromise system integrity."
                            )
                          }}
                        </div>
                      </div>
                      <div
                        v-if="
                          securityDetails.vulnerabilityDetails.critical &&
                          securityDetails.vulnerabilityDetails.critical.some(
                            (v) => v.type === 'command_injection'
                          )
                        "
                        class="recommendation-item severity-critical"
                      >
                        <div class="recommendation-header">
                          <span class="severity-indicator critical"></span>
                          <span class="recommendation-title">{{
                            translate(
                              "admin.security.commandInjectionDetected",
                              "Command Injection Attempts Detected"
                            )
                          }}</span>
                        </div>
                        <div class="recommendation-description">
                          {{
                            securityDetails.vulnerabilityDetails.critical.filter(
                              (v) => v.type === 'command_injection'
                            ).length
                          }}
                          {{
                            translate(
                              "admin.security.commandInjectionDesc",
                              "command injection attempts detected in request payloads"
                            )
                          }}
                        </div>
                        <div class="recommendation-action">
                          <strong
                            >{{
                              translate(
                                "admin.security.recommendedAction",
                                "Recommended Action"
                              )
                            }}:</strong
                          >
                          {{
                            translate(
                              "admin.security.commandInjectionRecommendation",
                              "Implement strict input validation and sanitization on all user inputs. Consider adding WAF rules to block common injection patterns and review IP blocking for repeat offenders."
                            )
                          }}
                        </div>
                      </div>
                      <div
                        v-if="
                          securityDetails.vulnerabilityDetails.critical &&
                          securityDetails.vulnerabilityDetails.critical.some(
                            (v) => v.type === 'attack_attempt'
                          )
                        "
                        class="recommendation-item severity-critical"
                      >
                        <div class="recommendation-header">
                          <span class="severity-indicator critical"></span>
                          <span class="recommendation-title">{{
                            translate(
                              "admin.security.attackAttemptsDetected",
                              "XSS/SQL Injection/CSRF Attempts Detected"
                            )
                          }}</span>
                        </div>
                        <div class="recommendation-description">
                          {{
                            securityDetails.vulnerabilityDetails.critical.filter(
                              (v) => v.type === 'attack_attempt'
                            ).length
                          }}
                          {{
                            translate(
                              "admin.security.attackAttemptsDesc",
                              "web application attack attempts detected"
                            )
                          }}
                        </div>
                        <div class="recommendation-action">
                          <strong
                            >{{
                              translate(
                                "admin.security.recommendedAction",
                                "Recommended Action"
                              )
                            }}:</strong
                          >
                          {{
                            translate(
                              "admin.security.attackAttemptsRecommendation",
                              "Ensure Web Application Firewall (WAF) is active, verify input sanitization across all endpoints, and consider implementing Content Security Policy headers."
                            )
                          }}
                        </div>
                      </div>
                      <div
                        v-for="(group, index) in groupedMediumRecommendations"
                        :key="'med-rec-' + index"
                        class="recommendation-item severity-medium"
                      >
                        <div class="recommendation-header">
                          <span class="severity-indicator medium"></span>
                          <span class="recommendation-title">{{ group.title }}</span>
                        </div>
                        <div class="recommendation-description">
                          {{ group.count }}
                          {{ group.count === 1 ? translate("admin.security.occurrence", "occurrence") : translate("admin.security.occurrencesPlural", "occurrences") }}
                          {{ translate("admin.security.detectedInScanWindow", "detected in scan window") }}
                        </div>
                        <div class="recommendation-action">
                          <strong
                            >{{
                              translate(
                                "admin.security.recommendedAction",
                                "Recommended Action"
                              )
                            }}:</strong
                          >
                          {{ group.recommendation }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="
                      securityDetails.failedLoginDetails &&
                      securityDetails.failedLoginDetails.length > 0
                    "
                    class="vulnerability-section login-section"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator warning"></span>
                      {{
                        translate(
                          "admin.security.authenticationIssues",
                          "Authentication Issues"
                        )
                      }}
                    </h3>
                    <div class="detail-table">
                      <table>
                        <thead>
                          <tr>
                            <th style="width: 25%">
                              {{
                                translate(
                                  "admin.security.timestamp",
                                  "Timestamp"
                                )
                              }}
                            </th>
                            <th style="width: 15%">
                              {{ translate("admin.security.type", "Type") }}
                            </th>
                            <th>
                              {{
                                translate("admin.security.message", "Message")
                              }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(
                              issue, index
                            ) in securityDetails.failedLoginDetails"
                            :key="'login-' + index"
                          >
                            <td>{{ issue.timestamp }}</td>
                            <td>
                              <span
                                v-if="issue.type"
                                :class="[
                                  'log-level',
                                  `log-${issue.type.toLowerCase()}`,
                                ]"
                              >
                                {{ issue.type }}
                              </span>
                            </td>
                            <td class="log-message-cell">
                              {{ issue.message }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div
                    v-if="
                      securityDetails.suspiciousDetails &&
                      securityDetails.suspiciousDetails.length > 0
                    "
                    class="vulnerability-section suspicious-section"
                  >
                    <h3 class="section-title">
                      <span class="severity-indicator warning"></span>
                      {{
                        translate(
                          "admin.security.suspiciousActivityLogs",
                          "Suspicious Activity Logs"
                        )
                      }}
                    </h3>
                    <div class="detail-table">
                      <table>
                        <thead>
                          <tr>
                            <th style="width: 25%">
                              {{
                                translate(
                                  "admin.security.timestamp",
                                  "Timestamp"
                                )
                              }}
                            </th>
                            <th style="width: 15%">
                              {{ translate("admin.security.type", "Type") }}
                            </th>
                            <th>
                              {{
                                translate("admin.security.message", "Message")
                              }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="(
                              activity, index
                            ) in securityDetails.suspiciousDetails"
                            :key="'suspicious-' + index"
                          >
                            <td>{{ activity.timestamp }}</td>
                            <td>
                              <span
                                v-if="activity.type"
                                :class="[
                                  'log-level',
                                  `log-${activity.type.toLowerCase()}`,
                                ]"
                              >
                                {{ activity.type }}
                              </span>
                            </td>
                            <td class="log-message-cell">
                              {{ activity.message }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div
                    v-if="
                      !isLoading &&
                      securityDetails &&
                      (!securityDetails.vulnerabilityDetails ||
                        (securityDetails.vulnerabilityDetails.critical
                          .length === 0 &&
                          securityDetails.vulnerabilityDetails.medium.length ===
                            0 &&
                          securityDetails.vulnerabilityDetails.low.length ===
                            0 &&
                          (!securityDetails.failedLoginDetails ||
                            securityDetails.failedLoginDetails.length === 0)))
                    "
                    class="no-vulnerabilities"
                  >
                    <div class="empty-state">
                      <div class="empty-icon">✓</div>
                      <div class="empty-title">
                        {{
                          translate(
                            "admin.security.noVulnerabilitiesFound",
                            "No Vulnerabilities Found"
                          )
                        }}
                      </div>
                      <div class="empty-description">
                        {{
                          translate(
                            "admin.security.systemSecure",
                            "Your system appears to be secure. Continue monitoring regularly."
                          )
                        }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                class="dashboard-card"
                v-if="activeTab === 'users' && isAdmin"
                style="grid-column: span 2"
              >
                <div class="card-header">
                  <div class="card-title">
                    {{ translate("admin.userManagement", "User Management") }}
                  </div>
                </div>

                <div class="user-stats-summary">
                  <div class="stats-row">
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{
                          translate("admin.totalUsers", "Total Users")
                        }}:</span
                      >
                      <span class="stat-value">{{ userStats.totalUsers }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{
                          translate(
                            "admin.monthlyActiveUsers",
                            "Currently Active Users (CAU)"
                          )
                        }}:</span
                      >
                      <span class="stat-value">{{
                        userStats.activeUsers
                      }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{
                          translate("admin.newUsers", "New Users (Month)")
                        }}:</span
                      >
                      <span class="stat-value">{{ userStats.newUsers }}</span>
                    </div>
                  </div>
                </div>

                <!-- Pending Users Section -->
                <div v-if="pendingUsers.length > 0" class="pending-users-section">
                  <div class="pending-users-header">
                    <h3 class="pending-users-title">
                      <span class="pending-icon">⏳</span>
                      {{ translate("admin.pendingApprovals", "Pending Approvals") }}
                      <span class="pending-count-badge">{{ pendingUsers.length }}</span>
                    </h3>
                  </div>
                  <table class="log-table pending-table">
                    <thead>
                      <tr>
                        <th>{{ translate("admin.userName", "Name") }}</th>
                        <th>{{ translate("admin.userEmail", "Email") }}</th>
                        <th>{{ translate("admin.registeredAt", "Registered") }}</th>
                        <th>{{ translate("admin.assignRole", "Assign Role") }}</th>
                        <th>{{ translate("admin.userActions", "Actions") }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="user in pendingUsers" :key="user._key">
                        <td>{{ user.fullName || user.loginName }}</td>
                        <td>{{ user.email }}</td>
                        <td>{{ formatDate(user.createdAt) }}</td>
                        <td>
                          <select v-model="user.assignRole" class="role-select-small">
                            <option value="User">User</option>
                            <option value="Manager">Manager</option>
                            <option value="AI Engineer">AI Engineer</option>
                            <option value="Admin">Admin</option>
                          </select>
                        </td>
                        <td class="action-buttons">
                          <button
                            class="btn btn-success btn-sm"
                            @click="approveUser(user)"
                            :disabled="isApprovingUser === user._key"
                          >
                            {{ isApprovingUser === user._key ? '...' : translate("admin.approve", "Approve") }}
                          </button>
                          <button
                            class="btn btn-danger btn-sm"
                            @click="rejectUser(user)"
                            :disabled="isApprovingUser === user._key"
                          >
                            {{ translate("admin.reject", "Reject") }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="search-bar">
                  <div class="search-input-container">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="search-icon"
                    >
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="text"
                      class="search-input"
                      v-model="userSearchTerm"
                      :placeholder="
                        translate('admin.searchUsers', 'Search users...')
                      "
                      @keyup.enter="searchUsers"
                    />
                    <button
                      v-if="userSearchTerm"
                      class="search-clear-btn"
                      @click="resetUserSearch"
                      :aria-label="
                        translate('admin.clearSearch', 'Clear search')
                      "
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>

                  <div class="search-filter">
                    <select
                      v-model="userSearchField"
                      class="search-field-select"
                    >
                      <option value="all">
                        {{ translate("admin.searchFields.all", "All Fields") }}
                      </option>
                      <option value="name">
                        {{ translate("admin.searchFields.name", "Name") }}
                      </option>
                      <option value="email">
                        {{ translate("admin.searchFields.email", "Email") }}
                      </option>
                      <option value="role">
                        {{ translate("admin.searchFields.role", "Role") }}
                      </option>
                    </select>
                  </div>

                  <div class="search-button">
                    <button
                      class="btn btn-primary"
                      @click="searchUsers"
                      :disabled="isSearchingUsers"
                    >
                      {{ translate("admin.search", "Search") }}
                    </button>
                  </div>
                </div>

                <div class="search-results-info" v-if="userSearchResults">
                  <span>
                    {{ userSearchTotal }}
                    {{ translate("admin.usersFound", "users found") }}
                    <button
                      v-if="userSearchResults"
                      class="btn btn-outline btn-sm"
                      @click="resetUserSearch"
                    >
                      {{ translate("admin.showAllUsers", "Show All Users") }}
                    </button>
                  </span>
                </div>

                <div class="search-loading" v-if="isSearchingUsers">
                  <div class="loading-spinner-small"></div>
                  <span>{{
                    translate("admin.searching", "Searching...")
                  }}</span>
                </div>

                <table class="log-table">
                  <thead>
                    <tr>
                      <th>{{ translate("admin.userName", "Name") }}</th>
                      <th>{{ translate("admin.userEmail", "Email") }}</th>
                      <th>{{ translate("admin.userRole", "Role") }}</th>
                      <th>{{ translate("admin.userStatus", "Status") }}</th>
                      <th>{{ translate("admin.userActions", "Actions") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="user in displayedUsers" :key="user._key">
                      <td>{{ user.fullName || user.loginName }}</td>
                      <td>{{ user.email }}</td>
                      <td>{{ user.role }}</td>
                      <td>
                        <span :class="['status-tag', getUserStatusClass(user)]">
                          {{ getUserStatusLabel(user) }}
                        </span>
                      </td>
                      <td>
                        <button
                          class="btn btn-outline"
                          style="padding: 0.25rem 0.5rem"
                          @click="openUserEditDialog(user._key)"
                        >
                          {{ translate("admin.edit", "Edit") }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="displayedUsers.length === 0">
                      <td colspan="5" style="text-align: center; padding: 2rem">
                        <div v-if="isSearchingUsers">
                          {{
                            translate(
                              "admin.searchingUsers",
                              "Searching for users..."
                            )
                          }}
                        </div>
                        <div v-else-if="userSearchResults !== null">
                          {{
                            translate(
                              "admin.noUsersFound",
                              "No users found matching your search criteria."
                            )
                          }}
                        </div>
                        <div v-else>
                          {{
                            translate("admin.noUsers", "No users available.")
                          }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div
                  class="pagination"
                  v-if="userSearchResults && userSearchTotal > userSearchLimit"
                >
                  <button
                    class="page-btn"
                    :disabled="userSearchOffset === 0"
                    @click="
                      handleUserSearchPagination(
                        Math.max(0, userSearchOffset - userSearchLimit)
                      )
                    "
                  >
                    « {{ translate("admin.previous", "Previous") }}
                  </button>

                  <span class="pagination-info">
                    {{ translate("admin.showing", "Showing") }}
                    {{ userSearchOffset + 1 }}-{{
                      Math.min(
                        userSearchOffset + userSearchLimit,
                        userSearchTotal
                      )
                    }}
                    {{ translate("admin.of", "of") }} {{ userSearchTotal }}
                  </span>

                  <button
                    class="page-btn"
                    :disabled="
                      userSearchOffset + userSearchLimit >= userSearchTotal
                    "
                    @click="
                      handleUserSearchPagination(
                        userSearchOffset + userSearchLimit
                      )
                    "
                  >
                    {{ translate("admin.next", "Next") }} »
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="loading-overlay" v-if="isLoading">
      <div class="loading-spinner"></div>
      <p>
        {{
          currentOperation
            ? translate(
                `admin.operations.${currentOperation}.loading`,
                `Processing ${currentOperation}...`
              )
            : translate("admin.loading", "Loading...")
        }}
      </p>
    </div>

    <OperationResultsModal
      v-if="showOperationResults && operationResults"
      :operation="currentOperation"
      :results="operationResults"
      @close="closeOperationResults"
    />

    <UserEditDialog
      v-if="showUserEditDialog"
      :userId="selectedUserId"
      @close="showUserEditDialog = false"
      @user-updated="handleUserUpdated"
    />

    <UploadFilesDialog
      v-if="showUploadDialog"
      @close="showUploadDialog = false"
      @files-uploaded="handleFilesUploaded"
    />

    <AddFromLinkDialog
      v-if="showLinkDialog"
      @close="showLinkDialog = false"
      @link-submitted="handleLinkSubmitted"
    />

    <FileDetailsDialog
      v-if="showDetailsDialog"
      :file-id="selectedFileId"
      @close="showDetailsDialog = false"
      @file-updated="handleFileUpdated"
      @action-triggered="handleFileAction"
    />

    <ConfirmDialog
      :visible="confirmDialogState.visible"
      :title="confirmDialogState.title"
      :message="confirmDialogState.message"
      :confirmText="confirmDialogState.confirmText"
      :cancelText="confirmDialogState.cancelText"
      :theme="currentTheme"
      @confirm="confirmDialogState.onConfirm"
      @cancel="confirmDialogState.onCancel"
    />
  </div>
</template>

<script>
import serviceTreeService from "../services/serviceTreeService.js";
import databaseOperationsService from "../services/databaseOperationsService";
import adminDashboardService from "../services/adminDashboardService";
import OperationResultsModal from "./OperationResultsModal.vue";
import LogSearchDialog from "./LogSearchDialog.vue";
import UserEditDialog from "./UserEditDialog.vue";
import UploadFilesDialog from "./UploadFilesDialog.vue";
import AddFromLinkDialog from "./AddFromLinkDialog.vue";
import FileDetailsDialog from "./FileDetailsDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue"; // IMPORT ConfirmDialog
import QueryInspector from "./QueryInspector.vue";
import { eventBus } from "../eventBus.js";
import { availableLanguages } from "../config/languageConfig.js";
import documentFileService from "../services/documentFileService.js";
import labelService from "../services/labelService.js";
import quickhelpService from "../services/quickhelpService.js";

export default {
  components: {
    OperationResultsModal,
    LogSearchDialog,
    UserEditDialog,
    UploadFilesDialog,
    AddFromLinkDialog,
    FileDetailsDialog,
    ConfirmDialog, // REGISTER ConfirmDialog
    QueryInspector,
  },
  name: "AdminDashboard",
  emits: ["close"],
  data() {
    return {
      // Properties for the Document Management table
      sortKey: "upload_date", // Default sort column
      sortOrders: {
        file_name: "asc",
        "dataprep.status": "asc",
        upload_date: "desc", // Default to newest first
        file_size: "asc",
      },

      // Placeholder for form state
      originalHierarchyFormState: null,

      // State for loading translations
      isTranslationsLoading: false,

      // Configuration for language dropdowns in translations tables
      availableLanguages: availableLanguages,

      // Current locale for translations
      currentLocale: this.getCurrentLanguage(),

      securityDetails: null,
      showAllLogins: false,
      showAllSuspicious: false,
      debugSecurity: true,
      // Theme settings
      currentTheme:
        document.documentElement.getAttribute("data-theme") || "light",

      // Tab navigation
      activeTab: "overview",
      tabs: [
        { id: "overview", label: "System Health" },
        { id: "hierarchy", label: "Knowledge Hierarchy" },
        { id: "quickhelp", label: "Quick Help Buttons" },
        { id: "documents", label: "Document Management" },
        { id: "queryInspector", label: "Query Inspector" },
        { id: "pipelineSettings", label: "Pipeline Settings" },
        { id: "database", label: "Database" },
        { id: "logs", label: "Logs" },
        { id: "security", label: "Security" },
        { id: "users", label: "Users" },
      ],

      // Loading state
      isLoading: false,

      // Operation in progress
      currentOperation: null,

      // Operation results
      operationResults: null,

      // System health services — placeholders are NEUTRAL (audit F7): the
      // old fabricated warning/error rows painted failures that never came
      // from a probe. Real statuses replace these on a successful fetch.
      healthServices: [
        { id: "apiServices", name: "API Services", status: "unknown" },
        { id: "database", name: "Database", status: "unknown" },
        { id: "cache", name: "Cache", status: "unknown" },
        { id: "storage", name: "Storage", status: "unknown" },
        { id: "messageQueue", name: "Message Queue", status: "unknown" },
        { id: "externalApi", name: "External API", status: "unknown" },
      ],

      // Database stats
      dbStats: {
        lastReindex: "5 days ago",
        databaseSize: "42.3 GB",
        totalTables: 128,
      },

      // Resource usage metrics
      resourceUsage: [
        { id: "cpu", label: "CPU Usage", value: 42 },
        { id: "memory", label: "Memory Usage", value: 78 },
        { id: "storage", label: "Storage Usage", value: 92 },
        { id: "network", label: "Network Bandwidth", value: 35 },
      ],

      logs: [],

      // CORRECTED: Hardcoded data removed. Initialized as empty arrays.
      errorLogsSummary: [],
      warningLogsSummary: [],

      // AI Configuration
      aiConfig: null,

      showLogSearchDialog: false,
      currentLogLevel: 'info',
      logRetentionDays: '14d',
      logConfigStatus: null,

      featureFlags: [
        {
          id: "enhancedSearch",
          name: "Enhanced Search",
          description: "Enable AI-powered search capabilities",
          enabled: true,
        },
        {
          id: "newDashboardUi",
          name: "New Dashboard UI",
          description: "Updated user interface for dashboards",
          enabled: false,
        },
        {
          id: "bulkProcessingApi",
          name: "Bulk Processing API",
          description: "Enable bulk data processing endpoints",
          enabled: true,
        },
      ],

      alertConfigs: [
        {
          id: "cpuUsage",
          title: "CPU Usage > 90%",
          channels: "Email, SMS to System Admin",
          enabled: true,
        },
        {
          id: "errorRate",
          title: "Error Rate > 1%",
          channels: "Email to Dev Team, Slack #alerts",
          enabled: true,
        },
        {
          id: "lowStorage",
          title: "Storage < 10%",
          channels: "Email, SMS, Automated cleanup",
          enabled: true,
        },
      ],

      maintenanceMode: false,
      showAlertsConfig: false,
      showOperationResults: false,

      metrics: {
        systemUptime: 99.98,
        avgResponseTime: 245,
        errorRate: 0.05,
        monthlyActiveUsers: 0,
      },

      logFilter: {
        level: "",
        service: "",
      },

      logsTotal: 1284,

      securityMetrics: {
        failedLoginAttempts: 23,
        suspiciousActivities: 5,
        lastSecurityScan: "2 days ago",
        vulnerabilities: {
          critical: 0,
          medium: 2,
          low: 5,
        },
      },

      userStats: {
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        users: [],
      },

      showUserEditDialog: false,
      selectedUserId: null,

      searchResults: [],

      status: {
        info: {
          color: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
        },
      },

      userSearchTerm: "",
      userSearchField: "all",
      isSearchingUsers: false,
      userSearchResults: null,
      userSearchTotal: 0,
      userSearchLimit: 20,
      userSearchOffset: 0,

      // Pending users approval
      pendingUsers: [],
      isApprovingUser: null,

      // --- START: NEW DATA FOR HIERARCHY & DOCUMENTS ---
      isHierarchyLoading: false,
      knowledgeHierarchy: [],
      hierarchyForm: {
        visible: false,
        mode: null,
        title: "",
        _key: null,
        nameEN: "",
        translations: [], // Array for translation objects
        parentId: null,
      },
      documents: [], // Remove the old hardcoded data and start with an empty array
      isDocumentsLoading: false,
      documentPagination: {
        page: 1,
        limit: 15, // You can adjust the number of items per page
        total: 0,
      },
      // The existing properties below are already correct
      documentSearchTerm: "",
      documentFilters: {
        status: "all",
      },
      selectedDocuments: [],

      // --- START: QUICK HELP BUTTONS (J.4, DEC-28) ---
      quickHelpButtons: [], // admin view: all buttons incl. disabled, sorted by order
      isQuickHelpLoading: false,
      originalQuickHelpFormState: null, // stringify snapshot for the dirty check
      quickHelpForm: {
        visible: false,
        mode: null, // 'create' | 'edit'
        _key: null,
        titleEN: "",
        titleST: "",
        promptEN: "",
        promptST: "",
        iconFile: "crop-management.svg",
        isJustChat: false,
      },
      // The 17 SVGs baked into the frontend image (admin picks from these;
      // nothing else would resolve — see spec-j4 icon boundary)
      quickHelpIconOptions: [
        "just-chat.svg",
        "crop-management.svg",
        "soil-fertilizers.svg",
        "pest-control.svg",
        "livestock.svg",
        "weather-climate.svg",
        "market-prices.svg",
        "water-management.svg",
        "government-programs.svg",
        "business-trade.svg",
        "education-learning.svg",
        "employment-labor.svg",
        "healthcare-social.svg",
        "housing-urban.svg",
        "identity-civil.svg",
        "taxes-revenue.svg",
        "transportation-mobility.svg",
      ],
      // --- END: QUICK HELP BUTTONS ---

      // --- START: PIPELINE SETTINGS (K.2, DEC-29) ---
      isPipelineSettingsLoading: false,
      pipelineSettingsAudit: { version: null, updatedAt: null, updatedBy: null },
      originalPipelineSettingsState: null, // stringify snapshot for the dirty check
      pipelineSettingsForm: {
        systemPrompt: "",
        enforceAbstention: true,
        abstentionInstructions: "",
        generation: {
          temperature: 0.01,
          topP: 0.95,
          repetitionPenalty: 1.03,
          frequencyPenalty: 0.0,
          presencePenalty: 0.0,
          maxTokens: 8192,
        },
        ingest: {
          labelSelectorPrompt: "",
          contextualRetrievalPrompt: "",
        },
      },
      // Mirrors the backend schema (routes/admin-routes.js) — client-side
      // range blocking so bad values never leave the browser.
      llmGenParamRanges: {
        temperature: { min: 0, max: 2 },
        topP: { min: 0, max: 1 },
        repetitionPenalty: { min: 0.01, max: 2 },
        frequencyPenalty: { min: -2, max: 2 },
        presencePenalty: { min: -2, max: 2 },
        maxTokens: { min: 256, max: 32768, int: true },
      },
      // --- END: PIPELINE SETTINGS ---

      // --- START: RAG TUNING (K.3, DEC-29) ---
      isRagTuningLoading: false,
      ragTuningAudit: { version: null, updatedAt: null, updatedBy: null },
      originalRagTuningState: null, // stringify snapshot for the dirty check
      ragTuningForm: {
        retriever: {
          retrievalK: 20,
          fetchK: 30,
          scoreThreshold: 0.2,
          lambdaMult: 0.5,
          searchStart: "chunk",
          searchMode: "vector",
          filterStrategy: "OR",
          enableTraversal: true,
          traversalMaxDepth: 2,
          traversalMaxReturned: 5,
          traversalScoreThreshold: 0.7,
          traversalConcurrentBatches: 4,
          hybridEnabled: true,
          hybridRrfK: 60,
          hybridDenseWeight: 1.0,
          hybridLexicalWeight: 1.0,
          hybridBm25Candidates: 50,
        },
        reranker: {
          strategy: "slice",
          threshold: 0.75,
          topN: 3,
          noveltySigmoidA: 20.0,
          noveltySigmoidB: 0.25,
          contextDecayFactor: 0.0025,
          minValueThreshold: -1.0,
        },
      },
      // Mirrors the backend rag-tuning schema (routes/admin-routes.js) —
      // enum option lists + number bounds for client-side blocking. NO
      // artificial maxes: a bound the backend doesn't enforce would brick
      // every save of a backend-legal file value client-side. Omitted
      // min/max = unbounded on that side; `exclusive` = strictly greater.
      ragEnumOptions: {
        searchStart: ["chunk", "edge", "node"],
        searchMode: ["vector", "hybrid"],
        filterStrategy: ["AND", "OR"],
        strategy: ["slice", "threshold", "knee_threshold", "slice_threshold", "adaptive"],
      },
      ragRetrieverRanges: {
        retrievalK: { min: 1, int: true },
        fetchK: { min: 1, int: true },
        scoreThreshold: { min: 0, max: 1 },
        lambdaMult: { min: 0, max: 1 },
        traversalMaxDepth: { min: 1, int: true },
        traversalMaxReturned: { min: 1, int: true },
        traversalScoreThreshold: { min: 0, max: 1 },
        traversalConcurrentBatches: { min: 1, max: 4, int: true },
        hybridRrfK: { min: 1, int: true },
        hybridDenseWeight: { min: 0 },
        hybridLexicalWeight: { min: 0 },
        hybridBm25Candidates: { min: 1, int: true },
      },
      ragRerankerRanges: {
        threshold: { min: 0, max: 1 },
        topN: { min: 1, int: true },
        noveltySigmoidA: { min: 0, exclusive: true },
        noveltySigmoidB: { min: 0, max: 1 },
        contextDecayFactor: { min: 0 },
        minValueThreshold: {},
      },
      // GET warnings (K.3): garbage-typed values in the on-disk files,
      // surfaced by the backend schema pass — banner text + field messages.
      llmSettingsWarnings: [],
      ragTuningWarnings: [],
      // --- END: RAG TUNING ---

      // --- END: DOCUMENT and HIERARCHY DATA ---

      showUploadDialog: false,
      showLinkDialog: false,
      showDetailsDialog: false,
      selectedFileId: null,

      // --- ADDED: State for ConfirmDialog ---
      confirmDialogState: {
        visible: false,
        title: "",
        message: "",
        confirmText: "OK",
        cancelText: "Cancel",
        onConfirm: () => {},
        onCancel: () => {},
      },
    };
  },
  computed: {
    // J.4: snapshot-based dirty check for the quick-help form (mirrors
    // isFormDirty's stringify-compare — a bare visible check cried wolf).
    isQuickHelpFormDirty() {
      return (
        this.quickHelpForm.visible &&
        this.originalQuickHelpFormState !== null &&
        JSON.stringify(this.quickHelpForm) !== this.originalQuickHelpFormState
      );
    },

    // K.2: snapshot-based dirty check for the pipeline-settings form (J.4
    // pattern — stringify-compare against the loaded state).
    isPipelineSettingsDirty() {
      return (
        this.originalPipelineSettingsState !== null &&
        JSON.stringify(this.pipelineSettingsForm) !== this.originalPipelineSettingsState
      );
    },

    // K.3: snapshot-based dirty check for the rag-tuning form (same J.4
    // pattern; one dirty state per settings FILE).
    isRagTuningDirty() {
      return (
        this.originalRagTuningState !== null &&
        JSON.stringify(this.ragTuningForm) !== this.originalRagTuningState
      );
    },

    // Filter tabs based on user role
    filteredTabs() {
      const adminOnly = ['database', 'logs', 'security', 'users', 'quickhelp', 'pipelineSettings'];
      const aiEngineerUp = ['queryInspector'];
      // Overview only shows for Admin (it has system health data)
      const overviewAdminOnly = ['overview'];

      return this.tabs.filter(tab => {
        if (overviewAdminOnly.includes(tab.id)) return this.isAdmin;
        if (adminOnly.includes(tab.id)) return this.isAdmin;
        if (aiEngineerUp.includes(tab.id)) return this.isAIEngineerOrAbove;
        return true; // hierarchy, documents — visible to all
      });
    },

    // A4: user comes from the Vuex auth module (OIDC claims) — the legacy
    // localStorage 'user' key no longer exists (same pattern as NavBarComponent)
    currentUser() {
      return this.$store.getters.currentUser;
    },

    // Check if current user has Admin role (roles array from realm_access claims)
    isAdmin() {
      const roles = this.currentUser?.roles || [];
      return roles.some((role) => role.toLowerCase() === 'admin');
    },

    // Check if current user has AI Engineer or Admin role
    isAIEngineerOrAbove() {
      const roles = this.currentUser?.roles || [];
      return roles.some((role) => ['ai engineer', 'admin'].includes(role.toLowerCase()));
    },

    // L.5: "auto → gpu" when auto-mode picked GPU; bare type when forced or
    // uninitialized (never "gpu → gpu"). Missing activeType = stale backend
    // image (pre-L.5 payload) — degrade to the mode, never "auto → undefined".
    translationBackendDisplay() {
      const t = this.aiConfig?.translation;
      if (!t) return '';
      if (!t.activeType) return t.backend;
      if (t.backend === t.activeType) return t.activeType;
      return `${t.backend} → ${t.activeType}`;
    },

    // Dynamic security recommendations derived from actual findings
    groupedMediumRecommendations() {
      if (
        !this.securityDetails ||
        !this.securityDetails.vulnerabilityDetails ||
        !this.securityDetails.vulnerabilityDetails.medium ||
        this.securityDetails.vulnerabilityDetails.medium.length === 0
      ) {
        return [];
      }

      // Group medium findings by type and aggregate
      const typeMap = new Map();
      for (const vuln of this.securityDetails.vulnerabilityDetails.medium) {
        const key = vuln.type || 'unknown';
        if (!typeMap.has(key)) {
          typeMap.set(key, {
            title: vuln.description || key,
            recommendation: vuln.recommendation || 'Review and address this finding.',
            count: vuln.occurrences || 1,
            type: key,
          });
        } else {
          typeMap.get(key).count += (vuln.occurrences || 1);
        }
      }

      return Array.from(typeMap.values());
    },

    // Test if there are unsaved changes
    isFormDirty() {
      if (!this.originalHierarchyFormState) {
        return false;
      }
      // Compare the stringified versions of the current and original form states
      return (
        JSON.stringify(this.hierarchyForm) !== this.originalHierarchyFormState
      );
    },

    // User list to display (either search results or all users)
    displayedUsers() {
      // If we have search results, show them
      if (this.userSearchResults) {
        return this.userSearchResults;
      }

      // If we're actively searching but have no results yet
      if (this.isSearchingUsers) {
        return [];
      }

      // Otherwise, show all users
      return this.userStats.users || [];
    },

    /**
     * Performs client-side filtering on the documents array based on the selected status.
     */
    filteredDocuments() {
      const selectedStatus = this.documentFilters.status;
      if (!this.documents || this.documents.length === 0) {
        return [];
      }
      if (selectedStatus === "all") {
        return this.documents; // If 'All' is selected, return the full list
      }
      return this.documents.filter(
        (doc) => doc.dataprep && doc.dataprep.status === selectedStatus
      );
    },

    sortedAndFilteredDocuments() {
      // Get the currently filtered list
      const filtered = this.filteredDocuments;
      if (!this.sortKey) return filtered;

      // Get the current sort direction
      const order = this.sortOrders[this.sortKey] || "asc";
      const multiplier = order === "asc" ? 1 : -1;

      // Make a copy and sort it
      return [...filtered].sort((a, b) => {
        let valA, valB;

        // Handle nested properties like 'dataprep.status'
        if (this.sortKey.includes(".")) {
          const keys = this.sortKey.split(".");
          valA = a[keys[0]][keys[1]];
          valB = b[keys[0]][keys[1]];
        } else {
          valA = a[this.sortKey];
          valB = b[this.sortKey];
        }

        // Comparison logic
        if (valA < valB) return -1 * multiplier;
        if (valA > valB) return 1 * multiplier;
        return 0;
      });
    },

    showIngestButton() {
      // 1. Don't show if no documents are selected
      if (this.selectedDocuments.length === 0) {
        return false;
      }

      // 2. Create a Set of selected keys for efficient lookup
      const selectedKeys = new Set(this.selectedDocuments);

      // 3. Find all the full document objects that are currently selected
      const selectedDocObjects = this.documents.filter((doc) =>
        selectedKeys.has(doc._key)
      );

      // 4. Check if ANY of the selected documents have the status 'ingested'
      const hasIngestedFile = selectedDocObjects.some(
        (doc) => doc.dataprep && doc.dataprep.status === "ingested"
      );

      // 5. Only show the button if there are selected files AND none of them are ingested
      return !hasIngestedFile;
    },
  },
  watch: {
    "$i18n.locale"(newLocale) {
      console.log("Locale changed in AdminDashboard:", newLocale);
      this.currentLocale = newLocale;
      this.$forceUpdate();
    },
    activeTab(newTab) {
      if (newTab === "hierarchy" && this.knowledgeHierarchy.length === 0) {
        this.loadKnowledgeHierarchy();
      }
    },

    documentSearchTerm() {
      // A debounce would be ideal here in a real app, but this works
      this.documentPagination.page = 1; // Reset to first page on new search
      this.loadDocuments();
    },
    documentFilters: {
      handler() {
        this.documentPagination.page = 1; // Reset to first page on filter change
        this.loadDocuments();
      },
      deep: true,
    },
  },
  created() {
    // Initialize with the current language settings
    this.currentLocale = this.$i18n ? this.$i18n.locale : "en";
  },
  mounted() {
    // Apply current language settings
    if (this.$i18n) {
      this.$i18n.locale = this.currentLocale;
    }

    // Apply theme from localStorage or default
    this.applyTheme(this.currentTheme);

    // Listen for theme changes from other components
    window.addEventListener("themeChange", this.handleThemeChange);

    // Set default tab based on role
    if (this.filteredTabs.length > 0 && !this.filteredTabs.find(t => t.id === this.activeTab)) {
      this.activeTab = this.filteredTabs[0].id;
    }

    // Load initial data for the dashboard
    this.loadInitialData();
  },
  beforeUnmount() {
    // Clean up event listeners when component is destroyed
    window.removeEventListener("themeChange", this.handleThemeChange);
  },
  methods: {
    // --- ADDED: Methods for ConfirmDialog ---
    /**
     * Shows a confirmation dialog.
     * @param {object} options - Dialog options.
     */
    showConfirmDialog({
      title,
      message,
      confirmText,
      cancelText,
      onConfirm,
      onCancel,
    }) {
      this.confirmDialogState = {
        visible: true,
        title: title || this.translate("admin.confirm.defaultTitle", "Confirm"),
        message:
          message ||
          this.translate("admin.confirm.defaultMessage", "Are you sure?"),
        confirmText: confirmText || this.translate("common.ok", "OK"),
        cancelText: cancelText || this.translate("common.cancel", "Cancel"),
        onConfirm: () => {
          if (onConfirm) onConfirm();
          this.resetConfirmDialog();
        },
        onCancel: () => {
          if (onCancel) onCancel();
          this.resetConfirmDialog();
        },
      };
    },

    /**
     * Resets the confirmation dialog state to hide it.
     */
    resetConfirmDialog() {
      this.confirmDialogState = {
        visible: false,
        title: "",
        message: "",
        confirmText: "OK",
        cancelText: "Cancel",
        onConfirm: () => {},
        onCancel: () => {},
      };
    },
    // --- END: Methods for ConfirmDialog ---

    /**
     * Handle document list pagination.
     */
    handleDocumentPagination(newPage) {
      if (
        newPage > 0 &&
        (newPage - 1) * this.documentPagination.limit <
          this.documentPagination.total
      ) {
        this.documentPagination.page = newPage;
        this.loadDocuments();
      }
    },

    /**
     * Sets the sort key and toggles the sort order.
     */
    sortBy(key) {
      if (this.sortKey === key) {
        // If clicking the same column, reverse the order
        this.sortOrders[key] = this.sortOrders[key] === "asc" ? "desc" : "asc";
      } else {
        // If clicking a new column, set it as the sort key
        this.sortKey = key;
      }
    },

    // Translation method - improved to ensure consistent behavior with SettingsComponent
    translate(key, fallback = "") {
      if (!this.$i18n) {
        // console.warn(`[AdminDashboard] $i18n not available. Using fallback for: ${key}`);
        return fallback;
      }
      try {
        // Force the correct locale
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        // Return fallback if the key is returned (meaning no translation found)
        if (translation === key) {
          // console.warn(`[AdminDashboard] No translation for key: ${key}. Using fallback.`);
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error(`[AdminDashboard] Translation error for key ${key}:`, e);
        return fallback || key;
      }
    },

    // Get current language from i18n or localStorage
    getCurrentLanguage() {
      // First try to get from i18n instance
      if (this.$i18n && this.$i18n.locale) {
        return this.$i18n.locale;
      }

      // Fallback to localStorage
      try {
        const savedLocale = localStorage.getItem("userLocale");
        if (savedLocale) {
          return savedLocale;
        }
      } catch (e) {
        console.warn("Error accessing localStorage for language:", e);
      }

      // Default to English if nothing else works
      return "en";
    },

    // Change language
    changeLanguage() {
      if (this.$i18n) {
        // Set the i18n locale
        this.$i18n.locale = this.currentLocale;

        // Save to localStorage
        try {
          localStorage.setItem("userLocale", this.currentLocale);
        } catch (e) {
          console.warn("Error saving language preference:", e);
        }

        // Force update this component
        this.$forceUpdate();
      }
    },

    // Toggle between light and dark theme
    toggleTheme() {
      const newTheme = this.currentTheme === "light" ? "dark" : "light";
      this.applyTheme(newTheme);
    },

    // Apply theme
    applyTheme(theme) {
      // Update local state
      this.currentTheme = theme;

      // Save to localStorage
      localStorage.setItem("theme", theme);

      // Apply to document
      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);

      // Update class names
      if (theme === "dark") {
        document.documentElement.classList.add("dark-mode");
        document.documentElement.classList.remove("light-mode");
        document.body.classList.remove("light-mode");
        document.body.classList.add("dark-mode");
      } else {
        document.documentElement.classList.remove("dark-mode");
        document.documentElement.classList.add("light-mode");
        document.body.classList.remove("dark-mode");
        document.body.classList.add("light-mode");
      }
    },

    // Handle theme change event from other components
    handleThemeChange(event) {
      if (event.detail && event.detail.theme) {
        this.applyTheme(event.detail.theme);
      }
    },

    // Get current effective theme
    getCurrentTheme() {
      return this.currentTheme;
    },

    // Set active tab
    setActiveTab(tabId) {
      // Step 1: Guard against unsaved changes before doing anything else.
      // quickhelp uses its own snapshot-based dirty check (J.4 review F8 —
      // a bare visible-proxy cried wolf on an untouched form) and its own
      // copy keys so the hierarchy-scoped cancel text never leaks in.
      // pipelineSettings (K.2) follows the same snapshot pattern.
      if (
        (this.activeTab === "hierarchy" && this.isFormDirty) ||
        (this.activeTab === "quickhelp" && this.isQuickHelpFormDirty) ||
        (this.activeTab === "pipelineSettings" &&
          (this.isPipelineSettingsDirty || this.isRagTuningDirty))
      ) {
        // MODIFIED: Use ConfirmDialog. Copy is per-tab: hierarchy keys exist
        // in locales, quickhelp/pipelineSettings keys don't — translate()
        // then renders the English fallbacks below (J.4 review F8).
        const isQuickHelp = this.activeTab === "quickhelp";
        const isPipelineSettings = this.activeTab === "pipelineSettings";
        this.showConfirmDialog({
          title: this.translate(
            isQuickHelp
              ? "admin.quickHelp.confirmSwitchTitle"
              : isPipelineSettings
                ? "admin.pipelineSettings.confirmSwitchTitle"
                : "admin.hierarchy.confirmCancelTitle",
            "Unsaved Changes"
          ),
          message: this.translate(
            isQuickHelp
              ? "admin.quickHelp.confirmSwitchMessage"
              : isPipelineSettings
                ? "admin.pipelineSettings.confirmSwitchMessage"
                : "admin.hierarchy.confirmCancelEdit",
            isQuickHelp
              ? "You have unsaved button edits. Switch tabs and discard them?"
              : isPipelineSettings
                ? "You have unsaved pipeline settings. Switch tabs and discard them?"
                : "You have unsaved changes that will be lost. Are you sure you want to switch tabs?"
          ),
          confirmText: this.translate("admin.buttons.switch", "Switch Anyway"),
          cancelText: this.translate("common.cancel", "Cancel"),
          onConfirm: () => {
            // User confirmed, proceed with tab switch
            this.activeTab = tabId;
            this.originalHierarchyFormState = null; // Reset form state
            this._closeQuickHelpForm(); // F8: the confirmed-away form must actually close
            this.originalPipelineSettingsState = null; // K.2: same for settings
            this.originalRagTuningState = null; // K.3: same for rag-tuning
            this.loadDataForTab(tabId); // Load data for the new tab
          },
          onCancel: () => {
            // User canceled, do nothing
          },
        });
        return; // Stop the original flow
      }

      // Step 2: Proceed with the tab switch
      console.log(
        `[AdminDashboard] Setting active tab to: ${tabId}, current securityDetails:`,
        this.securityDetails
      );
      this.activeTab = tabId;
      this.originalHierarchyFormState = null; // Reset form state when leaving the hierarchy tab

      // Step 3: Load the necessary data for the newly selected tab
      this.loadDataForTab(tabId);
    },

    // --- ADDED: Helper to load data based on tab ID ---
    loadDataForTab(tabId) {
      if (tabId === "database") {
        this.loadDatabaseStats();
      } else if (tabId === "logs") {
        this.loadLogsSummary();
        this.loadLogs();
      } else if (tabId === "security") {
        console.log(
          `[AdminDashboard] Loading security tab, isLoading: ${this.isLoading}`
        );
        this.loadSecurityMetrics();
      } else if (tabId === "users") {
        this.loadUserStats();
      } else if (tabId === "documents") {
        this.loadDocuments();
      } else if (
        tabId === "hierarchy" &&
        this.knowledgeHierarchy.length === 0
      ) {
        this.loadKnowledgeHierarchy();
      } else if (tabId === "quickhelp") {
        this.loadQuickHelpButtons();
      } else if (tabId === "pipelineSettings") {
        this.loadLlmSettings();
        this.loadRagTuning();
      }
    },

    // Get usage level based on percentage
    getUsageLevel(value) {
      if (value < 50) return "low";
      if (value < 80) return "medium";
      return "high";
    },

    // Show notification using the event bus
    showNotification(message, type = "success", duration = 3000) {
      eventBus.$emit("notification:show", {
        message,
        type,
        duration,
      });
    },

    // Load system health data
    async loadSystemHealth() {
      try {
        this.isLoading = true;
        // Get the data object directly from the service
        const data = await adminDashboardService.getSystemHealth();

        // Check if the data and its 'metrics' property exist
        if (data && data.metrics) {
          // Update metrics
          this.metrics = {
            systemUptime: data.metrics.systemUptime,
            avgResponseTime: data.metrics.avgResponseTime,
            errorRate: data.metrics.errorRate,
            monthlyActiveUsers: data.metrics.monthlyActiveUsers,
          };

          // Update health services
          this.healthServices = data.healthServices;

          // Update resource usage
          this.resourceUsage = Object.keys(data.resourceUsage)
            .filter((id) => {
              // Only show resource bars for valid percentage metrics
              const val = data.resourceUsage[id];
              return val !== null && val !== undefined && 
                ['cpu', 'memory', 'storage', 'network', 'gpu', 'gpuMemory'].includes(id);
            })
            .map((id) => ({
              id,
              label: this.getResourceLabel(id),
              value: data.resourceUsage[id],
            }));
        } else {
          // Log a warning if data is missing, which helps in debugging
          console.warn("Received invalid system health data:", data);
          this.showNotification("Failed to parse system health data", "error");
        }
      } catch (error) {
        console.error("Error loading system health:", error);
        this.showNotification("Failed to load system health data", "error");
      } finally {
        this.isLoading = false;
      }
    },

    // Load AI configuration
    async loadAIConfig() {
      try {
        this.aiConfig = await adminDashboardService.getAIConfig();
      } catch (error) {
        console.error("Error loading AI config:", error);
      }
    },

    // Get resource label
    getResourceLabel(resourceId) {
      const labels = {
        cpu: this.translate("admin.resources.cpu", "CPU Usage"),
        memory: this.translate("admin.resources.memory", "Memory Usage"),
        storage: this.translate("admin.resources.storage", "Storage Usage"),
        network: this.translate("admin.resources.network", "Network Bandwidth"),
        gpu: this.translate("admin.resources.gpu", "GPU Usage"),
        gpuMemory: this.translate("admin.resources.gpuMemory", "GPU Memory"),
      };
      return labels[resourceId] || resourceId;
    },

    // Load logs
    async loadLogs() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getLogs({
          limit: 20, // Get more logs than we'll display in the summary
          level: this.logFilter ? this.logFilter.level : "",
          service: this.logFilter ? this.logFilter.service : "",
        });

        if (response && response.data && response.data.data) {
          this.logs = response.data.data.logs || [];
          this.logsTotal = response.data.data.total || 0;
        }
      } catch (error) {
        console.error("Error loading logs:", error);
        this.showNotification("Failed to load logs", "error");
      } finally {
        this.isLoading = false;
      }
    },

    // Load log summaries from the API
    async loadLogsSummary() {
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getLogsSummary({
          date: new Date().toISOString().split("T")[0],
        });
        console.log(
          "[AdminDashboard] Logs summary response:",
          JSON.stringify(response, null, 2)
        );

        if (
          response &&
          response.data &&
          Array.isArray(response.data.errors) &&
          Array.isArray(response.data.warnings)
        ) {
          this.errorLogsSummary = response.data.errors || [];
          this.warningLogsSummary = response.data.warnings || [];
          if (
            this.errorLogsSummary.length === 0 &&
            this.warningLogsSummary.length === 0
          ) {
            this.showNotification(
              this.translate("admin.noLogsFound", "No logs found for today"),
              "info"
            );
          }
        } else {
          console.error(
            "[AdminDashboard] Invalid logs summary response structure:",
            response
          );
          this.showNotification(
            this.translate(
              "admin.invalidLogsResponse",
              "Invalid logs summary response structure"
            ),
            "error"
          );
          this.errorLogsSummary = [];
          this.warningLogsSummary = [];
        }
      } catch (error) {
        console.error(
          "[AdminDashboard] Error loading logs summary:",
          error.message,
          error.stack
        );
        this.showNotification(
          this.translate(
            "admin.logsSummaryError",
            "Failed to load logs summary"
          ),
          "error"
        );
        this.errorLogsSummary = [];
        this.warningLogsSummary = [];
      } finally {
        this.isLoading = false;
      }
    },

    // Security operations (This is a corrected/combined version)
    async runSecurityScan() {
      console.log(
        "[AdminDashboard] Starting runSecurityScan, isLoading:",
        this.isLoading
      );
      if (this.isLoading && this.currentOperation === "runSecurityScan") return; // Prevent double-click

      this.isLoading = true;
      this.currentOperation = "runSecurityScan";

      try {
        const response = await adminDashboardService.runSecurityScan();
        console.log("[AdminDashboard] Security scan API response:", response);

        if (response.success) {
          console.log(
            "[AdminDashboard] Security scan completed successfully:",
            response.data
          );
          await this.loadSecurityDetails(); // This fetches all necessary details
          this.securityMetrics.lastScan = this.translate(
            "admin.security.lastScanJustNow",
            "Just now"
          ); // Update last scan time
          // Update vulnerability counts from the detailed response
          if (
            this.securityDetails &&
            this.securityDetails.vulnerabilityDetails
          ) {
            this.securityMetrics.vulnerabilities = {
              critical:
                this.securityDetails.vulnerabilityDetails.critical.length,
              medium: this.securityDetails.vulnerabilityDetails.medium.length,
              low: this.securityDetails.vulnerabilityDetails.low.length,
            };
          }
          this.$forceUpdate();
          this.showNotification(
            this.translate(
              "admin.operations.runSecurityScan.success",
              "Security scan completed successfully"
            ),
            "success"
          );
        } else {
          throw new Error(response.message || "Security scan failed");
        }

        console.log(
          "[AdminDashboard] After scan, securityDetails:",
          this.securityDetails
        );
      } catch (error) {
        console.error("[AdminDashboard] Error running security scan:", error);
        this.showNotification(
          this.translate(
            "admin.operations.runSecurityScan.error",
            "Failed to run security scan"
          ),
          "error"
        );
      } finally {
        this.isLoading = false;
        this.currentOperation = null;
        console.log(
          "[AdminDashboard] runSecurityScan complete, isLoading:",
          this.isLoading,
          "currentOperation:",
          this.currentOperation
        );
      }
    },

    // Search logs method - launches the search dialog
    searchLogs() {
      // Make sure the current theme is properly set
      this.currentTheme =
        document.documentElement.getAttribute("data-theme") || "light";

      // Show the log search dialog
      this.showLogSearchDialog = true;

      // Load error and warning log summaries if they haven't been loaded yet
      if (
        this.activeTab === "logs" &&
        !this.errorLogsSummary.length &&
        !this.warningLogsSummary.length
      ) {
        this.loadLogsSummary();
      }
    },

    // Handle search results from the LogSearchDialog component
    handleSearchResults(results) {
      // Store the search results
      this.searchResults = results;

      // Notify the user about the results
      if (results.length === 0) {
        this.showNotification(
          this.translate(
            "admin.logSearch.noResultsFound",
            "No logs matched your search criteria"
          ),
          "info"
        );
      } else {
        this.showNotification(
          this.translate(
            "admin.logSearch.resultsFound",
            `Found {count} log entries`
          ).replace("{count}", results.length), // Added placeholder replacement
          "success"
        );

        // If we're not on the logs tab, switch to it to display the results
        if (this.activeTab !== "logs") {
          this.setActiveTab("logs");
        }
      }
    },

    // Log operations
    async rolloverLogs() {
      this.executeOperation("rolloverLogs", async () => {
        const response = await adminDashboardService.rolloverLogs();
        // Refresh logs after rollover
        if (response.data && response.data.success) {
          await Promise.all([this.loadLogsSummary(), this.loadLogs()]);
        }
        return response.data;
      });
    },

    // Update log level configuration
    async updateLogLevel() {
      try {
        await adminDashboardService.configureLogger({ level: this.currentLogLevel });
        this.logConfigStatus = { type: 'success', message: `Log level set to ${this.currentLogLevel.toUpperCase()}` };
        setTimeout(() => { this.logConfigStatus = null; }, 3000);
      } catch (error) {
        console.error('Error updating log level:', error);
        this.logConfigStatus = { type: 'error', message: 'Failed to update log level' };
        setTimeout(() => { this.logConfigStatus = null; }, 3000);
      }
    },

    // Update log retention configuration
    async updateLogRetention() {
      try {
        await adminDashboardService.configureLogger({
          errorMaxFiles: this.logRetentionDays,
          combinedMaxFiles: this.logRetentionDays
        });
        this.logConfigStatus = { type: 'success', message: `Retention set to ${this.logRetentionDays}` };
        setTimeout(() => { this.logConfigStatus = null; }, 3000);
      } catch (error) {
        console.error('Error updating log retention:', error);
        this.logConfigStatus = { type: 'error', message: 'Failed to update retention' };
        setTimeout(() => { this.logConfigStatus = null; }, 3000);
      }
    },

    // Load security metrics
    async loadSecurityMetrics() {
      console.log("[AdminDashboard] Loading security metrics...");
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSecurityMetrics();
        if (response && response.data) {
          console.log(
            "[AdminDashboard] Security metrics loaded successfully:",
            response.data
          );
          this.securityMetrics = {
            failedLoginAttempts: response.data.failedLoginAttempts || 0,
            suspiciousActivities: response.data.suspiciousActivities || 0,
            lastSecurityScan: response.data.lastSecurityScan || "Never",
            vulnerabilities: response.data.vulnerabilities || {
              critical: 0,
              medium: 0,
              low: 0,
            },
          };
          // Also load the details when metrics are loaded
          await this.loadSecurityDetails();
        } else {
          console.warn(
            "[AdminDashboard] Security metrics response missing data property"
          );
        }
      } catch (error) {
        console.error(
          "[AdminDashboard] Error loading security metrics:",
          error
        );
        this.securityMetrics = {
          failedLoginAttempts: 0,
          suspiciousActivities: 0,
          lastSecurityScan: "Never",
          vulnerabilities: {
            critical: 0,
            medium: 0,
            low: 0,
          },
        };
      } finally {
        this.isLoading = false;
      }
    },

    // Load user stats
    async loadUserStats() {
      // This now acts as a trigger for the initial, full, paginated user list.
      await this.searchUsers();
      await this.loadPendingUsers();
    },

    // System diagnostics
    async runDiagnostics() {
      this.executeOperation("runDiagnostics", async () => {
        const response = await adminDashboardService.runDiagnostics();
        return response.data;
      });
    },

    // Load all dashboard data
    async loadInitialData() {
      if (this.isAdmin) {
        this.loadSystemHealth();
        this.loadAIConfig();
      } else if (this.isAIEngineerOrAbove) {
        this.loadAIConfig();
      }
      this.loadDataForTab(this.activeTab); // Call the helper
    },

    // Load database statistics
    async loadDatabaseStats() {
      try {
        // Call the stats endpoint if it exists
        const response = await databaseOperationsService.getDatabaseStats();
        if (response && response.data) {
          this.dbStats = response.data;
        }
      } catch (error) {
        console.error("Error loading database stats:", error);
        // Just log the error, don't show a notification since this is background loading
      }
    },

    // Database operations
    async reindexDatabase() {
      this.executeOperation("reindexDatabase", async () => {
        const response = await databaseOperationsService.reindexDatabase();
        // Update the last reindex time if successful
        if (response.data && response.data.success) {
          this.dbStats.lastReindex = "Just now";
        }
        return response.data;
      });
    },

    async backupDatabase() {
      this.executeOperation("backupDatabase", async () => {
        const response = await databaseOperationsService.backupDatabase();
        return response.data;
      });
    },

    async optimizeDatabase() {
      this.executeOperation("optimizeDatabase", async () => {
        const response = await databaseOperationsService.optimizeDatabase();
        return response.data;
      });
    },

    // Job operations
    viewAllJobs() {
      this.showOperation("viewAllJobs");
    },

    cancelJob(jobId) {
      this.showOperation("cancelJob", { jobId });
    },

    restartJob(jobId) {
      this.showOperation("restartJob", { jobId });
    },

    // Feature flag operations
    addNewFlag() {
      this.showOperation("addNewFlag");
    },

    updateFeatureFlag(feature) {
      this.showOperation("updateFeatureFlag", {
        id: feature.id,
        enabled: feature.enabled,
      });
    },

    // Alert operations
    addNewAlert() {
      this.showOperation("addNewAlert");
    },

    updateAlertConfig(alert) {
      this.showOperation("updateAlertConfig", {
        id: alert.id,
        enabled: alert.enabled,
      });
    },

    saveAlertConfigs() {
      this.showOperation("saveAlertConfigs");
      this.showAlertsConfig = false;
    },

    // Deployment operations
    deployVersion() {
      this.showOperation("deployVersion");
    },

    toggleMaintenanceMode() {
      this.showOperation("toggleMaintenanceMode", {
        enabled: this.maintenanceMode,
      });
    },

    // Performance operations
    viewDetailedMetrics() {
      this.showOperation("viewDetailedMetrics");
    },

    // Helper to execute database operations with proper loading and error handling
    async executeOperation(operation, apiCall) {
      try {
        // Set loading state and operation name
        this.isLoading = true;
        this.currentOperation = operation;
        this.operationResults = null;

        // Execute the API call
        const result = await apiCall();

        // Set operation results for potential display
        this.operationResults = result;

        // Show success notification
        if (result && result.success) {
          // Case 1: Standard success (e.g., { success: true, ... })
          this.showNotification(
            this.translate(
              `admin.operations.${operation}.success`,
              `Operation ${operation} completed successfully`
            ),
            "success"
          );
        } else if (result === undefined || result === null) {
          // Case 2: Success with an empty body (e.g., 200 OK from diagnostics)
          this.showNotification(
            this.translate(
              `admin.operations.${operation}.success`,
              `Operation ${operation} completed successfully`
            ),
            "success"
          );
        } else {
          // Case 3: A failure response (e.g., { success: false, message: '...' })
          throw new Error(result.message || `Failed to ${operation}`);
        }

        // Return the result
        return result;
      } catch (error) {
        // Set error result
        this.operationResults = {
          success: false,
          message:
            error.message ||
            this.translate(
              `admin.operations.${operation}.error`,
              `Error during ${operation}`
            ),
          error: error.response?.data?.error || error.message,
        };

        // Show error notification
        this.showNotification(this.operationResults.message, "error");

        console.error(`Error during ${operation}:`, error);
        return this.operationResults;
      } finally {
        // Reset loading state
        this.isLoading = false;

        // Optionally show results modal
        if (this.operationResults) {
          this.showOperationResults = true;
        }
      }
    },

    // Legacy method for operations that are not yet implemented with real API calls
    showOperation(operation, data = {}) {
      // In a real app, this would make API calls
      // For now, just show loading and a notification
      this.isLoading = true;
      this.currentOperation = operation;

      setTimeout(() => {
        this.isLoading = false;
        this.currentOperation = null;
        console.log(`Operation ${operation} executed with data:`, data);

        // If using the notification service via event bus:
        this.showNotification(
          this.translate(
            `admin.operations.${operation}.success`,
            `Operation ${operation} completed successfully`
          ),
          "info"
        );
      }, 1500);
    },

    // Close the operation results modal
    closeOperationResults() {
      this.showOperationResults = false;
    },

    // Open user edit dialog
    openUserEditDialog(userId) {
      console.log(`UserId clicked:`, userId);
      this.selectedUserId = userId;
      console.log(`this.selectedUserId:`, this.selectedUserId);
      this.showUserEditDialog = true;
      console.log(`this.showUserEditDialog`, this.showUserEditDialog);
    },

    // Handle user updated event from dialog
    handleUserUpdated(updatedData) {
      console.log("User updated:", updatedData);

      // Refresh user list if we're on the Users tab
      if (this.activeTab === "users") {
        this.loadUserStats();
      }

      // Show notification
      this.showNotification(
        this.translate(
          "admin.userEdit.userUpdated",
          "User updated successfully"
        ),
        "success"
      );
    },

    /**
     * Search users from the server
     */
    async searchUsers() {
      this.isSearchingUsers = true;
      try {
        // On initial load (no search term, first page), fetch the detailed stats.
        if (this.userSearchOffset === 0 && !this.userSearchTerm) {
          // This call specifically gets the active/new/total user counts
          const statsResponse = await adminDashboardService.getUserStats();
          if (statsResponse) {
            this.userStats.totalUsers = statsResponse.totalUsers;
            this.userStats.activeUsers = statsResponse.activeUsers;
            this.userStats.newUsers = statsResponse.newUsers;
          }
        }

        // This call gets the paginated list of users for the table
        const searchResponse = await adminDashboardService.searchUsers({
          term: this.userSearchTerm,
          field: this.userSearchField,
          limit: this.userSearchLimit,
          offset: this.userSearchOffset,
        });

        if (searchResponse && searchResponse.data) {
          this.userSearchResults = [...(searchResponse.data.users || [])];
          this.userSearchTotal = searchResponse.data.total || 0;
        } else {
          console.warn("No data received from searchUsers");
          this.userSearchResults = [];
          this.userSearchTotal = 0;
        }
      } catch (error) {
        console.error("Error searching users:", error);
        this.showNotification(
          this.translate("admin.userSearch.error", "Error searching users"),
          "error"
        );
        this.userSearchResults = [];
        this.userSearchTotal = 0;
      } finally {
        this.isSearchingUsers = false;
      }
    },

    /**
     * Reset user search and reload all users
     */
    resetUserSearch() {
      this.userSearchTerm = "";
      this.userSearchField = "all";
      this.userSearchResults = null;
      this.userSearchTotal = 0;
      this.userSearchOffset = 0;
      this.searchUsers(); // Re-run the search to show all users
    },

    /**
     * Handle user search pagination
     * @param {number} offset - New offset for pagination
     */
    handleUserSearchPagination(offset) {
      this.userSearchOffset = offset;
      this.searchUsers();
    },

    /**
     * Load pending users awaiting approval
     */
    async loadPendingUsers() {
      try {
        const response = await adminDashboardService.getPendingUsers();
        if (response && response.data) {
          this.pendingUsers = response.data.map(u => ({ ...u, assignRole: 'User' }));
        } else {
          this.pendingUsers = [];
        }
      } catch (error) {
        console.error("Error loading pending users:", error);
        this.pendingUsers = [];
      }
    },

    /**
     * Approve a pending user
     */
    async approveUser(user) {
      this.isApprovingUser = user._key;
      try {
        await adminDashboardService.approveUser(user._key, user.assignRole || 'User');
        this.showNotification(
          this.translate("admin.userApproved", `User ${user.fullName || user.loginName} approved successfully`),
          "success"
        );
        // Remove from pending list
        this.pendingUsers = this.pendingUsers.filter(u => u._key !== user._key);
        // Refresh user list
        await this.searchUsers();
      } catch (error) {
        console.error("Error approving user:", error);
        this.showNotification(
          this.translate("admin.approveError", "Failed to approve user"),
          "error"
        );
      } finally {
        this.isApprovingUser = null;
      }
    },

    /**
     * Reject a pending user
     */
    async rejectUser(user) {
      const reason = prompt(this.translate("admin.rejectReason", "Enter rejection reason (optional):"));
      if (reason === null) return; // User cancelled

      this.isApprovingUser = user._key;
      try {
        await adminDashboardService.rejectUser(user._key, reason);
        this.showNotification(
          this.translate("admin.userRejected", `User ${user.fullName || user.loginName} rejected`),
          "info"
        );
        // Remove from pending list
        this.pendingUsers = this.pendingUsers.filter(u => u._key !== user._key);
        // Refresh user list
        await this.searchUsers();
      } catch (error) {
        console.error("Error rejecting user:", error);
        this.showNotification(
          this.translate("admin.rejectError", "Failed to reject user"),
          "error"
        );
      } finally {
        this.isApprovingUser = null;
      }
    },

    /**
     * Get CSS class for user status display
     */
    getUserStatusClass(user) {
      if (user.status === 'Pending') return 'status-pending';
      if (user.status === 'Rejected' || user.disabled) return 'status-retracted';
      return 'status-ingested';
    },

    /**
     * Get display label for user status
     */
    getUserStatusLabel(user) {
      if (user.status === 'Pending') return this.translate("admin.statusPending", "Pending");
      if (user.status === 'Rejected') return this.translate("admin.statusRejected", "Rejected");
      if (user.disabled) return this.translate("admin.disabled", "Disabled");
      return this.translate("admin.enabled", "Active");
    },

    /**
     * Format a date string for display
     */
    formatDate(dateStr) {
      if (!dateStr) return '—';
      try {
        const date = new Date(dateStr);
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      } catch {
        return dateStr;
      }
    },

    // Load security metrics from the service

    /**
     * Parses a log message string to extract the log level.
     * @param {string} logString - The raw log message.
     * @returns {{type: string, message: string}}
     */
    parseLogMessage(logString) {
      if (typeof logString !== "string") {
        return { type: "UNKNOWN", message: String(logString) };
      }
      const match = logString.match(/^\[([A-Z]+)\]:?\s*/);
      if (match) {
        return {
          type: match[1], // e.g., "INFO", "ERROR"
          message: logString.substring(match[0].length),
        };
      }
      return { type: "INFO", message: logString }; // Default if no prefix
    },

    // Load detailed security information
    async loadSecurityDetails() {
      console.log("[AdminDashboard] Starting loadSecurityDetails");
      try {
        this.isLoading = true;
        const response = await adminDashboardService.getSecurityDetails();
        console.log(
          "[AdminDashboard] Security details API response:",
          JSON.stringify(response, null, 2)
        );

        // Define a helper to map vulnerability details
        const mapVulnerability = (v) => ({
          type: v.type,
          severity: v.severity,
          description: v.description,
          recommendation: v.recommendation,
          matchedTerm: v.matchedTerm,
          timestamp: v.timestamp,
          service: v.service,
          lineNumber: v.lineNumber,
          url: v.url,
          occurrences: v.instanceCount,
          firstSeen: v.firstSeen,
          lastSeen: v.lastSeen,
          lineNumbers: v.lineNumbers,
        });

        // REVISED: Define a helper to map and parse log details
        const mapAndParseLogDetail = (log) => {
          const parsed = this.parseLogMessage(log.message || "");
          return {
            timestamp: log.timestamp,
            type: parsed.type,
            message: parsed.message,
          };
        };

        this.securityDetails = {
          lastScan: response.lastScan || "Never",
          scanAge: response.scanAge || null,
          scanDuration: response.scanDuration || null,
          vulnerabilities: response.vulnerabilities || {
            critical: 0,
            medium: 0,
            low: 0,
            details: [],
          },
          vulnerabilityDetails: {
            critical: Array.isArray(response.vulnerabilityDetails?.critical)
              ? response.vulnerabilityDetails.critical.map(mapVulnerability)
              : [],
            medium: Array.isArray(response.vulnerabilityDetails?.medium)
              ? response.vulnerabilityDetails.medium.map(mapVulnerability)
              : [],
            low: Array.isArray(response.vulnerabilityDetails?.low)
              ? response.vulnerabilityDetails.low.map(mapVulnerability)
              : [],
          },
          failedLoginDetails: Array.isArray(response.failedLoginDetails)
            ? response.failedLoginDetails.map(mapAndParseLogDetail)
            : [],
          suspiciousDetails: Array.isArray(response.suspiciousDetails)
            ? response.suspiciousDetails.map(mapAndParseLogDetail)
            : [],
        };
        console.log(
          "[AdminDashboard] Security details loaded and parsed successfully:",
          this.securityDetails
        );
      } catch (error) {
        console.error(
          "[AdminDashboard] Error loading security details:",
          error
        );
        this.securityDetails = {
          lastScan: "Never",
          vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
          vulnerabilityDetails: { critical: [], medium: [], low: [] },
          failedLoginDetails: [],
          suspiciousDetails: [],
        };
      } finally {
        this.isLoading = false;
      }
    },

    // Get color for the usage bar based on value
    getSecurityBarColor(value) {
      if (value < 10) return "usage-low";
      if (value < 30) return "usage-medium";
      return "usage-high";
    },

    // Toggle showing all login issues
    toggleShowAllLogins() {
      this.showAllLogins = !this.showAllLogins;
    },

    // NEW: Toggle showing all suspicious activities
    toggleShowAllSuspicious() {
      this.showAllSuspicious = !this.showAllSuspicious;
    },

    // Format the security metrics for display
    formatSecurityMetrics() {
      // Calculate percentage for UI display (capped at 100%)
      const failedLoginPercent = Math.min(
        Math.ceil((this.securityMetrics.failedLoginAttempts / 100) * 100),
        100
      );

      const suspiciousActivityPercent = Math.min(
        Math.ceil((this.securityMetrics.suspiciousActivities / 20) * 100),
        100
      );

      return {
        failedLoginAttempts: this.securityMetrics.failedLoginAttempts,
        failedLoginPercent: failedLoginPercent,
        suspiciousActivities: this.securityMetrics.suspiciousActivities,
        suspiciousActivityPercent: suspiciousActivityPercent,
        lastSecurityScan: this.securityMetrics.lastSecurityScan,
        vulnerabilities: this.securityMetrics.vulnerabilities,
      };
    },

    async loadKnowledgeHierarchy() {
      this.isHierarchyLoading = true;
      try {
        // Using the serviceTreeService to fetch data
        const categories = await serviceTreeService.getAdminCategories("en");
        // The API returns a simple structure; adapt it for the UI.
        // A dedicated admin endpoint should return the full object with translations.
        this.knowledgeHierarchy = categories.map((cat) => ({
          _key: cat.catKey, // Use _key from service
          nameEN: cat.name,
          translations: [], // TODO: Your API should eventually return this data
          services: (cat.children || []).map((service) => ({
            // service is now the object {_key, name}
            _key: service._key, // Use the REAL key from the database
            nameEN: service.name, // Use the name property from the service object
            translations: [],
          })),
        }));
      } catch (error) {
        this.showNotification(
          this.translate(
            "admin.hierarchy.loadError",
            "Failed to load knowledge hierarchy."
          ),
          "error"
        );
        console.error(error);
      } finally {
        this.isHierarchyLoading = false;
      }
    },

    showAddCategoryForm() {
      // MODIFIED: Use translate method for title
      this.hierarchyForm = {
        visible: true,
        mode: "createCategory",
        title: this.translate(
          "admin.hierarchy.formTitleCreateCategory",
          "Create New Category"
        ),
        _key: null,
        nameEN: "",
        translations: [{ lang: "", text: "" }],
        parentId: null,
      };
      // Store the initial state for the unsaved changes check
      this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
    },

    showAddServiceForm(category) {
      // MODIFIED: Use translate method for title
      this.hierarchyForm = {
        visible: true,
        mode: "createService",
        title: this.translate(
          "admin.hierarchy.formTitleAddService",
          'Add Service to "{categoryName}"'
        ).replace("{categoryName}", category.nameEN),
        _key: null,
        nameEN: "",
        translations: [{ lang: "", text: "" }],
        parentId: category._key,
      };
      // Store the initial state for the unsaved changes check
      this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
    },

    async showEditForm(item, parentCategory = null) {
      const isCategory = !parentCategory;

      // MODIFIED: Use translate method for title
      const titleKey = isCategory
        ? "admin.hierarchy.formTitleEditCategory"
        : "admin.hierarchy.formTitleEditService";
      const fallbackTitle = `Edit ${isCategory ? "Category" : "Service"}: "${
        item.nameEN
      }"`;

      // Step 1: Immediately show the form with basic info
      this.hierarchyForm = {
        visible: true,
        mode: isCategory ? "editCategory" : "editService",
        title: this.translate(titleKey, fallbackTitle).replace(
          "{itemName}",
          item.nameEN
        ),
        _key: item._key,
        nameEN: item.nameEN,
        translations: [], // Start with an empty array
        parentId: isCategory ? null : parentCategory._key,
      };

      // Step 2: Fetch the translations asynchronously
      this.isTranslationsLoading = true;
      try {
        let fetchedTranslations = [];
        if (isCategory) {
          // Call the service method for categories
          fetchedTranslations =
            await serviceTreeService.getCategoryTranslations(item._key);
        } else {
          // Call the service method for services
          fetchedTranslations = await serviceTreeService.getServiceTranslations(
            item._key
          );
        }

        // Filter out the English ('en') translation from the results
        const filteredTranslations = fetchedTranslations.filter(
          (t) => t.lang !== "en"
        );

        // Step 3: Populate the form with the filtered data
        if (filteredTranslations.length > 0) {
          this.hierarchyForm.translations = filteredTranslations;
        } else {
          // If no non-English translations exist, provide one empty row for the user to start
          this.hierarchyForm.translations.push({ lang: "", text: "" });
        }

        // Step 4: Store the initial state for the unsaved changes check
        this.originalHierarchyFormState = JSON.stringify(this.hierarchyForm);
      } catch (error) {
        this.showNotification(
          this.translate(
            "admin.hierarchy.loadTranslationsError",
            "Failed to load translations."
          ),
          "error"
        );
        // Ensure there's at least one empty row on error
        if (this.hierarchyForm.translations.length === 0) {
          this.hierarchyForm.translations.push({ lang: "", text: "" });
        }
      } finally {
        this.isTranslationsLoading = false;
      }
    },

    addTranslationRow() {
      this.hierarchyForm.translations.push({ lang: "", text: "" });
    },

    removeTranslationRow(index) {
      this.hierarchyForm.translations.splice(index, 1);
    },

    closeHierarchyForm() {
      this.hierarchyForm.visible = false;
      this.originalHierarchyFormState = null;
    },

    // Modify cancelHierarchyForm
    cancelHierarchyForm() {
      if (this.isFormDirty) {
        // MODIFIED: Use ConfirmDialog
        this.showConfirmDialog({
          title: this.translate(
            "admin.hierarchy.confirmCancelTitle",
            "Unsaved Changes"
          ),
          message: this.translate(
            "admin.hierarchy.confirmCancelEdit",
            "You have unsaved changes. Are you sure you want to cancel?"
          ),
          confirmText: this.translate("admin.buttons.discard", "Discard"),
          cancelText: this.translate("common.cancel", "Cancel"),
          onConfirm: () => {
            this.closeHierarchyForm(); // User confirmed
          },
          onCancel: () => {
            // User canceled, do nothing
          },
        });
      } else {
        this.closeHierarchyForm();
      }
    },

    async saveHierarchyItem() {
      // --- 1. VALIDATION ---
      const validTranslations = this.hierarchyForm.translations.filter(
        (t) => t.lang && t.text.trim()
      );
      const langCodes = validTranslations.map((t) => t.lang);

      // Check for duplicate languages
      if (new Set(langCodes).size !== langCodes.length) {
        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate(
            "admin.hierarchy.duplicateLangError",
            "Duplicate languages found in translations. Please remove them."
          ),
          "error"
        );
        return;
      }

      // --- 2. PREPARE PAYLOAD ---
      const payload = {
        nameEN: this.hierarchyForm.nameEN,
        translations: validTranslations,
      };

      this.isLoading = true;
      try {
        const { mode, _key, parentId } = this.hierarchyForm;

        // --- 3. CALL CORRECT SERVICE METHOD (SAVE) ---
        if (mode === "createCategory") {
          await serviceTreeService.createCategory(payload);
        } else if (mode === "editCategory") {
          await serviceTreeService.updateCategory(_key, payload);
        } else if (mode === "createService") {
          await serviceTreeService.createService(parentId, payload);
        } else if (mode === "editService") {
          await serviceTreeService.updateService(_key, payload);
        }

        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate(
            "admin.hierarchy.saveSuccess",
            "Hierarchy item saved successfully."
          ),
          "success"
        );
        this.closeHierarchyForm(); // Close form on success

        // --- 4. REFRESH DATA ---
        await this.loadKnowledgeHierarchy(); // Refresh the admin dashboard tree
        eventBus.$emit("knowledge-hierarchy-updated"); // Emit global event for other components
      } catch (error) {
        this.showNotification(
          // MODIFIED: Use new i18n key
          this.translate(
            "admin.hierarchy.saveError",
            "Failed to save hierarchy item."
          ),
          "error"
        );
        console.error(error);
      } finally {
        this.isLoading = false;
      }
    },

    async deleteHierarchyItem(item, parentCategory = null) {
      const isCategory = !parentCategory;
      const type = isCategory ? "Category" : "Service";

      // MODIFIED: Use new i18n keys for ConfirmDialog
      const titleKey = isCategory
        ? "admin.hierarchy.confirmDeleteTitleCategory"
        : "admin.hierarchy.confirmDeleteTitleService";
      const messageKey = isCategory
        ? "admin.hierarchy.confirmDeleteCategory"
        : "admin.hierarchy.confirmDeleteService";
      const defaultTitle = `Delete ${type}?`;
      const defaultMessage = `Are you sure you want to delete the ${type} "${item.nameEN}"? This action cannot be undone.`;

      this.showConfirmDialog({
        title: this.translate(titleKey, defaultTitle),
        message: this.translate(messageKey, defaultMessage).replace(
          "{itemName}",
          item.nameEN
        ),
        confirmText: this.translate("common.delete", "Delete"),
        cancelText: this.translate("common.cancel", "Cancel"),
        onConfirm: async () => {
          // User confirmed, proceed with deletion
          this.isLoading = true;
          try {
            // Conditionally call the correct delete method from the service
            if (isCategory) {
              await serviceTreeService.deleteCategory(item._key);
            } else {
              await serviceTreeService.deleteService(item._key);
            }

            // MODIFIED: Use new i18n keys for notification
            const successKey = isCategory
              ? "admin.hierarchy.deleteSuccessCategory"
              : "admin.hierarchy.deleteSuccessService";
            this.showNotification(
              this.translate(successKey, `${type} deleted successfully.`),
              "success"
            );

            // Refresh the data in the admin panel and the main application
            await this.loadKnowledgeHierarchy();
            eventBus.$emit("knowledge-hierarchy-updated");
          } catch (error) {
            // MODIFIED: Use new i18n keys for notification
            const errorKey = isCategory
              ? "admin.hierarchy.deleteErrorCategory"
              : "admin.hierarchy.deleteErrorService";
            this.showNotification(
              this.translate(errorKey, `Failed to delete ${type}.`),
              "error"
            );
            console.error(error);
          } finally {
            this.isLoading = false;
          }
        },
        onCancel: () => {
          // User canceled, do nothing
        },
      });
    },

    // --- QUICK HELP BUTTONS (J.4, DEC-28) ---
    // Conventions mirror the hierarchy card: load on tab entry, inline form
    // panel with mode discriminator, ConfirmDialog for destructive actions,
    // showNotification toasts, eventBus refresh for the mounted chat grid.

    async loadQuickHelpButtons() {
      this.isQuickHelpLoading = true;
      try {
        this.quickHelpButtons = await quickhelpService.getAllButtons();
      } catch (error) {
        console.error("[AdminDashboard] Failed to load quick-help buttons:", error);
        this.showNotification(
          this.translate("admin.quickHelp.loadError", "Failed to load buttons."),
          "error"
        );
      } finally {
        this.isQuickHelpLoading = false;
      }
    },

    showQuickHelpForm(mode, button = null) {
      this.quickHelpForm = {
        visible: true,
        mode,
        _key: button?._key || null,
        titleEN: button?.title?.en || "",
        titleST: button?.title?.st || "",
        promptEN: button?.prompt?.en || "",
        promptST: button?.prompt?.st || "",
        iconFile: button?.icon
          ? button.icon.replace("/config/quickhelp/", "")
          : "crop-management.svg",
        isJustChat: button?.isJustChat === true,
      };
      this.originalQuickHelpFormState = JSON.stringify(this.quickHelpForm);
    },

    _closeQuickHelpForm() {
      this.quickHelpForm.visible = false;
      this.originalQuickHelpFormState = null;
    },

    // --- START: PIPELINE SETTINGS (K.2, DEC-29) ---

    _applyLlmSettings(data) {
      const gen = data.generation || {};
      const ingest = data.ingest || {};
      this.pipelineSettingsForm = {
        systemPrompt: data.systemPrompt ?? "",
        enforceAbstention: data.enforceAbstention !== false,
        abstentionInstructions: data.abstentionInstructions ?? "",
        generation: {
          temperature: Number(gen.temperature ?? 0.01),
          topP: Number(gen.topP ?? 0.95),
          repetitionPenalty: Number(gen.repetitionPenalty ?? 1.03),
          frequencyPenalty: Number(gen.frequencyPenalty ?? 0.0),
          presencePenalty: Number(gen.presencePenalty ?? 0.0),
          maxTokens: Number(gen.maxTokens ?? 8192),
        },
        ingest: {
          labelSelectorPrompt: ingest.labelSelectorPrompt ?? "",
          contextualRetrievalPrompt: ingest.contextualRetrievalPrompt ?? "",
        },
      };
      this.pipelineSettingsAudit = {
        version: data.version ?? null,
        updatedAt: data.updatedAt ?? null,
        updatedBy: data.updatedBy ?? null,
      };
      this.originalPipelineSettingsState = JSON.stringify(this.pipelineSettingsForm);
    },

    async loadLlmSettings() {
      this.isPipelineSettingsLoading = true;
      try {
        const result = await adminDashboardService.getLlmSettings();
        this._applyLlmSettings(result.data);
        this.llmSettingsWarnings = result.warnings || [];
      } catch (error) {
        console.error("[AdminDashboard] Failed to load llm-settings:", error);
        this.showNotification(
          this.translate("admin.pipelineSettings.loadError", "Failed to load LLM settings."),
          "error"
        );
      } finally {
        this.isPipelineSettingsLoading = false;
      }
    },

    _llmSettingsPayload() {
      const f = this.pipelineSettingsForm;
      // Only the MIN-LENGTH-1 fields are omitted when empty (an explicit ""
      // would 400 and block non-prompt saves on never-edited or broken-file
      // boxes; an omitted key simply doesn't merge). abstentionInstructions
      // is legal at 0..4000 and CLEARABLE — "" is sent so the cleared
      // value actually lands in the file (the consumer falls back to the
      // coded default text for falsy values).
      const payload = {
        enforceAbstention: !!f.enforceAbstention,
        abstentionInstructions: (f.abstentionInstructions || "").trim(),
        generation: {
          temperature: Number(f.generation.temperature),
          topP: Number(f.generation.topP),
          repetitionPenalty: Number(f.generation.repetitionPenalty),
          frequencyPenalty: Number(f.generation.frequencyPenalty),
          presencePenalty: Number(f.generation.presencePenalty),
          maxTokens: Number(f.generation.maxTokens),
        },
      };
      const systemPrompt = (f.systemPrompt || "").trim();
      if (systemPrompt) payload.systemPrompt = systemPrompt;
      const ingest = {
        labelSelectorPrompt: (f.ingest.labelSelectorPrompt || "").trim(),
        contextualRetrievalPrompt: (f.ingest.contextualRetrievalPrompt || "").trim(),
      };
      // ingest keys nest — include only when something is set
      const ingestSet = Object.fromEntries(Object.entries(ingest).filter(([, v]) => v));
      if (Object.keys(ingestSet).length) payload.ingest = ingestSet;
      return payload;
    },

    _llmSettingsValidationError() {
      // Mirrors the backend schema — returns a message naming the field, or null.
      // A CLEARED number input leaves '' (v-model.number does not coerce it);
      // Number('') === 0 would silently pass 4 of 6 ranges, so raw-'' is a
      // "required" error. Empty prompt fields are skipped (they are stripped
      // from the payload, not saved as blanks).
      const f = this.pipelineSettingsForm;
      const trimmedLen = (s) => (s || "").trim().length;
      if (trimmedLen(f.systemPrompt) > 8000) {
        return this.translate(
          "admin.pipelineSettings.badSystemPrompt",
          "systemPrompt must be at most 8000 characters (trimmed)."
        );
      }
      if (trimmedLen(f.abstentionInstructions) > 4000) {
        return this.translate(
          "admin.pipelineSettings.badAbstention",
          "abstentionInstructions must be at most 4000 characters."
        );
      }
      for (const [field, range] of Object.entries(this.llmGenParamRanges)) {
        const raw = f.generation[field];
        if (raw === "" || raw === null || raw === undefined) {
          return this.translate(
            "admin.pipelineSettings.badRange",
            `generation.${field} is required.`
          );
        }
        const value = Number(raw);
        const ok =
          Number.isFinite(value) &&
          value >= range.min &&
          value <= range.max &&
          (!range.int || Number.isInteger(value));
        if (!ok) {
          return this.translate(
            "admin.pipelineSettings.badRange",
            `generation.${field} must be a number in [${range.min}, ${range.max}]${range.int ? " (integer)" : ""}.`
          );
        }
      }
      for (const field of ["labelSelectorPrompt", "contextualRetrievalPrompt"]) {
        const len = trimmedLen(f.ingest[field]);
        if (len > 8000) {
          return this.translate(
            "admin.pipelineSettings.badIngest",
            `ingest.${field} must be at most 8000 characters (trimmed).`
          );
        }
      }
      return null;
    },

    async saveLlmSettings() {
      const validationError = this._llmSettingsValidationError();
      if (validationError) {
        this.showNotification(validationError, "error");
        return;
      }
      this.isLoading = true;
      try {
        const result = await adminDashboardService.updateLlmSettings(this._llmSettingsPayload());
        this._applyLlmSettings(result.data); // fresh audit envelope + snapshot
        this.llmSettingsWarnings = []; // the saved doc is schema-valid by construction
        this.showNotification(
          this.translate(
            "admin.pipelineSettings.saveSuccess",
            "LLM settings saved — the next chat request uses them (no restart)."
          ),
          "success"
        );
      } catch (error) {
        // Backend 400/403/409 messages already name the field / reason.
        const message =
          error?.response?.data?.message ||
          this.translate("admin.pipelineSettings.saveError", "Failed to save LLM settings.");
        this.showNotification(message, "error");
      } finally {
        this.isLoading = false;
      }
    },

    discardPipelineSettingsChanges() {
      if (this.originalPipelineSettingsState !== null) {
        this.pipelineSettingsForm = JSON.parse(this.originalPipelineSettingsState);
      }
    },

    // --- END: PIPELINE SETTINGS ---

    // --- START: RAG TUNING (K.3, DEC-29) ---

    _applyRagTuning(data) {
      const ret = data.retriever || {};
      const rr = data.reranker || {};
      const num = (value, fallback) => (value === null || value === undefined ? fallback : Number(value));
      this.ragTuningForm = {
        retriever: {
          retrievalK: num(ret.retrievalK, 20),
          fetchK: num(ret.fetchK, 30),
          scoreThreshold: num(ret.scoreThreshold, 0.2),
          lambdaMult: num(ret.lambdaMult, 0.5),
          searchStart: ret.searchStart || "chunk",
          searchMode: ret.searchMode || "vector",
          filterStrategy: ret.filterStrategy || "OR",
          enableTraversal: ret.enableTraversal !== false,
          traversalMaxDepth: num(ret.traversalMaxDepth, 2),
          traversalMaxReturned: num(ret.traversalMaxReturned, 5),
          traversalScoreThreshold: num(ret.traversalScoreThreshold, 0.7),
          traversalConcurrentBatches: num(ret.traversalConcurrentBatches, 4),
          hybridEnabled: ret.hybridEnabled !== false,
          hybridRrfK: num(ret.hybridRrfK, 60),
          hybridDenseWeight: num(ret.hybridDenseWeight, 1.0),
          hybridLexicalWeight: num(ret.hybridLexicalWeight, 1.0),
          hybridBm25Candidates: num(ret.hybridBm25Candidates, 50),
        },
        reranker: {
          strategy: rr.strategy || "slice",
          threshold: num(rr.threshold, 0.75),
          topN: num(rr.topN, 3),
          noveltySigmoidA: num(rr.noveltySigmoidA, 20.0),
          noveltySigmoidB: num(rr.noveltySigmoidB, 0.25),
          contextDecayFactor: num(rr.contextDecayFactor, 0.0025),
          minValueThreshold: num(rr.minValueThreshold, -1.0),
        },
      };
      this.ragTuningAudit = {
        version: data.version ?? null,
        updatedAt: data.updatedAt ?? null,
        updatedBy: data.updatedBy ?? null,
      };
      this.originalRagTuningState = JSON.stringify(this.ragTuningForm);
    },

    async loadRagTuning() {
      this.isRagTuningLoading = true;
      try {
        const result = await adminDashboardService.getRagTuning();
        this._applyRagTuning(result.data);
        this.ragTuningWarnings = result.warnings || [];
      } catch (error) {
        console.error("[AdminDashboard] Failed to load rag-tuning:", error);
        this.showNotification(
          this.translate("admin.ragTuning.loadError", "Failed to load RAG tuning settings."),
          "error"
        );
      } finally {
        this.isRagTuningLoading = false;
      }
    },

    _ragTuningPayload() {
      const f = this.ragTuningForm;
      const num = (v) => Number(v);
      return {
        retriever: {
          retrievalK: num(f.retriever.retrievalK),
          fetchK: num(f.retriever.fetchK),
          scoreThreshold: num(f.retriever.scoreThreshold),
          lambdaMult: num(f.retriever.lambdaMult),
          searchStart: f.retriever.searchStart,
          searchMode: f.retriever.searchMode,
          filterStrategy: f.retriever.filterStrategy,
          enableTraversal: !!f.retriever.enableTraversal,
          traversalMaxDepth: num(f.retriever.traversalMaxDepth),
          traversalMaxReturned: num(f.retriever.traversalMaxReturned),
          traversalScoreThreshold: num(f.retriever.traversalScoreThreshold),
          traversalConcurrentBatches: num(f.retriever.traversalConcurrentBatches),
          hybridEnabled: !!f.retriever.hybridEnabled,
          hybridRrfK: num(f.retriever.hybridRrfK),
          hybridDenseWeight: num(f.retriever.hybridDenseWeight),
          hybridLexicalWeight: num(f.retriever.hybridLexicalWeight),
          hybridBm25Candidates: num(f.retriever.hybridBm25Candidates),
        },
        reranker: {
          strategy: f.reranker.strategy,
          threshold: num(f.reranker.threshold),
          topN: num(f.reranker.topN),
          noveltySigmoidA: num(f.reranker.noveltySigmoidA),
          noveltySigmoidB: num(f.reranker.noveltySigmoidB),
          contextDecayFactor: num(f.reranker.contextDecayFactor),
          minValueThreshold: num(f.reranker.minValueThreshold),
        },
      };
    },

    _ragTuningValidationError() {
      // Mirrors the backend schema — returns a message naming the field, or
      // null. A CLEARED number input leaves '' (required error, never a
      // silent 0 — the K.2 lesson); enums come from selects so only the
      // cross-field fetchK >= retrievalK constraint needs a real check.
      // Bounds are omitted where the backend has none (no artificial maxes).
      const f = this.ragTuningForm;
      const boundText = (range) => {
        const low = range.min === undefined ? "" : `${range.exclusive ? ">" : ">="} ${range.min}`;
        const high = range.max === undefined ? "" : ` and <= ${range.max}`;
        return `${low}${high}${range.int ? " (integer)" : ""}`;
      };
      for (const [section, ranges] of [
        ["retriever", this.ragRetrieverRanges],
        ["reranker", this.ragRerankerRanges],
      ]) {
        for (const [field, range] of Object.entries(ranges)) {
          const raw = f[section][field];
          if (raw === "" || raw === null || raw === undefined) {
            return this.translate(
              "admin.ragTuning.badRange",
              `${section}.${field} is required.`
            );
          }
          const value = Number(raw);
          let ok = Number.isFinite(value);
          if (ok && range.min !== undefined) {
            ok = range.exclusive ? value > range.min : value >= range.min;
          }
          if (ok && range.max !== undefined) {
            ok = value <= range.max;
          }
          if (ok && range.int) {
            ok = Number.isInteger(value);
          }
          if (!ok) {
            return this.translate(
              "admin.ragTuning.badRange",
              `${section}.${field} must be a finite number ${boundText(range)}.`
            );
          }
        }
      }
      if (Number(f.retriever.fetchK) < Number(f.retriever.retrievalK)) {
        return this.translate(
          "admin.ragTuning.badFetchK",
          "retriever.fetchK must be >= retriever.retrievalK."
        );
      }
      return null;
    },

    async saveRagTuning() {
      const validationError = this._ragTuningValidationError();
      if (validationError) {
        this.showNotification(validationError, "error");
        return;
      }
      this.isLoading = true;
      try {
        const result = await adminDashboardService.updateRagTuning(this._ragTuningPayload());
        this._applyRagTuning(result.data); // fresh audit envelope + snapshot
        this.ragTuningWarnings = []; // the saved doc is schema-valid by construction
        this.showNotification(
          this.translate(
            "admin.ragTuning.saveSuccess",
            "RAG tuning saved — the next chat request uses it (no restart)."
          ),
          "success"
        );
      } catch (error) {
        // Backend 400/403/409 messages already name the field / reason.
        const message =
          error?.response?.data?.message ||
          this.translate("admin.ragTuning.saveError", "Failed to save RAG tuning settings.");
        this.showNotification(message, "error");
      } finally {
        this.isLoading = false;
      }
    },

    discardRagTuningChanges() {
      if (this.originalRagTuningState !== null) {
        this.ragTuningForm = JSON.parse(this.originalRagTuningState);
      }
    },

    // --- END: RAG TUNING ---


    cancelQuickHelpForm() {
      this._closeQuickHelpForm();
    },

    _quickHelpPayload() {
      const f = this.quickHelpForm;
      return {
        title: { en: f.titleEN.trim(), ...(f.titleST.trim() ? { st: f.titleST.trim() } : {}) },
        prompt: { en: f.promptEN.trim(), ...(f.promptST.trim() ? { st: f.promptST.trim() } : {}) },
        icon: `/config/quickhelp/${f.iconFile}`,
        isJustChat: f.isJustChat,
        enabled: true,
      };
    },

    async saveQuickHelpButton() {
      this.isLoading = true;
      try {
        if (this.quickHelpForm.mode === "create") {
          await quickhelpService.createButton({
            ...this._quickHelpPayload(),
            order: (this.quickHelpButtons.length
              ? Math.max(...this.quickHelpButtons.map((b) => b.order || 0))
              : 0) + 1,
          });
        } else {
          const current = this.quickHelpButtons.find(
            (b) => b._key === this.quickHelpForm._key
          );
          await quickhelpService.updateButton(this.quickHelpForm._key, {
            ...this._quickHelpPayload(),
            order: current?.order ?? 100,
            enabled: current?.enabled ?? true,
          });
        }
        this.showNotification(
          this.translate("admin.quickHelp.saveSuccess", "Button saved."),
          "success"
        );
        this.quickHelpForm.visible = false;
        this.originalQuickHelpFormState = null;
        await this.loadQuickHelpButtons();
        eventBus.$emit("quick-help-updated");
      } catch (error) {
        console.error("[AdminDashboard] Failed to save quick-help button:", error);
        this.showNotification(
          this.translate("admin.quickHelp.saveError", "Failed to save button."),
          "error"
        );
      } finally {
        this.isLoading = false;
      }
    },

    async deleteQuickHelpButton(button) {
      this.showConfirmDialog({
        title: this.translate("admin.quickHelp.confirmDeleteTitle", "Delete Button?"),
        message: this.translate(
          "admin.quickHelp.confirmDelete",
          `Are you sure you want to delete the button "${button.title?.en}"? This action cannot be undone.`
        ),
        confirmText: this.translate("common.delete", "Delete"),
        cancelText: this.translate("common.cancel", "Cancel"),
        onConfirm: async () => {
          this.isLoading = true;
          try {
            await quickhelpService.deleteButton(button._key);
            this.showNotification(
              this.translate("admin.quickHelp.deleteSuccess", "Button deleted."),
              "success"
            );
            await this.loadQuickHelpButtons();
            eventBus.$emit("quick-help-updated");
          } catch (error) {
            console.error("[AdminDashboard] Failed to delete quick-help button:", error);
            this.showNotification(
              this.translate("admin.quickHelp.deleteError", "Failed to delete button."),
              "error"
            );
          } finally {
            this.isLoading = false;
          }
        },
        onCancel: () => {},
      });
    },

    async toggleQuickHelpButton(button) {
      try {
        await quickhelpService.updateButton(button._key, {
          title: button.title,
          prompt: button.prompt,
          icon: button.icon,
          isJustChat: button.isJustChat,
          order: button.order,
          enabled: !button.enabled,
        });
        await this.loadQuickHelpButtons();
        eventBus.$emit("quick-help-updated");
      } catch (error) {
        console.error("[AdminDashboard] Failed to toggle quick-help button:", error);
        this.showNotification(
          this.translate("admin.quickHelp.saveError", "Failed to save button."),
          "error"
        );
        await this.loadQuickHelpButtons(); // revert the checkbox to server truth
      }
    },

    async moveQuickHelpButton(button, direction) {
      // Order arrows (DEC-28: no drag-drop): ONE PUT — the moved button
      // takes a quarter-step past its neighbor (neighbor untouched), so no
      // failure mode can ever leave two buttons with equal orders (equal
      // orders would make every future ↑/↓ between them a silent no-op —
      // J.4 review F9). Fractional orders sort correctly and never collide.
      const index = this.quickHelpButtons.findIndex((b) => b._key === button._key);
      const neighbor = this.quickHelpButtons[index + direction];
      if (!neighbor) return;
      try {
        await quickhelpService.updateButton(button._key, {
          title: button.title,
          prompt: button.prompt,
          icon: button.icon,
          isJustChat: button.isJustChat,
          enabled: button.enabled,
          order: neighbor.order + (direction === 1 ? 0.25 : -0.25),
        });
        await this.loadQuickHelpButtons();
        eventBus.$emit("quick-help-updated");
      } catch (error) {
        console.error("[AdminDashboard] Failed to reorder quick-help buttons:", error);
        this.showNotification(
          this.translate("admin.quickHelp.saveError", "Failed to save button."),
          "error"
        );
        await this.loadQuickHelpButtons();
      }
    },

    // --- START: NEW METHODS FOR DOCUMENTS ---
    // uploadFiles() is now just the action to show the dialog (see below)

    // addFromLink() is now just the action to show the dialog (see below)

    viewDocumentDetails(docId) {
      console.log("Viewing details for doc ID:", docId);
      this.selectedFileId = docId;
      this.showDetailsDialog = true;
    },
    
    // UPDATED: Determine status class based on crawl status first
    getStatusClass(doc) {
      // 1. Normalize Access: Handle snake_case, camelCase, or potential array wrapping
      let job = doc.crawl_job || doc.crawlJob;
      if (Array.isArray(job)) job = job.length > 0 ? job[0] : null;

      // 2. Normalize Strings
      const crawlStatus = job?.status ? String(job.status).toLowerCase().trim() : null;
      const dataPrepStatus = doc.dataprep?.status ? String(doc.dataprep.status).toLowerCase().trim() : '';

      // 3. Priority Logic: Crawl Status takes precedence for active/failed states
      if (crawlStatus === 'crawling') return 'status-ingesting'; // Blue
      if (crawlStatus === 'failed' || crawlStatus === 'killed') return 'status-error'; // Red
      
      // 4. Fallback Logic: DataPrep Status
      if (dataPrepStatus === "ingested") return "status-ingested";
      if (dataPrepStatus === "ingesting") return "status-ingesting";
      if (dataPrepStatus === "ingested with warnings") return "status-ingested-with-warnings";
      if (dataPrepStatus === "ingestion error") return "status-ingestion-error";
      if (dataPrepStatus === "pending") return "status-pending";
      if (dataPrepStatus === "retracted") return "status-retracted";
      
      return "";
    },

    getDisplayStatus(doc) {
      // 1. Normalize Access
      let job = doc.crawl_job || doc.crawlJob;
      if (Array.isArray(job)) job = job.length > 0 ? job[0] : null;

      // 2. Priority Logic
      if (job && job.status) {
        const s = String(job.status).toLowerCase().trim();
        if (s === 'crawling') return 'Crawling';
        if (s === 'failed') return 'Crawl Failed';
        if (s === 'killed') return 'Crawl Killed';
        // If 'pending', we distinguish it from the file's ingestion pending status
        if (s === 'pending') return 'Crawl Scheduled';
      }

      // 3. Fallback to dataprep status or 'Unknown'
      return doc.dataprep ? doc.dataprep.status : 'Unknown';
    },

    // NEW: Determine display text based on crawl status first
    getDisplayStatus(doc) {
      // 1. Normalize Access
      let job = doc.crawl_job || doc.crawlJob;
      if (Array.isArray(job)) job = job[0];

      // 2. Priority Logic
      if (job && job.status) {
        const s = job.status.toLowerCase().trim();
        if (s === 'crawling') return 'Crawling';
        if (s === 'failed') return 'Crawl Failed';
        if (s === 'killed') return 'Crawl Killed';
        // If 'pending', we distinguish it from the file's ingestion pending status
        if (s === 'pending') return 'Crawl Scheduled';
      }

      // 3. Fallback to dataprep status or 'Unknown'
      return doc.dataprep ? doc.dataprep.status : 'Unknown';
    },

    selectAllDocuments(event) {
      if (event.target.checked) {
        // MODIFICATION: Select based on _key, not file_id
        this.selectedDocuments = this.sortedAndFilteredDocuments.map(
          (d) => d._key
        );
      } else {
        this.selectedDocuments = [];
      }
    },
    /**
     * Handles batch actions like 'ingest' for multiple selected documents.
     */
    async handleBatchAction(action) {
      if (action === "ingest") {
        // MODIFIED: Use ConfirmDialog
        const count = this.selectedDocuments.length;
        this.showConfirmDialog({
          title: this.translate(
            "admin.documents.confirmIngestTitle",
            "Confirm Batch Ingestion"
          ),
          message: this.translate(
            "admin.documents.confirmIngestSelected",
            `Are you sure you want to ingest ${count} selected file(s)?`
          ).replace("{count}", count),
          confirmText: this.translate("admin.documents.ingest", "Ingest"),
          cancelText: this.translate("common.cancel", "Cancel"),
          onConfirm: async () => {
            // User confirmed, proceed with batch ingest
            this.isLoading = true; // Use the main dashboard loading overlay
            try {
              // Call the service with the array of selected document keys
              await documentFileService.ingestMultipleFiles(
                this.selectedDocuments
              );

              this.showNotification(
                // MODIFIED: Use new i18n key
                this.translate(
                  "admin.documents.ingestQueuedSuccess",
                  `{count} file(s) have been queued for ingestion.`
                ).replace("{count}", count),
                "success"
              );

              // Clear the selection after the action is successful
              this.selectedDocuments = [];

              // Refresh the document list to show the updated statuses
              await this.loadDocuments();
            } catch (error) {
              this.showNotification(
                // MODIFIED: Use new i18n key
                this.translate(
                  "admin.documents.ingestQueuedError",
                  "An error occurred during the batch ingestion process."
                ),
                "error"
              );
              console.error("Batch ingest error:", error);
            } finally {
              this.isLoading = false;
            }
          },
          onCancel: () => {
            // User canceled, do nothing
          },
        });
      }
      // You can add 'else if' blocks for other actions like 'retract' or 'delete' here
    },
    // --- END: DOCUMENT METHODS ---

    // This method is triggered by the "+ Upload Files" button
    uploadFiles() {
      this.showUploadDialog = true;
    },

    // This method is triggered by the "+ Add from Link" button
    addFromLink() {
      this.showLinkDialog = true;
    },

    // This method is triggered by clicking a row in the documents table
    viewDocumentDetails(docId) {
      this.selectedFileId = docId;
      this.showDetailsDialog = true;
    },

    // This is a new method to refresh the document list after an action
    refreshDocuments() {
      // In a real application, this would re-fetch the document list from your API
      // this.showNotification("Document list refreshed.", "info"); // Notification is now more specific
      console.log("Refreshing document list...");
      this.loadDocuments();
    },

    // Handler for the @files-uploaded event from the UploadFilesDialog
    handleFilesUploaded(uploadedFiles) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate(
          "admin.documents.uploadSuccessMultiple",
          `{count} file(s) uploaded successfully.`
        ).replace("{count}", uploadedFiles.length),
        "success"
      );
      this.refreshDocuments();
    },

    // Handler for the @link-submitted event from the AddFromLinkDialog
    handleLinkSubmitted(newFile) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate(
          "admin.documents.linkSubmitSuccess",
          `Successfully crawled and saved "{fileName}".`
        ).replace("{fileName}", newFile.file_name),
        "success"
      );
      this.refreshDocuments();
    },

    // Handler for events from the FileDetailsDialog
    handleFileAction(payload) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate(
          "admin.documents.actionSuccess",
          `Action "{action}" on file {fileId} was successful.`
        )
          .replace("{action}", payload.action)
          .replace("{fileId}", payload.fileId),
        "success"
      );
      this.refreshDocuments();
    },

    handleFileUpdated(payload) {
      // MODIFIED: Use new i18n key
      this.showNotification(
        this.translate(
          "admin.documents.metadataUpdateSuccess",
          `Metadata for file {fileId} was updated.`
        ).replace("{fileId}", payload.fileId),
        "success"
      );
      this.refreshDocuments();
    },

    async loadDocuments() {
      this.isDocumentsLoading = true;
      try {
        // 1. Prepare Params 
        // Note: 'sort' and 'order' removed because the backend returned 400 Bad Request.
        // The list will load in the backend's default order (currently Ascending/Oldest First).
        const params = {
          page: this.documentPagination.page,
          limit: this.documentPagination.limit,
        };

        if (this.documentSearchTerm && this.documentSearchTerm.trim() !== "") {
          params.search = this.documentSearchTerm.trim();
        }

        // 2. Call API
        const response = await documentFileService.getFiles(params);
        
        // 3. Normalize Data
        // Map DB 'uploaded_date' to UI 'upload_date' so the client-side table renders dates correctly
        const rawDocs = response.data || [];
        this.documents = rawDocs.map(doc => {
            if (!doc.upload_date && doc.uploaded_date) {
                doc.upload_date = doc.uploaded_date;
            }
            return doc;
        });

        // 4. Pagination
        if (response.pagination) {
          this.documentPagination.total = response.pagination.totalFiles || 0;
          this.documentPagination.page = response.pagination.currentPage || 1;
        }
      } catch (error) {
        console.error("Error loading documents:", error);
        this.showNotification(
          this.translate(
            "admin.documents.loadError",
            "Failed to load documents."
          ),
          "error"
        );
        this.documents = [];
      } finally {
        this.isDocumentsLoading = false;
      }
    },

    formatFileSize(bytes) {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    },
  },
};
</script>

<style scoped>
/* Base variables */
:root {
  --primary: #3b82f6;
  --primary-dark: #2563eb;
  --secondary: #64748b;
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --light: #f8fafc;
  --dark: #1e293b;
  --border: #e2e8f0;

  /* Theme variables */
  --bg-dialog: #ffffff;
  --text-primary: #333333;
  --text-secondary: #4d4d4d;
  --text-tertiary: #767676;
  --text-button-primary: #ffffff;
  --text-button-secondary: #4d4d4d;
  --bg-button-secondary: #e9ecef;
  --border-color: #dcdfe4;
  --bg-section: rgba(0, 0, 0, 0.02);
  --bg-danger: #ef4444;
  --bg-danger-hover: #dc2626;
  --bg-input: #ffffff;
  --border-input: #dcdfe4;
  --switch-track-off: #d0d0d0;
  --switch-track-on: #3b82f6;
  --switch-thumb: #ffffff;
  --slider-track: #e9ecef;
  --slider-thumb: #3b82f6;
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
}

/* Dark theme variables */
[data-theme="dark"],
.dark-mode {
  --bg-dialog: #1e293b;
  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
  --text-tertiary: #94a3b8;
  --text-button-primary: #ffffff;
  --text-button-secondary: #cbd5e1;
  --bg-button-secondary: #334155;
  --border-color: #334155;
  --bg-section: rgba(255, 255, 255, 0.03);
  --bg-danger: #ef4444;
  --bg-danger-hover: #dc2626;
  --bg-input: #0f172a;
  --border-input: #334155;
  --switch-track-off: #475569;
  --switch-track-on: #3b82f6;
  --switch-thumb: #ffffff;
  --slider-track: #334155;
  --slider-thumb: #3b82f6;
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.3);
}

/* Ensure consistent styling for sidebar elements in both themes */
.sidebar .logo {
  color: #f8fafc;
}

.sidebar .nav-header {
  color: rgba(255, 255, 255, 0.7);
}

.sidebar .nav-link {
  color: #e2e8f0;
}

.sidebar .nav-link:hover,
.sidebar .nav-link.active {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.sidebar .nav-link.active {
  background-color: var(--primary);
  color: white;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

/* Modal backdrop */
.admin-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  z-index: 999;
}

/* Admin dashboard container */
.admin-dashboard {
  position: fixed;
  top: 60px; /* Position below navbar - adjust based on your navbar height */
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 1200px;
  max-height: calc(100vh - 80px); /* Leave space for navbar and notifications */
  overflow-y: auto;
  background-color: var(--bg-dialog);
  z-index: 1000;
  border-radius: 8px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
}

/* Close button */
.close-dashboard-btn {
  position: absolute;
  top: 8px; /* Move it higher into the top bar */
  right: 16px; /* Position closer to the right edge */
  background: rgba(0, 0, 0, 0.2);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-primary);
  z-index: 1100;
  transition: all 0.2s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.close-dashboard-btn:hover {
  background: rgba(239, 68, 68, 0.8);
  color: white;
  transform: scale(1.1);
}

/* Main layout grid */
.dashboard {
  display: grid;
  grid-template-columns: 220px 1fr; /* Slightly smaller sidebar */
  min-height: auto;
  max-height: calc(100vh - 80px);
}

/* Sidebar */
.sidebar {
  background: var(--bg-navbar);
  color: #f8fafc;
  padding: 1.5rem 1rem;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: #f8fafc;
}

.logo-icon {
  background-color: var(--primary);
  color: white;
  height: 2rem;
  width: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
}

.nav-section {
  margin-bottom: 1.5rem;
}

.nav-header {
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
}

.nav-items {
  list-style: none;
}

.nav-item {
  margin-bottom: 0.25rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  text-decoration: none;
  color: #e2e8f0;
  border-radius: 0.375rem;
  transition: all 0.2s;
  cursor: pointer;
}

.nav-link:hover,
.nav-link.active {
  background-color: rgba(255, 255, 255, 0.1);
  color: white;
}

.nav-link.active {
  background-color: var(--primary);
  color: white;
}

/* Main Content */
.main {
  padding: 1.5rem;
  background-color: var(--bg-dialog);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Rest of the existing styles... */
.user-menu {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.notification {
  position: relative;
  cursor: pointer;
}

.notification-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background-color: var(--danger);
  color: white;
  height: 18px;
  width: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.user-avatar {
  height: 2.5rem;
  width: 2.5rem;
  border-radius: 50%;
  background-color: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}

/* Quick Stats */
.quick-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.stat-card {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  padding: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  border: 1px solid var(--border-color);
}

.stat-title {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-primary);
}

.stat-trend {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.trend-up {
  color: var(--success);
}

.trend-down {
  color: var(--danger);
}

/* Tabs */
.tabs {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  margin-bottom: 1rem;
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.tab-header {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  white-space: nowrap;
}

.tab-btn {
  padding: 0.75rem 1.25rem;
  border: none;
  background: none;
  font-size: 0.9rem;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.tab-btn.active {
  border-bottom-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

.tab-content {
  padding: 1.25rem;
}

/* Dashboard Grid */
.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.dashboard-card {
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid var(--border-color);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.card-actions {
  display: flex;
  gap: 0.5rem;
}

.btn {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--bg-button-primary) !important;
  color: var(--text-button-primary) !important;
}

.btn-primary:hover {
  background-color: var(--bg-button-primary-hover, #8b3c7a) !important;
}

.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.btn-outline:hover {
  background-color: var(--bg-section);
}

/* Health Status */
.health-status {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.health-item {
  padding: 0.5rem;
  border-radius: 0.375rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.health-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.health-item-message {
  font-size: 0.72rem;
  color: #6b7280;
  font-weight: normal;
  line-height: 1.3;
}

/* AI Configuration */
.ai-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.ai-config-section {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 6px;
  padding: 12px;
}

.ai-config-section-title {
  margin: 0 0 10px 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary, #374151);
}

.ai-config-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-config-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.ai-config-item-wide {
  flex-direction: column;
  gap: 4px;
}

.ai-config-label {
  font-size: 0.78rem;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  flex-shrink: 0;
}

.ai-config-value {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-primary, #374151);
  text-align: right;
  word-break: break-all;
}

.ai-config-prompt {
  text-align: left;
  font-size: 0.74rem;
  font-weight: normal;
  font-style: italic;
  color: var(--text-secondary, #6b7280);
  line-height: 1.4;
  word-break: break-word;
}

.status-good {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.status-warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}

.status-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

/* Audit F7: neutral pre-fetch/fetch-failed state — never a fabricated verdict */
.status-unknown {
  background-color: rgba(107, 114, 128, 0.1);
  color: var(--text-secondary, #6b7280);
}

.status-badge {
  height: 0.75rem;
  width: 0.75rem;
  border-radius: 50%;
}

.badge-good {
  background-color: var(--success);
}

.badge-warning {
  background-color: var(--warning);
}

.badge-error {
  background-color: var(--danger);
}

.badge-unknown {
  background-color: #9ca3af;
}

/* Database Section */
.db-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.db-action-card {
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.75rem;
  cursor: pointer;
  transition: all 0.2s;
  background-color: var(--bg-dialog);
  font-size: 0.8rem;
}

.db-action-card:hover {
  border-color: var(--primary);
}

.action-icon {
  margin-bottom: 0.5rem;
  font-size: 1.25rem;
  color: var(--primary);
}

.action-title {
  font-weight: 600;
  margin-bottom: 0.25rem;
  color: var(--text-primary);
}

.action-desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.db-stats {
  color: var(--text-primary);
  font-size: 0.8rem;
}

/* Log Table */
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.log-table th,
.log-table td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.log-table th {
  font-weight: 600;
  color: var(--text-secondary);
}

.log-level {
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  font-weight: 600;
}

.log-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}

.log-warning {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}

.log-info {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

.table-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.pagination {
  display: flex;
  gap: 0.25rem;
}

.page-btn {
  height: 1.8rem;
  width: 1.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  border: 1px solid var(--border-color);
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.page-btn.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* Resource Usage */
.resource-usage {
  padding: 0.5rem 0;
}

.usage-item {
  margin-bottom: 0.75rem;
}

.usage-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
  font-size: 0.8rem;
}

.usage-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.usage-value {
  color: var(--text-primary);
}

.usage-bar {
  height: 0.5rem;
  border-radius: 0.25rem;
  background-color: var(--border);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 0.25rem;
}

.usage-low {
  background-color: var(--success);
}

.usage-medium {
  background-color: var(--warning);
}

.usage-high {
  background-color: var(--danger);
}

/* Feature Flags */
.feature-list {
  display: grid;
  gap: 0.75rem;
}

.feature-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  border-radius: 0.375rem;
  border: 1px solid var(--border-color);
  background-color: var(--bg-dialog);
  font-size: 0.8rem;
}

.feature-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.feature-name {
  font-weight: 600;
  color: var(--text-primary);
}

.feature-description {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.toggle {
  position: relative;
  display: inline-block;
  width: 2.5rem;
  height: 1.25rem;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--switch-track-off);
  transition: 0.4s;
  border-radius: 1.25rem;
}

.slider:before {
  position: absolute;
  content: "";
  height: 0.85rem;
  width: 0.85rem;
  left: 0.2rem;
  bottom: 0.2rem;
  background-color: var(--switch-thumb);
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--switch-track-on);
}

input:checked + .slider:before {
  transform: translateX(1.25rem);
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  color: white;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: var(--primary);
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1200;
}

.modal-content {
  width: 450px;
  max-width: 90vw;
  background-color: var(--bg-dialog);
  border-radius: 0.5rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-title {
  padding: 1rem;
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.modal-footer {
  padding: 1rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  border-top: 1px solid var(--border-color);
}

.btn-close,
.btn-save {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  border: none;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.btn-save {
  background-color: var(--bg-button-primary);
  color: var(--text-button-primary);
}

.btn-close {
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
}

/* Responsive Adjustments */
@media (max-width: 1024px) {
  .admin-dashboard {
    width: 95%;
  }

  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .quick-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .admin-dashboard {
    width: 95%;
    top: 50px;
    max-height: calc(100vh - 60px);
  }

  .close-dashboard-btn {
    top: 60px;
  }

  .dashboard {
    grid-template-columns: 1fr;
  }

  .sidebar {
    display: none;
  }

  .health-status,
  .db-actions {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .admin-dashboard {
    width: 98%;
    top: 45px;
  }

  .close-dashboard-btn {
    top: 55px;
    right: 10px;
  }

  .quick-stats {
    grid-template-columns: 1fr;
  }

  .health-status,
  .db-actions {
    grid-template-columns: 1fr;
  }

  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .page-title {
    font-size: 1.25rem;
  }

  .user-menu {
    width: 100%;
    justify-content: flex-end;
  }

  .tab-header {
    flex-wrap: wrap;
  }

  .tab-btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .card-actions {
    align-self: flex-start;
  }
}

/* Ensure text colors in dark mode */
[data-theme="dark"] .page-title {
  color: #f8fafc !important; /* Bright white for high contrast */
}

[data-theme="dark"] .header {
  color: #f8fafc;
}

[data-theme="dark"] .card-title {
  color: #f8fafc !important;
}

[data-theme="dark"] .stat-title {
  color: #cbd5e1 !important; /* Slightly softer white for secondary titles */
}

[data-theme="dark"] .stat-value {
  color: #f8fafc !important;
}

[data-theme="dark"] .dashboard-card {
  color: #f8fafc;
}

/* Log Config Bar Styles */
.log-config-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background-color: var(--bg-section);
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.log-config-bar .config-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.log-config-bar .config-item label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.log-level-select {
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-dialog);
  color: var(--text-primary);
}

.config-status {
  margin-left: auto;
}

.config-status-text {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
}

.config-status-text.success {
  color: var(--success);
  background-color: rgba(34, 197, 94, 0.1);
}

.config-status-text.error {
  color: var(--danger);
  background-color: rgba(239, 68, 68, 0.1);
}

/* Log Summary Styles */
.logs-summary {
  margin-bottom: 1.5rem;
}

.summary-title {
  display: flex;
  align-items: center;
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.status-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 0.5rem;
}

.status-indicator.error {
  background-color: var(--danger);
}

.status-indicator.warning {
  background-color: var(--warning);
}

.log-summary-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.log-summary-table th,
.log-summary-table td {
  padding: 0.625rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.log-summary-table th {
  background-color: var(--bg-section);
  font-weight: 600;
  color: var(--text-secondary);
}

.log-summary-table td.log-count {
  font-weight: 600;
  text-align: center;
}

.logs-info {
  display: flex;
  align-items: center;
  padding: 0.75rem;
  background-color: var(--bg-section);
  border-radius: 0.375rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.logs-info svg {
  margin-right: 0.5rem;
  color: var(--primary);
}

.empty-logs {
  text-align: center;
  color: var(--text-tertiary);
  padding: 1rem;
}

[data-theme="dark"] .logs-summary h3,
[data-theme="dark"] .summary-title {
  color: #f8fafc !important;
}

[data-theme="dark"] h3 {
  color: #f8fafc !important;
}

/* Add these styles to your <style> section in AdminDashboard.vue */

/* Update search bar for better spacing with button */
.search-bar {
  display: flex;
  margin-bottom: 1rem;
  gap: 0.75rem;
  align-items: center;
}

.search-input-container {
  position: relative;
  flex: 1;
}

.search-button .btn {
  height: 100%;
  min-height: 38px;
}

/* Loading indicator for search */
.search-loading {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.loading-spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top-color: var(--primary);
  animation: spin 1s linear infinite;
  margin-right: 0.5rem;
}

/* Pagination styles */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.page-btn {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
  font-size: 0.875rem;
  cursor: pointer;
}

.page-btn:hover:not(:disabled) {
  background-color: var(--bg-section);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

/* Make search results info more prominent */
.search-results-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  background-color: var(--bg-section);
  border-radius: 0.25rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Dark mode specific adjustments */
[data-theme="dark"] .loading-spinner-small {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: var(--primary);
}

/* User Stats Summary */
.user-stats-summary {
  margin-bottom: 1rem;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap; /* Allow wrapping on smaller screens */
  gap: 1rem; /* Add spacing between items */
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem; /* Space between label and value */
}

.stat-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap; /* Prevent label from wrapping */
}

.stat-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Responsive Adjustments */
@media (max-width: 768px) {
  .stats-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .stat-item {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 480px) {
  .stat-label {
    font-size: 0.75rem;
  }

  .stat-value {
    font-size: 0.875rem;
  }
}

.security-findings-section {
  margin-top: 1.5rem;
}

.vulnerability-section {
  margin-bottom: 1.5rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}

.section-title {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  background-color: var(--bg-section);
  border-bottom: 1px solid var(--border-color);
}

.severity-indicator {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 0.5rem;
}

.severity-indicator.critical {
  background-color: var(--danger);
}

.severity-indicator.medium,
.severity-indicator.warning {
  background-color: var(--warning);
}

.severity-indicator.low {
  background-color: var(--text-tertiary);
}

.severity-indicator.info {
  background-color: var(--primary);
}

.vulnerability-list {
  padding: 1rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.vulnerability-card {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1rem;
  background-color: var(--bg-dialog);
}

.vuln-type {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.vuln-description {
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.vuln-detail {
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
  color: var(--text-secondary);
}

.vuln-examples {
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
  color: var(--text-secondary);
}

.vuln-examples ul {
  margin-top: 0.25rem;
  padding-left: 1.5rem;
}

.vuln-examples li {
  margin-bottom: 0.25rem;
}

.vuln-recommendation {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  padding: 0.5rem;
  background-color: var(--bg-section);
  border-radius: 4px;
  color: var(--text-primary);
}

.detail-table {
  padding: 0 1rem 1rem;
  overflow-x: auto;
}

.detail-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  table-layout: fixed;
}

.detail-table td,
.detail-table th {
  padding: 0.75rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top; /* Vertically align all cell content to the top */
}

.detail-table th {
  font-weight: 600;
  color: var(--text-secondary);
}

/* NEW: Style for wrapping text in message cells */
.log-message-cell {
  word-wrap: break-word;
  word-break: break-word;
  white-space: normal;
}

.show-more {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}

.full-list {
  border-top: 1px dashed var(--border-color);
  padding-top: 1rem;
}

.recommendations-list {
  padding: 1rem;
}

.recommendation-item {
  margin-bottom: 1rem;
  padding: 1rem;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background-color: var(--bg-dialog);
}

.recommendation-item.severity-critical {
  border-left: 4px solid var(--danger);
}

.recommendation-item.severity-medium {
  border-left: 4px solid var(--warning);
}

.recommendation-item.severity-low {
  border-left: 4px solid var(--text-tertiary);
}

.scan-age-notice {
  font-size: 0.85em;
  color: var(--text-secondary);
  font-style: italic;
}

.recommendation-header {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}

.recommendation-title {
  font-weight: 600;
  color: var(--text-primary);
}

.recommendation-description {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 0.75rem;
}

.recommendation-action {
  font-size: 0.85rem;
  color: var(--text-primary);
  background-color: var(--bg-section);
  padding: 0.5rem;
  border-radius: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
}

.empty-icon {
  font-size: 2.5rem;
  color: var(--success);
  margin-bottom: 1rem;
  height: 60px;
  width: 60px;
  border-radius: 50%;
  background-color: rgba(16, 185, 129, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.empty-description {
  color: var(--text-secondary);
  max-width: 400px;
}

.text-danger {
  color: var(--danger);
  font-weight: 600;
}

.text-warning {
  color: var(--warning);
  font-weight: 600;
}

.text-info {
  color: var(--primary);
  font-weight: 600;
}

.loading-indicator-inline {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s linear infinite;
  margin-right: 8px;
  vertical-align: middle;
}

/* Dark mode adjustments */
[data-theme="dark"] .vuln-description,
[data-theme="dark"] .vuln-detail,
[data-theme="dark"] .empty-title,
[data-theme="dark"] .recommendation-title {
  color: #f1f5f9 !important;
}

[data-theme="dark"] .empty-description,
[data-theme="dark"] .recommendation-description {
  color: #cbd5e1 !important;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.medium-section {
  border-left: 4px solid var(--warning);
}

.severity-indicator.medium,
.severity-indicator.warning {
  background-color: var(--warning);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.loading-spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 0.5rem;
}

[data-theme="dark"] .loading-state {
  color: var(--text-tertiary);
}

/* ... at the end of <style scoped> ... */

/* --- STYLES FOR KNOWLEDGE HIERARCHY --- */
.hierarchy-container {
  display: flex;
  gap: 1.5rem;
  min-height: 400px;
}
.hierarchy-tree-panel {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 1rem;
  overflow-y: auto;
}
.hierarchy-form-panel {
  flex-basis: 350px;
  padding: 1rem;
  background-color: var(--bg-section);
  border-radius: 0.375rem;
}
.hierarchy-list,
.hierarchy-services-list {
  list-style: none;
  padding-left: 0;
}
.hierarchy-services-list {
  padding-left: 2rem;
  border-left: 2px solid var(--border-color);
  margin-left: 0.5rem;
}
.hierarchy-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  border-radius: 0.25rem;
  margin-bottom: 0.25rem;
}
.hierarchy-item:hover {
  background-color: var(--bg-section);
}
.hierarchy-item .item-name {
  font-weight: 500;
}
.hierarchy-item.service-item .item-name {
  font-weight: 400;
  color: var(--text-secondary);
}
.hierarchy-item .item-actions {
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
}
.hierarchy-item:hover .item-actions {
  opacity: 1;
}
.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
}
.empty-hierarchy {
  text-align: center;
  color: var(--text-tertiary);
  padding: 2rem;
}
.form-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-primary);
}
.form-group {
  margin-bottom: 1rem;
}
/* L.5 part 2: prompt textareas span the full card width (they were intrinsic
   ~20-col boxes before — see Adem's 10-06 screenshot) */
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-input);
  border-radius: 0.25rem;
  background-color: var(--bg-input);
  color: var(--text-primary);
  resize: vertical;
}
.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.form-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-input);
  border-radius: 0.25rem;
  background-color: var(--bg-input);
  color: var(--text-primary);
}
.form-actions {
  display: flex;
  gap: 0.5rem;
}

/* --- STYLES FOR DOCUMENT MANAGEMENT --- */
.filter-bar {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}
.filter-select {
  padding: 0.5rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border-input);
  background-color: var(--bg-input);
  color: var(--text-primary);
}
.document-row {
  cursor: pointer;
}
.document-row:hover {
  background-color: var(--bg-section);
}
.status-tag {
  padding: 0.2rem 0.6rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}
.status-ingested {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success);
}
.status-ingesting {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}
.status-ingested-with-warnings {
  background-color: rgba(245, 158, 11, 0.1);
  color: var(--warning);
}
.status-ingestion-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}
/* NEW: Error status for failed/killed crawls */
.status-error {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}
.status-pending {
  background-color: rgba(22, 72, 144, 0.1);
  color: var(--secondary);
}
.status-retracted {
  background-color: rgba(100, 116, 139, 0.1);
  color: var(--secondary);
}
.label-tag {
  background-color: var(--bg-section);
  padding: 0.2rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  margin-right: 0.25rem;
  color: var(--text-secondary);
}
.label-tag-more {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.translations-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}
.translations-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}
.translation-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.translation-lang-select {
  flex-basis: 150px;
  padding: 0.5rem;
  border: 1px solid var(--border-input);
  border-radius: 0.25rem;
  background-color: var(--bg-input);
}
.translation-text-input {
  flex-grow: 1;
  padding: 0.5rem;
  border: 1px solid var(--border-input);
  border-radius: 0.25rem;
  background-color: var(--bg-input);
}
.translation-delete-btn {
  background: none;
  border: none;
  color: var(--danger, #ef4444);
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0.25rem;
}
.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.data-table th,
.data-table td {
  padding: 0.75rem; /* Increased padding for better spacing */
  text-align: left;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap; /* Prevent headers from wrapping */
}

.data-table th {
  font-weight: 600;
  color: var(--text-secondary);
  background-color: var(--bg-section);
}

/* Style for the main text column to allow wrapping if needed */
.data-table .cell-main {
  white-space: normal;
}

/* Make sortable headers interactive */
.sortable {
  cursor: pointer;
  user-select: none;
}
.sortable:hover {
  background-color: var(--border-color);
}
.sort-arrow {
  margin-left: 5px;
  color: var(--primary);
}

/* Column width classes (replace inline styles) */
.col-checkbox {
  width: 40px;
}
.col-status {
  width: 120px;
}
.col-labels {
  width: 200px;
} /* Give labels a bit more space */
.col-date {
  width: 150px;
}
.col-size {
  width: 100px;
}
.col-main {
  width: auto;
} /* Let the main column fill remaining space */

/* Style for empty/loading states */
.table-message {
  text-align: center;
  padding: 2rem;
  color: var(--text-tertiary);
}

/* Pending Users Section */
.pending-users-section {
  margin-bottom: 1.5rem;
  border: 2px solid var(--warning, #f59e0b);
  border-radius: 8px;
  padding: 1rem;
  background: rgba(245, 158, 11, 0.05);
}

.pending-users-header {
  margin-bottom: 0.75rem;
}

.pending-users-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.pending-icon {
  font-size: 1.2rem;
}

.pending-count-badge {
  background: var(--warning, #f59e0b);
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 10px;
}

.pending-table {
  margin-top: 0.5rem;
}

.role-select-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-dialog);
  color: var(--text-primary);
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
}

.btn-success {
  background-color: #10b981;
  color: white;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
}

.btn-success:hover {
  background-color: #059669;
}

.btn-danger {
  background-color: #ef4444;
  color: white;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
}

.btn-danger:hover {
  background-color: #dc2626;
}

.btn-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
}

[data-theme="dark"] .pending-users-section {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.5);
}

[data-theme="dark"] .role-select-small {
  background: var(--bg-section);
  border-color: var(--border-color);
  color: var(--text-primary);
}

/* --- QUICK HELP BUTTONS (J.4, DEC-28) --- */
.quickhelp-admin-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quickhelp-admin-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-section);
}

.quickhelp-admin-order {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quickhelp-admin-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  flex-shrink: 0;
}

.quickhelp-admin-text {
  flex: 1;
  min-width: 0;
}

.quickhelp-admin-title {
  font-weight: 600;
  color: var(--text-primary);
}

.quickhelp-admin-st {
  font-weight: 400;
  color: var(--text-secondary);
}

.quickhelp-admin-disabled {
  color: var(--text-secondary);
  font-style: italic;
}

.quickhelp-admin-prompt {
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quickhelp-admin-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.quickhelp-admin-actions {
  display: flex;
  gap: 4px;
}

.quickhelp-admin-form {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-section);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.quickhelp-admin-form .form-actions {
  display: flex;
  gap: 8px;
}

/* K.2 pipeline-settings panel */
.pipeline-settings-gen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.pipeline-settings-caveat {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.72rem;
  background: rgba(245, 158, 11, 0.15);
  color: #b45309;
}
.pipeline-settings-audit {
  margin-top: 12px;
  font-size: 0.78rem;
  opacity: 0.75;
  border-top: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
  padding-top: 8px;
}
/* K.3: GET warnings banner — the file carries garbage-typed values */
.pipeline-settings-warnings {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #b91c1c;
}
.pipeline-settings-warnings ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>