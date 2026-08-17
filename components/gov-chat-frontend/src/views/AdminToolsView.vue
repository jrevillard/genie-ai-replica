<template>
  <div class="admin-page">
    <div class="admin-dashboard">
      <div class="dashboard">
        <!-- Sidebar Navigation -->
        <div class="sidebar">
          <div class="nav-section">
            <div class="nav-header">TOOLS & INTEGRATIONS</div>
            <ul class="nav-items">
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'feeds' }]"
                  @click.prevent="activeTab = 'feeds'"
                >
                  <i>📡</i>
                  <span>RSS Feeds</span>
                </a>
              </li>
              <li class="nav-item">
                <a
                  href="#"
                  :class="['nav-link', { active: activeTab === 'searxng' }]"
                  @click.prevent="activeTab = 'searxng'"
                >
                  <i>🔍</i>
                  <span>Web Search (SearXNG)</span>
                </a>
              </li>
            </ul>
          </div>
          <div class="nav-section">
            <div class="nav-header">NAVIGATION</div>
            <ul class="nav-items">
              <li class="nav-item">
                <router-link to="/admin" class="nav-link">
                  <i>⬅️</i>
                  <span>Back to Admin</span>
                </router-link>
              </li>
            </ul>
          </div>
        </div>

        <!-- Main Content Area -->
        <div class="main">
          <div class="header">
            <h1 class="page-title">Tools Management</h1>
          </div>

          <!-- Feeds Tab -->
          <div v-if="activeTab === 'feeds'" class="dashboard-card">
            <div class="card-header">
              <div class="card-title">RSS Stream Ingestor Feeds</div>
              <div class="card-actions">
                <DsButton variant="primary" @click="showAddFeedModal = true">
                  + Add Feed
                </DsButton>
              </div>
            </div>

            <DsStateDisplay v-if="isLoadingFeeds" type="loading">
              Loading feeds...
            </DsStateDisplay>
            <DsStateDisplay v-else-if="error" type="error">
              {{ error }}
            </DsStateDisplay>
            
            <div class="table-container" v-else>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Feed Title</th>
                    <th>URL</th>
                    <th>Interval (s)</th>
                    <th>Status</th>
                    <th>Failures</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="feeds.length === 0">
                    <td colspan="6" class="table-message">No feeds configured.</td>
                  </tr>
                  <tr v-for="feed in feeds" :key="feed._key">
                    <td>{{ feed.title }}</td>
                    <td class="cell-main">{{ feed.url }}</td>
                    <td>{{ feed.polling_interval }}</td>
                    <td>
                      <DsStatusTag :variant="feed.enabled ? 'success' : 'danger'">
                        {{ feed.enabled ? 'Active' : 'Disabled' }}
                      </DsStatusTag>
                    </td>
                    <td>{{ feed.failures || 0 }}</td>
                    <td>
                      <DsButton variant="ghost" @click="editFeed(feed)">✏️</DsButton>
                      <DsButton variant="ghost" @click="deleteFeed(feed._key)">🗑️</DsButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- SearXNG Tab -->
          <div v-if="activeTab === 'searxng'" class="dashboard-card">
            <div class="card-header">
              <div class="card-title">SearXNG Web Search Integration</div>
            </div>
            <div class="p-4">
              <p class="mb-4">
                SearXNG is integrated natively via the backend search service. 
                Configure search parameters to test connectivity.
              </p>
              
              <div class="form-group mb-4">
                <label>Test Search Query</label>
                <div style="display: flex; gap: 8px;">
                  <DsInput v-model="searchQuery" placeholder="Enter query..." style="flex: 1;" />
                  <DsButton variant="primary" @click="runTestSearch" :disabled="!searchQuery || isSearching">
                    {{ isSearching ? 'Searching...' : 'Test Search' }}
                  </DsButton>
                </div>
              </div>

              <div v-if="searchResults" class="search-results mt-4">
                <h4>Results ({{ searchResults.results?.length || 0 }})</h4>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>URL</th>
                        <th>Engine</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="result in (searchResults.results || []).slice(0, 5)" :key="result.url">
                        <td>{{ result.title }}</td>
                        <td class="cell-main"><a :href="result.url" target="_blank">{{ result.url }}</a></td>
                        <td>{{ result.engine }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Add/Edit Feed Modal -->
    <div v-if="showAddFeedModal" class="modal-overlay">
      <div class="modal-content" style="max-width: 500px;">
        <h3 class="modal-title">{{ editingFeed ? 'Edit Feed' : 'Add New Feed' }}</h3>
        
        <div class="form-group">
          <label>Title</label>
          <DsInput v-model="feedForm.title" placeholder="e.g. UN News" />
        </div>
        
        <div class="form-group mt-3">
          <label>RSS URL</label>
          <DsInput v-model="feedForm.url" placeholder="https://..." />
        </div>

        <div class="form-group mt-3">
          <label>Polling Interval (seconds)</label>
          <DsInput type="number" v-model.number="feedForm.polling_interval" />
        </div>

        <div class="form-group mt-3" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="feed-enabled" v-model="feedForm.enabled" />
          <label for="feed-enabled" style="margin: 0;">Enabled</label>
        </div>

        <div class="modal-actions mt-4" style="display: flex; justify-content: flex-end; gap: 8px;">
          <DsButton variant="secondary" @click="closeFeedModal">Cancel</DsButton>
          <DsButton variant="primary" @click="saveFeed" :disabled="!feedForm.title || !feedForm.url">Save Feed</DsButton>
        </div>
      </div>
    </div>

  </div>
</template>

<script>
import { mapState, mapActions } from 'vuex';
import DsButton from '@/components/design-system/DsButton.vue';
import DsInput from '@/components/design-system/DsInput.vue';
import DsStateDisplay from '@/components/design-system/DsStateDisplay.vue';
import DsStatusTag from '@/components/design-system/DsStatusTag.vue';

export default {
  name: 'AdminToolsView',
  components: {
    DsButton,
    DsInput,
    DsStateDisplay,
    DsStatusTag,
  },
  data() {
    return {
      activeTab: 'feeds',
      showAddFeedModal: false,
      editingFeed: null,
      feedForm: {
        title: '',
        url: '',
        polling_interval: 3600,
        enabled: true,
      },
      searchQuery: '',
      isSearching: false,
      searchResults: null,
    };
  },
  computed: {
    ...mapState('tools', ['feeds', 'isLoadingFeeds', 'error']),
  },
  mounted() {
    this.fetchFeeds();
  },
  methods: {
    ...mapActions('tools', ['fetchFeeds', 'addFeed', 'updateFeed', 'deleteFeed', 'testSearch']),
    
    closeFeedModal() {
      this.showAddFeedModal = false;
      this.editingFeed = null;
      this.feedForm = {
        title: '',
        url: '',
        polling_interval: 3600,
        enabled: true,
      };
    },
    
    editFeed(feed) {
      this.editingFeed = feed;
      this.feedForm = { ...feed };
      this.showAddFeedModal = true;
    },
    
    async saveFeed() {
      let success = false;
      if (this.editingFeed) {
        success = await this.updateFeed({ id: this.editingFeed._key, data: this.feedForm });
      } else {
        success = await this.addFeed(this.feedForm);
      }
      if (success) {
        this.closeFeedModal();
      }
    },
    
    async removeFeed(id) {
      if (confirm('Are you sure you want to delete this feed?')) {
        await this.deleteFeed(id);
      }
    },

    async runTestSearch() {
      if (!this.searchQuery) return;
      this.isSearching = true;
      try {
        this.searchResults = await this.testSearch(this.searchQuery);
      } catch (e) {
        console.error(e);
      } finally {
        this.isSearching = false;
      }
    }
  }
};
</script>

<style scoped>
@import '@/assets/theme-components.css';

.admin-page {
  display: flex;
  height: 100vh;
  background-color: var(--color-background-soft);
}

.admin-dashboard {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.dashboard {
  display: flex;
  width: 100%;
}

.sidebar {
  width: 250px;
  background-color: var(--color-surface);
  border-right: 1px solid var(--color-border);
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.nav-section {
  padding: 0 1rem;
}

.nav-header {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-light);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
  padding-left: 0.5rem;
}

.nav-items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.nav-item {
  margin-bottom: 0.25rem;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: var(--color-text);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
  font-weight: 500;
}

.nav-link:hover {
  background-color: var(--color-background-soft);
  color: var(--color-primary);
}

.nav-link.active {
  background-color: var(--color-primary-light);
  color: var(--color-primary);
}

.nav-link i {
  font-size: 1.25rem;
}

.main {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.header {
  margin-bottom: 2rem;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-heading);
  margin: 0;
}

.dashboard-card {
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  overflow: hidden;
  margin-bottom: 2rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-soft);
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-heading);
  margin: 0;
}

.table-container {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 1rem 1.5rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.data-table th {
  font-weight: 600;
  color: var(--color-text-light);
  font-size: 0.875rem;
  background-color: var(--color-background-soft);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:hover {
  background-color: var(--color-background-soft);
}

.cell-main {
  font-weight: 500;
  color: var(--color-heading);
}

.table-message {
  text-align: center;
  color: var(--color-text-light);
  padding: 2rem;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--color-surface);
  padding: 2rem;
  border-radius: var(--radius-lg);
  width: 100%;
  box-shadow: var(--shadow-lg);
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  color: var(--color-heading);
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--color-heading);
}

.mt-3 { margin-top: 1rem; }
.mt-4 { margin-top: 1.5rem; }
.mb-4 { margin-bottom: 1rem; }
.p-4 { padding: 1.5rem; }
</style>
