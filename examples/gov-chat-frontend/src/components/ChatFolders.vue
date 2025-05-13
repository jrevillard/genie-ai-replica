<!-- Simple version with proper behavior based on console logs -->
<template>
  <div class="chat-folders" :data-theme="$route.meta.theme || 'light'">
    <!-- Folders Section - Only show in second-level folders tab, hide in history tab when viewing All tab -->
    <template v-if="shouldShowFoldersSection">
      <div class="folders-header">
        <h3>{{ $t('sidebar.folders') }}</h3>
        <button @click="showCreateFolderDialog = true" class="add-folder-btn" title="Create New Folder">
          <i class="fas fa-folder-plus"></i>
        </button>
      </div>

      <!-- Folder List -->
      <div class="folders-list">
        <div v-for="folder in nonDefaultFolders" :key="folder.id"
          :class="['folder-item', { 'folder-item-active': selectedFolderId === folder.id }]"
          @click="selectFolder(folder.id)">
          <div class="folder-icon">
            <i class="fas fa-folder"></i>
          </div>
          <div class="folder-details">
            <div class="folder-name">{{ folder.name }}</div>
            <div class="folder-count">{{ getChatCount(folder.id) }} {{ getChatCount(folder.id) === 1 ? 'chat' : 'chats' }}
            </div>
          </div>
          <div class="folder-actions">
            <button @click.stop="openEditFolderDialog(folder)" class="edit-btn" title="Edit Folder">
              <i class="fas fa-edit"></i>
            </button>
            <button @click.stop="openDeleteFolderDialog(folder)" class="delete-btn" title="Delete Folder">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Chats in Selected Folder -->
    <div class="folder-chats" v-if="selectedFolder">
      <h3>{{ selectedFolder.name }}</h3>

      <div class="chats-list" v-if="folderChats.length > 0">
        <div v-for="chat in folderChats" :key="chat.id" class="chat-item" @click="openChat(chat.id)">
          <div class="chat-icon">
            <i class="fas fa-comment"></i>
          </div>
          <div class="chat-details">
            <div class="chat-title">{{ chat.title }}</div>
            <div class="chat-preview">{{ chat.preview }}</div>
            <div class="chat-date">{{ formatDate(chat.updatedAt) }}</div>
          </div>
          <div class="chat-actions">
            <button @click.stop="showChatActionsMenu(chat, $event)" class="action-btn" title="Chat Actions">
              <i class="fas fa-ellipsis-v"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="empty-folder" v-else>
        <p>{{ $t('sidebar.emptyFolder') }}</p>
      </div>
    </div>

    <!-- Create Folder Dialog -->
    <modal-dialog v-if="showCreateFolderDialog" @close="showCreateFolderDialog = false">
      <template v-slot:header>
        <h3>{{ $t('sidebar.createFolder') }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="folderName">{{ $t('sidebar.folderName') }}</label>
          <input type="text" id="folderName" v-model="newFolderName" :placeholder="$t('sidebar.folderNamePlaceholder')"
            @keyup.enter="handleCreateFolder">
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showCreateFolderDialog = false" class="cancel-btn">{{ $t('common.cancel') }}</button>
        <button @click="handleCreateFolder" class="primary-btn" :disabled="!newFolderName.trim()">
          {{ $t('common.create') }}
        </button>
      </template>
    </modal-dialog>

    <!-- Edit Folder Dialog -->
    <modal-dialog v-if="showEditFolderDialog" @close="editingFolder = null; showEditFolderDialog = false;">
      <template v-slot:header>
        <h3>{{ $t('sidebar.editFolder') }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="editFolderName">{{ $t('sidebar.folderName') }}</label>
          <input type="text" id="editFolderName" v-model="editingFolderName"
            :placeholder="$t('sidebar.folderNamePlaceholder')" @keyup.enter="handleUpdateFolder">
        </div>
      </template>
      <template v-slot:footer>
        <button @click="editingFolder = null; showEditFolderDialog = false;" class="cancel-btn">
          {{ $t('common.cancel') }}
        </button>
        <button @click="handleUpdateFolder" class="primary-btn" :disabled="!editingFolderName.trim()">
          {{ $t('common.save') }}
        </button>
      </template>
    </modal-dialog>

    <!-- Delete Folder Confirmation -->
    <modal-dialog v-if="showDeleteFolderDialog" @close="editingFolder = null; showDeleteFolderDialog = false;">
      <template v-slot:header>
        <h3>{{ $t('sidebar.deleteFolder') }}</h3>
      </template>
      <template v-slot:body>
        <p>{{ $t('sidebar.deleteFolderConfirm', { name: editingFolder ? editingFolder.name : '' }) }}</p>
        <p class="warning-text">{{ $t('sidebar.chatsMoveWarning') }}</p>
      </template>
      <template v-slot:footer>
        <button @click="editingFolder = null; showDeleteFolderDialog = false;" class="cancel-btn">
          {{ $t('common.cancel') }}
        </button>
        <button @click="handleDeleteFolder" class="danger-btn">
          {{ $t('common.delete') }}
        </button>
      </template>
    </modal-dialog>

    <!-- Chat Action Menu -->
    <context-menu v-if="showChatMenu" :position="menuPosition" @close="showChatMenu = false">
      <button @click="promptRenameChat" class="menu-item">
        <i class="fas fa-edit"></i> {{ $t('sidebar.renameChat') }}
      </button>
      <button @click="showMoveChatDialog = true" class="menu-item">
        <i class="fas fa-exchange-alt"></i> {{ $t('sidebar.moveChat') }}
      </button>
      <button @click="promptDeleteChat" class="menu-item text-danger">
        <i class="fas fa-trash"></i> {{ $t('sidebar.deleteChat') }}
      </button>
    </context-menu>

    <!-- Move Chat Dialog -->
    <modal-dialog v-if="showMoveChatDialog" @close="showMoveChatDialog = false">
      <template v-slot:header>
        <h3>{{ $t('sidebar.moveChat') }}</h3>
      </template>
      <template v-slot:body>
        <p>{{ $t('sidebar.moveChatTo', { title: activeChat ? activeChat.title : '' }) }}</p>
        <div class="form-group">
          <label for="destinationFolder">{{ $t('sidebar.selectFolder') }}</label>
          <select id="destinationFolder" v-model="destinationFolderId">
            <option v-for="folder in availableFolders" :key="folder.id" :value="folder.id"
              :disabled="selectedFolderId === folder.id">
              {{ folder.name }}
            </option>
          </select>
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showMoveChatDialog = false" class="cancel-btn">
          {{ $t('common.cancel') }}
        </button>
        <button @click="handleMoveChat" class="primary-btn"
          :disabled="!destinationFolderId || selectedFolderId === destinationFolderId">
          {{ $t('common.move') }}
        </button>
      </template>
    </modal-dialog>

    <!-- Rename Chat Dialog -->
    <modal-dialog v-if="showRenameChatDialog" @close="showRenameChatDialog = false">
      <template v-slot:header>
        <h3>{{ $t('sidebar.renameChat') }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="chatTitle">{{ $t('sidebar.chatTitle') }}</label>
          <input type="text" id="chatTitle" v-model="newChatTitle" :placeholder="$t('sidebar.chatTitlePlaceholder')"
            @keyup.enter="handleRenameChat">
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showRenameChatDialog = false" class="cancel-btn">
          {{ $t('common.cancel') }}
        </button>
        <button @click="handleRenameChat" class="primary-btn" :disabled="!newChatTitle.trim()">
          {{ $t('common.save') }}
        </button>
      </template>
    </modal-dialog>

    <!-- Delete Chat Confirmation -->
    <modal-dialog v-if="showDeleteChatDialog" @close="showDeleteChatDialog = false">
      <template v-slot:header>
        <h3>{{ $t('sidebar.deleteChat') }}</h3>
      </template>
      <template v-slot:body>
        <p>{{ $t('sidebar.deleteChatConfirm', { title: activeChat ? activeChat.title : '' }) }}</p>
        <p class="warning-text">{{ $t('sidebar.deleteChatWarning') }}</p>
      </template>
      <template v-slot:footer>
        <button @click="showDeleteChatDialog = false" class="cancel-btn">
          {{ $t('common.cancel') }}
        </button>
        <button @click="handleDeleteChat" class="danger-btn">
          {{ $t('common.delete') }}
        </button>
      </template>
    </modal-dialog>
  </div>
</template>

<script>
import { mapGetters, mapActions } from 'vuex';
import ModalDialog from './ModalDialog.vue';
import ContextMenu from './ContextMenu.vue';

export default {
  name: 'ChatFolders',

  components: {
    ModalDialog,
    ContextMenu
  },

  data() {
    return {
      selectedFolderId: 'default',
      currentSecondLevelTab: 'all', // Default to 'all' since that seems to be the default

      // For creating folders
      showCreateFolderDialog: false,
      newFolderName: '',

      // For editing folders
      editingFolder: null,
      editingFolderName: '',
      showEditFolderDialog: false,
      showDeleteFolderDialog: false,

      // For chat actions
      activeChat: null,
      showChatMenu: false,
      menuPosition: { x: 0, y: 0 },
      showMoveChatDialog: false,
      destinationFolderId: null,
      showRenameChatDialog: false,
      newChatTitle: '',
      showDeleteChatDialog: false
    };
  },

  computed: {
    ...mapGetters('chatHistory', [
      'getAllFolders',
      'getChatsByFolderId',
      'getFolderById',
      'getChatById'
    ]),

    folders() {
      return this.getAllFolders;
    },

    nonDefaultFolders() {
      return this.folders.filter(folder => !folder.isDefault);
    },

    // Logic to determine if we should show the folders section
    shouldShowFoldersSection() {
      // From the logs, we see parent.activeTab is 'history'
      // We need to determine if we're in the 'folders' second-level tab
      // Check for URL or active second-level tab
      const url = window.location.href;
      
      // If URL contains 'folders' as a path segment or hash
      if (url.includes('/folders') || url.includes('#folders')) {
        return true;
      }
      
      // If the current second-level tab is 'folders'
      if (this.currentSecondLevelTab === 'folders') {
        return true;
      }
      
      // Otherwise, don't show folders section
      return false;
    },

    selectedFolder() {
      return this.getFolderById(this.selectedFolderId);
    },

    folderChats() {
      return this.getChatsByFolderId(this.selectedFolderId);
    },

    availableFolders() {
      return this.folders.filter(folder => !folder.isDefault);
    }
  },

  mounted() {
    console.log('ChatFolders component mounted');
    
    // Check parent's activeTab (which appears to be 'history' from logs)
    if (this.$parent && this.$parent.activeTab) {
      console.log('Parent activeTab:', this.$parent.activeTab);
    }
    
    // Set up event listener for hash/URL changes
    this.checkCurrentTab();
    window.addEventListener('hashchange', this.checkCurrentTab);
    
    // Check for active tab elements in the DOM
    this.checkActiveTabElements();
    
    // Add a small delay to ensure all folders are loaded
    setTimeout(() => {
      // If we're already in the Folders tab, select the first custom folder
      if (this.currentSecondLevelTab === 'folders' && this.selectedFolderId === 'default') {
        this.selectFirstCustomFolder();
      }
    }, 500);
  },
  
  beforeDestroy() {
    window.removeEventListener('hashchange', this.checkCurrentTab);
  },
  
  methods: {
    // Check the current URL to determine which second-level tab we're in
    checkCurrentTab() {
      const url = window.location.href;
      const oldTab = this.currentSecondLevelTab;
      
      if (url.includes('/folders') || url.includes('#folders')) {
        this.currentSecondLevelTab = 'folders';
      } else if (url.includes('/all') || url.includes('#all') || !url.includes('#')) {
        this.currentSecondLevelTab = 'all';
      } else if (url.includes('/starred') || url.includes('#starred')) {
        this.currentSecondLevelTab = 'starred';
      } else if (url.includes('/archived') || url.includes('#archived')) {
        this.currentSecondLevelTab = 'archived';
      }
      
      console.log('Current second-level tab:', this.currentSecondLevelTab);
      
      // If we just switched to the Folders tab, auto-select the first custom folder
      if (oldTab !== 'folders' && this.currentSecondLevelTab === 'folders') {
        this.selectFirstCustomFolder();
      }
    },
    
    // Check active tab elements in the DOM
    checkActiveTabElements() {
      // Look for active elements among all tabs
      const activeElements = document.querySelectorAll('.active, .selected, .router-link-active, .router-link-exact-active');
      const oldTab = this.currentSecondLevelTab;
      
      activeElements.forEach(el => {
        const text = el.textContent.trim().toLowerCase();
        console.log('Found active element:', text, el.tagName, el.className);
        
        // Update current tab based on text content
        if (text === 'folders') {
          this.currentSecondLevelTab = 'folders';
        } else if (text === 'all') {
          this.currentSecondLevelTab = 'all';
        }
      });
      
      // If we just switched to the Folders tab, auto-select the first custom folder
      if (oldTab !== 'folders' && this.currentSecondLevelTab === 'folders') {
        this.selectFirstCustomFolder();
      }
    },
    
    // Select the first custom folder in the list
    selectFirstCustomFolder() {
      console.log('Attempting to select first custom folder');
      const customFolders = this.nonDefaultFolders;
      
      if (customFolders.length > 0) {
        const firstFolder = customFolders[0];
        console.log('Auto-selecting folder:', firstFolder.name, firstFolder.id);
        this.selectFolder(firstFolder.id);
      }
    },
    ...mapActions('chatHistory', [
      'createFolder',
      'updateFolder',
      'deleteFolder',
      'updateChat',
      'deleteChat',
      'moveChat'
    ]),

    // Folder management
    selectFolder(folderId) {
      this.selectedFolderId = folderId;
    },

    getChatCount(folderId) {
      return this.getChatsByFolderId(folderId).length;
    },

    openEditFolderDialog(folder) {
      this.editingFolder = folder;
      this.editingFolderName = folder.name;
      this.showEditFolderDialog = true;
    },

    openDeleteFolderDialog(folder) {
      this.editingFolder = folder;
      this.showDeleteFolderDialog = true;
    },

    // These methods were renamed to avoid conflicts with Vuex actions
    handleCreateFolder() {
      if (this.newFolderName.trim()) {
        this.createFolder(this.newFolderName.trim());
        this.newFolderName = '';
        this.showCreateFolderDialog = false;
      }
    },

    handleUpdateFolder() {
      if (this.editingFolder && this.editingFolderName.trim()) {
        this.updateFolder({
          folderId: this.editingFolder.id,
          name: this.editingFolderName.trim()
        });
        this.editingFolder = null;
        this.editingFolderName = '';
        this.showEditFolderDialog = false;
      }
    },

    handleDeleteFolder() {
      if (this.editingFolder) {
        this.deleteFolder(this.editingFolder.id);

        // If we're currently viewing the deleted folder, switch to default
        if (this.selectedFolderId === this.editingFolder.id) {
          this.selectedFolderId = 'default';
        }

        this.editingFolder = null;
        this.showDeleteFolderDialog = false;
      }
    },

    // Chat management
    openChat(chatId) {
      // Emit event to open chat in the main chat area
      this.$emit('open-chat', chatId);
    },

    showChatActionsMenu(chat, event) {
      this.activeChat = chat;

      // Position the context menu to the left of the button instead of to the right
      const rect = event.target.getBoundingClientRect();
      this.menuPosition = {
        x: rect.left - 184, // Offset by menu width (180px) plus a small gap (4px)
        y: rect.top
      };

      this.showChatMenu = true;
    },

    promptRenameChat() {
      if (this.activeChat) {
        this.newChatTitle = this.activeChat.title;
        this.showRenameChatDialog = true;
        this.showChatMenu = false;
      }
    }, 
    
    handleRenameChat() {
      if (this.activeChat && this.newChatTitle.trim()) {
        this.updateChat({
          chatId: this.activeChat.id,
          title: this.newChatTitle.trim()
        });
        this.showRenameChatDialog = false;
      }
    },

    promptDeleteChat() {
      this.showDeleteChatDialog = true;
      this.showChatMenu = false;
    },

    handleDeleteChat() {
      if (this.activeChat) {
        this.deleteChat(this.activeChat.id);
        this.showDeleteChatDialog = false;
        this.activeChat = null;
      }
    },

    handleMoveChat() {
      if (this.activeChat && this.destinationFolderId) {
        this.moveChat({
          chatId: this.activeChat.id,
          fromFolderId: this.selectedFolderId,
          toFolderId: this.destinationFolderId
        });

        this.showMoveChatDialog = false;
        this.destinationFolderId = null;
      }
    },

    // Utility methods
    formatDate(dateStr) {
      const date = new Date(dateStr);

      // If today, show only time
      const today = new Date();
      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }

      // If this year, show month and day
      if (date.getFullYear() === today.getFullYear()) {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }

      // Otherwise show full date
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
};
</script>

<style scoped>
.chat-folders {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-sidebar);
  color: var(--text-primary);
}

.folders-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
}

.folders-header h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

[data-theme="dark"] .folders-header h3,
html[data-theme="dark"] .folders-header h3 {
  color: rgba(255, 255, 255, 0.7) !important;
}

.add-folder-btn {
  background: none;
  border: none;
  color: var(--accent-color);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px 8px;
  border-radius: 4px;
}

.add-folder-btn:hover {
  background: rgba(78, 151, 209, 0.1);
}

.folders-list {
  overflow-y: auto;
  flex-shrink: 0;
  padding: 8px 0;
}

.folder-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--text-primary);
}

.folder-item:hover {
  background-color: var(--bg-tertiary);
}

.folder-item-active {
  background-color: var(--bg-secondary);
}

.folder-icon {
  margin-right: 12px;
  color: var(--accent-color);
}

.folder-details {
  flex-grow: 1;
}

.folder-name {
  font-weight: 500;
  color: var(--text-primary);
}

.folder-count {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.folder-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.folder-item:hover .folder-actions {
  opacity: 1;
}

.edit-btn,
.delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
}

.edit-btn:hover {
  color: var(--accent-color);
  background: rgba(78, 151, 209, 0.1);
}

.delete-btn:hover {
  color: #e53935;
  background: rgba(229, 57, 53, 0.1);
}

.folder-chats {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
  overflow-y: auto;
  flex-grow: 1;
  background-color: var(--bg-sidebar);
}

.folder-chats h3 {
  margin: 0 0 12px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.chats-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-item {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  border-radius: 8px;
  background-color: var(--bg-card);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  color: var(--text-primary);
}

.chat-item:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.chat-icon {
  margin-right: 12px;
  color: var(--accent-color);
  padding-top: 2px;
}

.chat-details {
  flex-grow: 1;
}

.chat-title {
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--text-primary);
}

.chat-preview {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chat-date {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.chat-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.chat-item:hover .chat-actions {
  opacity: 1;
}

.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
}

.action-btn:hover {
  color: var(--accent-color);
  background: rgba(78, 151, 209, 0.1);
}

.empty-folder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-tertiary);
  text-align: center;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-input);
  border-radius: 4px;
  font-size: 1rem;
  background-color: var(--bg-input);
  color: var(--text-primary);
}

.warning-text {
  color: #e53935;
  font-size: 0.9rem;
  margin-top: 8px;
}

.cancel-btn,
.primary-btn,
.danger-btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-btn {
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
  border: 1px solid var(--border-light);
}

.cancel-btn:hover {
  background-color: var(--bg-tertiary);
}

.primary-btn {
  background-color: var(--bg-button-primary);
  border: none;
  color: var(--text-button-primary);
}

.primary-btn:hover {
  background-color: var(--accent-hover);
}

.primary-btn:disabled {
  background-color: var(--bg-button-secondary);
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.danger-btn {
  background-color: #e53935;
  border: none;
  color: white;
}

.danger-btn:hover {
  background-color: #c62828;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  background: none;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--text-primary);
}

.menu-item:hover {
  background-color: var(--bg-tertiary);
}

.menu-item i {
  width: 16px;
  color: var(--text-secondary);
}

.text-danger {
  color: #e53935;
}
</style>