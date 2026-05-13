<template>
  <div class="chat-folders-content">
    <div class="search-container">
      <DsInput
        v-model="searchTerm"
        type="text"
        :placeholder="safeT('sidebar.searchConversations', 'Search conversations...')"
      />
      <DsButton variant="primary" @click="handleSearch">
        <SearchIcon :size="16" />
      </DsButton>
    </div>

    <template v-if="shouldShowFoldersSection">
      <div class="folders-header">
        <h3>{{ safeT('sidebar.folders', 'Folders') }}</h3>
        <DsButton variant="ghost" title="Create New Folder" @click.stop="openCreateFolderModal">
          <FolderPlus :size="16" />
        </DsButton>
      </div>

      <div class="folders-list">
        <div
          v-for="folder in nonDefaultFolders"
          :key="folder.id"
          :class="['folder-item', { 'folder-item-active': selectedFolderId === folder.id }]"
          @click="selectFolder(folder.id)"
        >
          <div class="folder-icon">
            <Folder :size="16" />
          </div>
          <div class="folder-details">
            <div class="folder-name">{{ folder.name }}</div>
            <div class="folder-count">
              {{ getChatCount(folder.id) }}
              {{ getChatCount(folder.id) === 1 ? 'chat' : 'chats' }}
            </div>
          </div>
          <div class="folder-actions">
            <DsButton variant="ghost" title="Edit Folder" @click.stop="openEditFolderDialog(folder)">
              <Pencil :size="14" />
            </DsButton>
            <DsButton variant="ghost" title="Delete Folder" @click.stop="openDeleteFolderDialog(folder)">
              <Trash2 :size="14" />
            </DsButton>
          </div>
        </div>
      </div>
    </template>

    <div class="folder-chats">
      <h3>{{ getTabTitle() }}</h3>

      <div v-if="debug" class="debug-info">
        <p>Current tab: {{ activeTab }}</p>
        <p>Conversations: {{ conversations.length }}</p>
        <p>
          First conversation:
          {{ conversations.length > 0 ? conversations[0].title : 'none' }}
        </p>
      </div>

      <div v-if="debug && activeTab === 'starred'" class="debug-info">
        <p>Direct dump of conversations:</p>
        <div v-for="c in conversations" :key="c._key" class="debug-chat">
          {{ c.title }} - Starred: {{ c.isStarred }}
        </div>
      </div>

      <div v-if="debug && activeTab === 'archived'" class="debug-info">
        <p>Direct dump of conversations:</p>
        <div v-for="c in conversations" :key="c._key" class="debug-chat">
          {{ c.title }} - Archived: {{ c.isArchived }}
        </div>
      </div>

      <DsStateDisplay
        v-if="isLoading"
        type="loading"
        :message="safeT('sidebar.loadingChats', 'Loading conversations...')"
      >
        <template #icon>
          <Loader2 :size="24" class="animate-spin" />
        </template>
      </DsStateDisplay>

      <DsStateDisplay v-else-if="errorMessage" type="error" :message="errorMessage">
        <template #icon>
          <AlertCircle :size="24" />
        </template>
        <template #action>
          <DsButton variant="secondary" @click="loadConversationsForCurrentTab">
            {{ safeT('sidebar.retry', 'Retry') }}
          </DsButton>
        </template>
      </DsStateDisplay>

      <DsStateDisplay v-else-if="activeTab === 'folders' && !folderSelected" type="empty">
        <template #icon>
          <FolderOpen :size="48" />
        </template>
        {{ safeT('sidebar.selectFolderInstruction', 'Select a folder to view its conversations') }}
      </DsStateDisplay>

      <div
        v-else-if="(activeTab !== 'folders' || folderSelected) && filteredConversations.length > 0"
        class="chats-list"
      >
        <DsCard
          v-for="conversation in filteredConversations"
          :key="conversation._key"
          variant="default"
          padding="md"
          :hoverable="true"
          class="chat-item"
          @click="openChat(conversation._key)"
        >
          <div class="chat-icon">
            <MessageSquare :size="16" />
          </div>
          <div class="chat-content">
            <div class="chat-header">
              <div class="chat-title">{{ conversation.title }}</div>
              <div class="chat-actions-group">
                <DsButton
                  variant="ghost"
                  :title="conversation.isStarred ? safeT('sidebar.unstar', 'Unstar') : safeT('sidebar.star', 'Star')"
                  @click.stop="toggleStarred(conversation)"
                >
                  <Star :size="16" :fill="conversation.isStarred ? 'currentColor' : 'none'" />
                </DsButton>
                <label class="archive-checkbox">
                  <input
                    type="checkbox"
                    :checked="conversation.isArchived"
                    @change="toggleArchived(conversation, $event)"
                    @click.stop
                  />
                  <span class="archive-label">{{ safeT('sidebar.archive', 'Archive') }}</span>
                </label>
                <DsButton variant="ghost" title="Chat Actions" @click.stop="showChatActionsMenu(conversation, $event)">
                  <MoreVertical :size="16" />
                </DsButton>
              </div>
            </div>
            <div class="chat-message-count">
              {{ conversation.messageCount || 0 }}
              {{
                conversation.messageCount === 1
                  ? safeT('sidebar.message', 'message')
                  : safeT('sidebar.messages', 'messages')
              }}
            </div>
            <div class="chat-preview">{{ conversation.preview }}</div>
            <div class="chat-footer">
              <span v-if="conversation.category" class="chat-category">
                {{ conversation.category }}
              </span>
              <div v-if="conversation.tags && conversation.tags.length > 0" class="chat-tags">
                <span v-for="tag in conversation.tags" :key="tag" class="chat-tag">
                  {{ tag }}
                </span>
              </div>
              <div class="chat-dates">
                <span class="chat-created">
                  {{ safeT('sidebar.created', 'Created') }}:
                  {{ formatDate(conversation.created) }}
                </span>
                <span class="chat-updated">
                  {{ safeT('sidebar.updated', 'Updated') }}:
                  {{ formatDate(conversation.updated) }}
                </span>
              </div>
            </div>
            <div class="status-badges">
              <div v-if="conversation.isStarred" class="starred-badge">★ Starred</div>
              <div v-if="conversation.isArchived" class="archived-badge">📦 Archived</div>
            </div>
          </div>
        </DsCard>
      </div>

      <DsStateDisplay v-else-if="activeTab !== 'folders' || folderSelected" type="empty">
        <template #icon>
          <Star v-if="activeTab === 'starred'" :size="48" />
          <Archive v-else-if="activeTab === 'archived'" :size="48" />
          <MessagesSquare v-else-if="activeTab === 'all'" :size="48" />
          <FolderOpen v-else-if="activeTab === 'folders'" :size="48" />
        </template>
        {{ getEmptyStateMessage() }}
      </DsStateDisplay>
    </div>

    <modal-dialog v-if="showCreateFolderDialog" @close="showCreateFolderDialog = false">
      <template #header>
        <h3>{{ safeT('sidebar.createFolder', 'Create Folder') }}</h3>
      </template>
      <template #body>
        <DsFormGroup :label="safeT('sidebar.folderName', 'Folder Name')" input-id="folderName">
          <DsInput
            id="folderName"
            v-model="newFolderName"
            type="text"
            :placeholder="safeT('sidebar.folderNamePlaceholder', 'Enter folder name')"
            @enter="handleCreateFolder"
          />
        </DsFormGroup>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="showCreateFolderDialog = false">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="primary" :disabled="!newFolderName.trim()" @click="handleCreateFolder">
          {{ safeT('common.create', 'Create') }}
        </DsButton>
      </template>
    </modal-dialog>

    <modal-dialog v-if="showEditFolderDialog" @close="closeEditFolderDialog">
      <template #header>
        <h3>{{ safeT('sidebar.editFolder', 'Edit Folder') }}</h3>
      </template>
      <template #body>
        <DsFormGroup :label="safeT('sidebar.folderName', 'Folder Name')" input-id="editFolderName">
          <DsInput
            id="editFolderName"
            v-model="editingFolderName"
            type="text"
            :placeholder="safeT('sidebar.folderNamePlaceholder', 'Enter folder name')"
            @enter="handleUpdateFolder"
          />
        </DsFormGroup>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="closeEditFolderDialog">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="primary" :disabled="!editingFolderName.trim()" @click="handleUpdateFolder">
          {{ safeT('common.save', 'Save') }}
        </DsButton>
      </template>
    </modal-dialog>

    <modal-dialog v-if="showDeleteFolderDialog" @close="closeDeleteFolderDialog">
      <template #header>
        <h3>{{ safeT('sidebar.deleteFolder', 'Delete Folder') }}</h3>
      </template>
      <template #body>
        <p>
          {{ safeT('sidebar.deleteFolderConfirm', 'Are you sure you want to delete the folder') }}:
          {{ editingFolder ? editingFolder.name : '' }}?
        </p>
        <p class="warning-text">
          {{ safeT('sidebar.chatsMoveWarning', 'All chats in this folder will be moved to the default folder.') }}
        </p>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="closeDeleteFolderDialog">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="danger" @click="handleDeleteFolder">
          {{ safeT('common.delete', 'Delete') }}
        </DsButton>
      </template>
    </modal-dialog>

    <context-menu v-if="showChatMenu" :position="menuPosition" :class="themeClass" @close="showChatMenu = false">
      <DsButton variant="ghost" class="menu-item" @click="promptRenameChat">
        <Pencil :size="16" />
        {{ safeT('sidebar.renameChat', 'Rename Chat') }}
      </DsButton>
      <DsButton variant="ghost" class="menu-item" @click="showMoveChatDialog = true">
        <ArrowLeftRight :size="16" />
        {{ safeT('sidebar.moveChat', 'Move Chat') }}
      </DsButton>
      <DsButton variant="ghost" class="menu-item text-danger" @click="promptDeleteChat">
        <Trash2 :size="16" />
        {{ safeT('sidebar.deleteChat', 'Delete Chat') }}
      </DsButton>
    </context-menu>

    <modal-dialog v-if="showMoveChatDialog" class="move-chat-dialog" @close="showMoveChatDialog = false">
      <template #header>
        <h3>{{ safeT('sidebar.moveChat', 'Move Chat') }}</h3>
      </template>
      <template #body>
        <p>
          {{ safeT('sidebar.moveChatTo', 'Move chat to') }}:
          {{ activeChat ? activeChat.title : '' }}
        </p>
        <DsFormGroup :label="safeT('sidebar.selectFolder', 'Select folder')" input-id="destinationFolder">
          <DsSelect id="destinationFolder" v-model="destinationFolderId">
            <option value="no_folder">
              {{ safeT('sidebar.noFolder', 'No Folder') }}
            </option>
            <option
              v-for="folder in availableFolders"
              :key="folder.id"
              :value="folder.id"
              :disabled="selectedFolderId === folder.id"
            >
              {{ folder.name }}
            </option>
          </DsSelect>
        </DsFormGroup>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="showMoveChatDialog = false">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton
          variant="primary"
          :disabled="
            !destinationFolderId || (destinationFolderId !== 'no_folder' && selectedFolderId === destinationFolderId)
          "
          @click="handleMoveChat"
        >
          {{ safeT('common.move', 'Move') }}
        </DsButton>
      </template>
    </modal-dialog>

    <modal-dialog v-if="showRenameChatDialog" @close="showRenameChatDialog = false">
      <template #header>
        <h3>{{ safeT('sidebar.renameChat', 'Rename Chat') }}</h3>
      </template>
      <template #body>
        <DsFormGroup :label="safeT('sidebar.chatTitle', 'Chat Title')" input-id="chatTitle">
          <DsInput
            id="chatTitle"
            v-model="newChatTitle"
            type="text"
            :placeholder="safeT('sidebar.chatTitlePlaceholder', 'Enter chat title')"
            @enter="handleRenameChat"
          />
        </DsFormGroup>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="showRenameChatDialog = false">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="primary" :disabled="!newChatTitle.trim()" @click="handleRenameChat">
          {{ safeT('common.save', 'Save') }}
        </DsButton>
      </template>
    </modal-dialog>

    <modal-dialog v-if="showDeleteChatDialog" @close="showDeleteChatDialog = false">
      <template #header>
        <h3>{{ safeT('sidebar.deleteChat', 'Delete Chat') }}</h3>
      </template>
      <template #body>
        <p>
          {{ safeT('sidebar.deleteChatConfirm', 'Are you sure you want to delete the chat') }}:
          {{ activeChat ? activeChat.title : '' }}?
        </p>
        <p class="warning-text">
          {{ safeT('sidebar.deleteChatWarning', 'This action cannot be undone.') }}
        </p>
      </template>
      <template #footer>
        <DsButton variant="secondary" @click="showDeleteChatDialog = false">
          {{ safeT('common.cancel', 'Cancel') }}
        </DsButton>
        <DsButton variant="danger" @click="handleDeleteChat">
          {{ safeT('common.delete', 'Delete') }}
        </DsButton>
      </template>
    </modal-dialog>
  </div>
</template>

<script>
import { mapGetters, mapActions } from 'vuex';
import ModalDialog from './ModalDialog.vue';
import ContextMenu from './ContextMenu.vue';
import DsButton from './ds/Button.vue';
import DsFormGroup from './ds/FormGroup.vue';
import DsInput from './ds/Input.vue';
import DsCard from './ds/Card.vue';
import DsStateDisplay from './ds/StateDisplay.vue';
import DsSelect from './ds/Select.vue';
import chatHistoryService from '@/services/chatHistoryService';
import notificationService from '@/services/notificationService';
import { eventBus } from '../eventBus.js';
import { getUserId } from '@/utils/userUtils';
import {
  Search as SearchIcon,
  FolderPlus,
  Folder,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  FolderOpen,
  MessageSquare,
  Star,
  MoreVertical,
  Archive,
  MessagesSquare,
  ArrowLeftRight
} from 'lucide-vue-next';

export default {
  name: 'ChatFolders',

  components: {
    ModalDialog,
    ContextMenu,
    DsButton,
    DsFormGroup,
    DsInput,
    DsCard,
    DsStateDisplay,
    DsSelect,
    SearchIcon,
    FolderPlus,
    Folder,
    Pencil,
    Trash2,
    Loader2,
    AlertCircle,
    FolderOpen,
    MessageSquare,
    Star,
    MoreVertical,
    Archive,
    MessagesSquare,
    ArrowLeftRight
  },
  props: {
    activeTab: {
      type: String,
      default: 'all'
    }
  },
  emits: ['locale-changed'],
  data() {
    return {
      selectedFolderId: 'default',
      folderSelected: false,
      conversations: [],
      isLoading: false,
      errorMessage: null,
      searchTerm: '',
      showCreateFolderDialog: false,
      newFolderName: '',
      editingFolder: null,
      editingFolderName: '',
      showEditFolderDialog: false,
      showDeleteFolderDialog: false,
      activeChat: null,
      showChatMenu: false,
      menuPosition: { x: 0, y: 0 },
      showMoveChatDialog: false,
      destinationFolderId: null,
      showRenameChatDialog: false,
      newChatTitle: '',
      showDeleteChatDialog: false,
      currentUser: null,
      categories: {},
      folderCounts: {},
      debug: false,
      forceUpdateKey: 0
    };
  },

  computed: {
    ...mapGetters('chatHistory', ['getAllFolders', 'getFolderById', 'getChatById']),
    themeClass() {
      const theme = this.$route.meta.theme || 'light';
      return theme === 'dark' ? 'context-menu-dark' : 'context-menu-light';
    },
    folders() {
      return this.getAllFolders;
    },

    nonDefaultFolders() {
      return this.folders.filter((folder) => !folder.isDefault);
    },

    shouldShowFoldersSection() {
      return this.activeTab === 'folders';
    },

    selectedFolder() {
      return this.getFolderById(this.selectedFolderId);
    },

    folderChats() {
      return this.conversations;
    },

    availableFolders() {
      return this.folders.filter((folder) => !folder.isDefault);
    },

    filteredConversations() {
      try {
        let filteredChats = [...this.conversations];
        if (this.activeTab === 'starred') {
          filteredChats = filteredChats.filter((conv) => conv.isStarred === true);
        } else if (this.activeTab === 'archived') {
          filteredChats = filteredChats.filter((conv) => conv.isArchived === true);
        } else if (this.activeTab === 'folders') {
          // Exclude archived conversations in folders tab
          filteredChats = filteredChats.filter((conv) => conv.isArchived !== true);
        }
        if (this.searchTerm && this.searchTerm.trim() !== '') {
          const searchTermLower = this.searchTerm.trim().toLowerCase();
          filteredChats = filteredChats.filter((conv) => {
            const matches =
              (conv.title && conv.title.toLowerCase().includes(searchTermLower)) ||
              (conv.preview && conv.preview.toLowerCase().includes(searchTermLower)) ||
              (conv.category && conv.category.toLowerCase().includes(searchTermLower));
            return matches;
          });
        }
        const sortedChats = filteredChats.sort((a, b) => {
          const dateA = a.updated ? new Date(a.updated) : new Date(0);
          const dateB = b.updated ? new Date(b.updated) : new Date(0);
          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            return 0;
          }
          return dateB - dateA;
        });
        return sortedChats;
      } catch {
        return this.conversations;
      }
    }
  },

  watch: {
    // Watch the prop to trigger conversation loading
    activeTab: {
      immediate: true,
      handler(newTab) {
        this.resetComponentState();
        if (newTab === 'folders') {
          this.handleFoldersTabActivation();
        } else {
          this.loadConversationsForCurrentTab();
        }
      }
    },
    selectedFolderId(newFolderId) {
      if (newFolderId && this.activeTab === 'folders' && newFolderId !== 'default') {
        this.fetchFolderChats(newFolderId);
      }
    },
    // Keep local currentUser in sync with the Vuex store
    '$store.getters.currentUser': {
      handler(user) {
        if (user && user !== this.currentUser) {
          this.currentUser = user;
          if (getUserId(user)) {
            this.loadConversationsForCurrentTab();
            this.loadFoldersFromBackend();
          }
        }
      },
      immediate: true
    }
  },

  created() {
    this.loadCurrentUser();
    // Watch for locale changes to notify parent for tab title updates
    if (this.$i18n) {
      this.$watch(
        () => this.$i18n.locale,
        (newLocale) => {
          this.currentLocale = newLocale;
          this.forceUpdateKey++; // Track locale change
          this.$emit('locale-changed', newLocale); // Notify parent to re-render tabs
        }
      );
    }
    // Listen for new conversation saved event
    eventBus.$on('conversation-saved', this.handleConversationSaved);
  },

  mounted() {},

  beforeUnmount() {
    eventBus.$off('conversation-saved', this.handleConversationSaved);
  },

  methods: {
    ...mapActions('chatHistory', [
      'createFolder',
      'updateFolder',
      'deleteFolder',
      'updateChat',
      'deleteChat',
      'moveChat'
    ]),

    closeEditFolderDialog() {
      this.editingFolder = null;
      this.showEditFolderDialog = false;
    },
    closeDeleteFolderDialog() {
      this.editingFolder = null;
      this.showDeleteFolderDialog = false;
    },

    handleConversationSaved(conversationId) {
      // Refresh only if the current tab is 'all' or 'folders'
      if (this.activeTab === 'all' || this.activeTab === 'folders') {
        this.loadConversationsForCurrentTab();
        // If in folders tab and the conversation belongs to the selected folder, add it immediately
        if (this.activeTab === 'folders' && this.selectedFolderId) {
          // Check if the conversation is in the selected folder's folderChats
          const folderChats = this.$store.state.chatHistory.folderChats[this.selectedFolderId] || [];
          if (folderChats.includes(conversationId)) {
            // Retry fetching chat with $nextTick to account for Vuex reactivity
            this.$nextTick(() => {
              const chat = this.getChatById(conversationId);
              if (chat && !this.conversations.find((c) => c._key === conversationId)) {
                // Create conversation object matching backend structure
                const newConversation = {
                  _key: chat.id,
                  title: chat.title,
                  preview: chat.preview,
                  created: chat.createdAt,
                  updated: chat.updatedAt,
                  messageCount: chat.messageCount || 0,
                  isStarred: false,
                  isArchived: false,
                  category: null,
                  tags: [] // Assume no tags for new conversation
                };
                this.conversations = [...this.conversations, newConversation];
                this.folderCounts[this.selectedFolderId] = (this.folderCounts[this.selectedFolderId] || 0) + 1;
              }
            });
          }
        }
      }
    },

    resetComponentState() {
      this.conversations = [];
      this.folderSelected = false;
      this.searchTerm = '';
      this.isLoading = false;
      this.errorMessage = null;
    },

    safeT(key, fallback) {
      if (typeof this.$t === 'function') {
        return this.$t(key);
      }
      return fallback;
    },

    openCreateFolderModal() {
      this.newFolderName = '';
      setTimeout(() => {
        this.showCreateFolderDialog = true;
      }, 0);
    },

    closeCreateFolderDialog() {
      this.showCreateFolderDialog = false;
    },

    handleFoldersTabActivation() {
      this.folderSelected = false;
      this.conversations = [];
      this.loadFoldersFromBackend();
    },

    loadCurrentUser() {
      const user = this.$store.getters.currentUser;
      if (user && getUserId(user)) {
        this.currentUser = user;
        this.loadConversationsForCurrentTab();
        this.loadFoldersFromBackend();
      }
      // If no user yet, the '$store.getters.currentUser' watcher (immediate: true)
      // will retry once the OIDC callback populates the store.
    },

    forceDisplayConversations() {
      this.conversations = [...this.conversations];
    },

    async loadConversations() {
      this.isLoading = true;
      this.errorMessage = null;
      try {
        if (!this.currentUser || !getUserId(this.currentUser)) {
          this.isLoading = false;
          return;
        }
        const options = { limit: 100, offset: 0 };
        if (this.activeTab === 'all') {
          options.includeArchived = false;
        }
        const response = await chatHistoryService.getUserConversations(options);
        this.conversations = (response.conversations || []).map((conv) => {
          return {
            ...conv,
            isStarred: conv.isStarred === true,
            isArchived: conv.isArchived === true,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0
          };
        });
        if (Object.keys(this.categories).length === 0) {
          this.loadCategories();
        }
      } catch {
        this.errorMessage = this.safeT(
          'sidebar.errorLoadingConversations',
          'Failed to load conversations. Please try again.'
        );
      } finally {
        this.isLoading = false;
      }
    },

    loadConversationsForCurrentTab() {
      if (this.activeTab === 'folders') {
        if (this.folderSelected && this.selectedFolderId) {
          this.fetchFolderChats(this.selectedFolderId);
        } else {
          this.conversations = [];
          this.isLoading = false;
        }
        return;
      }

      if (this.activeTab === 'starred') {
        this.loadSpecificTabConversations('starred');
      } else if (this.activeTab === 'archived') {
        this.loadSpecificTabConversations('archived');
      } else {
        this.loadConversations();
      }
    },

    async loadSpecificTabConversations(tabType) {
      this.isLoading = true;
      this.errorMessage = null;
      this.conversations = [];
      try {
        if (!this.currentUser || !getUserId(this.currentUser)) {
          this.errorMessage = 'User data is missing';
          this.isLoading = false;
          return;
        }
        const options = { limit: 100, offset: 0 };
        if (tabType === 'archived') {
          options.includeArchived = true;
        }
        const response = await chatHistoryService.getUserConversations(options);
        this.conversations = (response.conversations || []).map((conv) => {
          return {
            ...conv,
            isStarred: conv.isStarred === true,
            isArchived: conv.isArchived === true,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0
          };
        });
        this.forceDisplayConversations();
        if (Object.keys(this.categories).length === 0) {
          this.loadCategories();
        }
      } catch (error) {
        this.errorMessage = `Failed to load conversations: ${error.message || 'Unknown error'}`;
      } finally {
        this.isLoading = false;
      }
    },

    generatePreview(conversation) {
      if (conversation.lastMessage) {
        return conversation.lastMessage.length > 100
          ? conversation.lastMessage.substring(0, 97) + '...'
          : conversation.lastMessage;
      }

      if (conversation.lastMessagePreview && conversation.lastMessagePreview.content) {
        return conversation.lastMessagePreview.content.length > 100
          ? conversation.lastMessagePreview.content.substring(0, 97) + '...'
          : conversation.lastMessagePreview.content;
      }

      return this.safeT('sidebar.noPreview', 'No preview available');
    },

    async loadCategories() {
      this.categories = {
        general: 'General',
        work: 'Work',
        personal: 'Personal'
      };
    },

    getCategoryName(categoryId) {
      if (!categoryId) return '';
      return this.categories[categoryId] || categoryId;
    },

    async toggleStarred(conversation) {
      try {
        const newStatus = !conversation.isStarred;
        if (!this.currentUser || !getUserId(this.currentUser)) {
          notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
          return;
        }
        conversation.isStarred = newStatus;
        await chatHistoryService.updateConversation(conversation._key, {
          isStarred: newStatus
        });
        if (this.activeTab === 'starred' && !newStatus) {
          this.conversations = this.conversations.filter((conv) => conv._key !== conversation._key);
          this.forceDisplayConversations();
          if (this.selectedFolderId) {
            this.folderCounts[this.selectedFolderId] = this.conversations.length;
          }
        }
        if (newStatus) {
          notificationService.success(this.safeT('sidebar.chatStarred', 'Conversation has been starred'));
        } else {
          notificationService.info(this.safeT('sidebar.chatUnstarred', 'Conversation has been unstarred'));
        }
      } catch {
        conversation.isStarred = !conversation.isStarred;
        notificationService.error(this.safeT('sidebar.errorUpdatingChat', 'Failed to update conversation'));
      }
    },

    async toggleArchived(conversation, event) {
      try {
        const newStatus = event.target.checked;
        if (!this.currentUser || !getUserId(this.currentUser)) {
          notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
          return;
        }
        conversation.isArchived = newStatus;
        await chatHistoryService.updateConversation(conversation._key, {
          isArchived: newStatus
        });
        if (this.activeTab !== 'archived' && newStatus) {
          this.conversations = this.conversations.filter((conv) => conv._key !== conversation._key);
          this.forceDisplayConversations();
          if (this.selectedFolderId) {
            this.folderCounts[this.selectedFolderId] = this.conversations.length;
          }
        }
        if (this.activeTab === 'archived' && !newStatus) {
          this.conversations = this.conversations.filter((conv) => conv._key !== conversation._key);
          this.forceDisplayConversations();
          if (this.selectedFolderId) {
            this.folderCounts[this.selectedFolderId] = this.conversations.length;
          }
        }
        if (newStatus) {
          notificationService.success(this.safeT('sidebar.chatArchived', 'Conversation has been archived'));
        } else {
          notificationService.info(this.safeT('sidebar.chatUnarchived', 'Conversation has been unarchived'));
        }
      } catch {
        conversation.isArchived = !conversation.isArchived;
        notificationService.error(this.safeT('sidebar.errorUpdatingChat', 'Failed to update conversation'));
      }
    },

    handleSearch() {
      // Search is handled reactively by filteredConversations computed.
      // This method exists for the search button click — no-op since filtering is instant.
    },

    getTabTitle() {
      switch (this.activeTab) {
        case 'all':
          return this.safeT('sidebar.allChats', 'All Chats');
        case 'folders':
          return this.folderSelected && this.selectedFolder
            ? this.selectedFolder.name
            : this.safeT('sidebar.tab.folders', 'Folders');
        case 'starred':
          return this.safeT('sidebar.tab.starred', 'Starred');
        case 'archived':
          return this.safeT('sidebar.tab.archived', 'Archived');
        default:
          return this.safeT('sidebar.chats', 'Chats');
      }
    },

    getEmptyStateMessage() {
      if (this.searchTerm) {
        return this.safeT('sidebar.noSearchResults', `No conversations found for "${this.searchTerm}"`);
      }
      if (this.activeTab === 'all') {
        return this.safeT('sidebar.noChats', 'No conversations found. Start a new conversation!');
      } else if (this.activeTab === 'starred') {
        return this.safeT(
          'sidebar.noStarredChats',
          'No starred conversations yet. Star a conversation to add it here.'
        );
      } else if (this.activeTab === 'archived') {
        return this.safeT('sidebar.noArchivedChats', 'No archived conversations yet.');
      } else if (this.activeTab === 'folders') {
        return this.folderSelected
          ? this.safeT('sidebar.emptyFolder', 'This folder is empty. Move conversations here from the chat menu.')
          : this.safeT('sidebar.selectFolderInstruction', 'Select a folder to view its conversations');
      }
      return this.safeT('sidebar.noChats', 'No conversations found.');
    },

    selectFirstCustomFolder() {
      if (!this.nonDefaultFolders || this.nonDefaultFolders.length === 0) {
        return;
      }
      const customFolders = this.nonDefaultFolders;
      if (customFolders.length > 0) {
        const firstFolder = customFolders[0];
        this.selectFolder(firstFolder.id);
      }
    },

    async selectFolder(folderId) {
      this.selectedFolderId = folderId;
      this.folderSelected = true;
      await this.fetchFolderChats(folderId, true);
    },

    getChatCount(folderId) {
      return this.folderCounts[folderId] || 0;
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

    async handleCreateFolder() {
      if (!this.newFolderName.trim()) {
        return;
      }
      try {
        if (!this.currentUser || !getUserId(this.currentUser)) {
          notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
          return;
        }
        const folderData = {
          name: this.newFolderName.trim()
        };
        const result = await chatHistoryService.createFolder(folderData);
        this.folderCounts[result._key] = 0;
        notificationService.success(this.safeT('sidebar.folderCreated', 'Folder created successfully'));
        this.showCreateFolderDialog = false;
        this.loadFoldersFromBackend();
      } catch {
        notificationService.error(this.safeT('sidebar.errorCreatingFolder', 'Failed to create folder'));
      }
    },

    async loadFoldersFromBackend() {
      try {
        if (!this.currentUser || !getUserId(this.currentUser)) {
          this.errorMessage = this.safeT('sidebar.errorNoUser', 'User data is missing');
          return [];
        }
        const response = await chatHistoryService.getUserFolders();
        const foldersArray = Array.isArray(response) ? response : response?.folders || [];
        const processedFolders = foldersArray
          .filter((folder) => folder && (folder._key || folder.id))
          .map((folder) => ({
            id: folder._key || folder.id,
            name: folder.name || 'Unnamed Folder',
            description: folder.description || '',
            isDefault: folder.isDefault || false
          }));
        foldersArray.forEach((folder) => {
          this.folderCounts[folder._key] = 0;
        });
        const defaultFolder = {
          id: 'default',
          name: 'All Chats',
          isDefault: true,
          createdAt: new Date().toISOString()
        };
        this.folderCounts[defaultFolder.id] = 0;
        const allFolders = [defaultFolder, ...processedFolders];
        await this.$store.dispatch('chatHistory/setFolders', allFolders);
        if (this.activeTab === 'folders') {
          for (const folder of processedFolders) {
            await this.fetchFolderChats(folder.id, false);
          }
        }
        if (this.activeTab === 'folders') {
          this.selectFirstCustomFolder();
        }
        return processedFolders;
      } catch {
        this.errorMessage = this.safeT('sidebar.errorLoadingFolders', 'Failed to load folders');
        notificationService.error(this.errorMessage);
        return [];
      }
    },

    async handleUpdateFolder() {
      if (!this.editingFolder || !this.editingFolderName.trim()) {
        return;
      }
      try {
        await chatHistoryService.updateFolder(this.editingFolder.id, {
          name: this.editingFolderName.trim()
        });
        await this.loadFoldersFromBackend();
        notificationService.success(this.safeT('sidebar.folderUpdated', 'Folder updated successfully'));
        this.editingFolder = null;
        this.editingFolderName = '';
        this.showEditFolderDialog = false;
      } catch {
        notificationService.error(this.safeT('sidebar.errorUpdatingFolder', 'Failed to update folder'));
      }
    },

    async handleDeleteFolder() {
      if (!this.editingFolder) {
        return;
      }
      try {
        this.isLoading = true;
        if (!this.currentUser || !getUserId(this.currentUser)) {
          notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
          return;
        }
        await chatHistoryService.deleteFolder(this.editingFolder.id, false);
        await this.loadFoldersFromBackend();
        if (this.selectedFolderId === this.editingFolder.id) {
          this.selectedFolderId = 'default';
          this.folderSelected = false;
          this.conversations = [];
        }
        notificationService.success(this.safeT('sidebar.folderDeleted', 'Folder deleted successfully'));
        this.editingFolder = null;
        this.showDeleteFolderDialog = false;
      } catch {
        notificationService.error(this.safeT('sidebar.errorDeletingFolder', 'Failed to delete folder'));
      } finally {
        this.isLoading = false;
      }
    },

    openChat(chatId) {
      eventBus.$emit('load-conversation', chatId);
    },

    showChatActionsMenu(chat, event) {
      this.activeChat = chat;
      if (this.activeTab !== 'folders') {
        const folderChats = this.$store.state.chatHistory.folderChats;
        let foundFolderId = null;
        for (const folderId in folderChats) {
          if (folderId !== 'default' && folderChats[folderId] && folderChats[folderId].includes(chat._key)) {
            foundFolderId = folderId;
            break;
          }
        }
        if (foundFolderId) {
          this.selectedFolderId = foundFolderId;
          this.folderSelected = true;
        } else {
          this.selectedFolderId = 'default';
          this.folderSelected = false;
        }
      }
      const rect = event.target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const menuWidth = 180;
      this.menuPosition = {
        x: Math.max(10, rect.left - menuWidth + 20),
        y: rect.bottom + 5
      };
      this.showChatMenu = true;
      setTimeout(() => {
        const menu = document.querySelector('.context-menu');
        if (menu) {
          const menuRect = menu.getBoundingClientRect();
          if (menuRect.right > viewportWidth - 10) {
            this.menuPosition.x = viewportWidth - menuWidth - 10;
          }
          const viewportHeight = window.innerHeight;
          if (menuRect.bottom > viewportHeight - 10) {
            this.menuPosition.y = rect.top - menuRect.height - 5;
          }
        }
      }, 0);
    },

    promptRenameChat() {
      if (this.activeChat) {
        this.newChatTitle = this.activeChat.title;
        this.showRenameChatDialog = true;
        this.showChatMenu = false;
      }
    },

    async handleRenameChat() {
      if (!this.activeChat || !this.newChatTitle.trim()) {
        return;
      }
      const originalTitle = this.activeChat.title;
      try {
        this.activeChat.title = this.newChatTitle.trim();
        await chatHistoryService.updateConversation(this.activeChat._key, {
          title: this.newChatTitle.trim()
        });
        this.updateChat({
          chatId: this.activeChat._key,
          title: this.newChatTitle.trim()
        });
        this.showRenameChatDialog = false;
        this.showChatMenu = false;
        notificationService.success(this.safeT('sidebar.chatRenamed', 'Conversation renamed successfully'));
      } catch {
        this.activeChat.title = originalTitle;
        notificationService.error(this.safeT('sidebar.errorRenamingChat', 'Failed to rename conversation'));
      }
    },

    promptDeleteChat() {
      if (this.activeChat) {
        this.showDeleteChatDialog = true;
        this.showChatMenu = false;
      }
    },

    async handleDeleteChat() {
      if (!this.activeChat) {
        return;
      }
      if (!this.currentUser || !getUserId(this.currentUser)) {
        notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
        return;
      }
      try {
        await chatHistoryService.deleteConversation(this.activeChat._key);
        this.conversations = this.conversations.filter((c) => c._key !== this.activeChat._key);
        this.deleteChat(this.activeChat._key);
        if (this.selectedFolderId && this.folderCounts[this.selectedFolderId] !== undefined) {
          this.folderCounts[this.selectedFolderId] = this.conversations.length;
        }
        this.showDeleteChatDialog = false;
        eventBus.$emit('chat-deleted', this.activeChat._key);
        this.activeChat = null;
        this.showChatMenu = false;
        notificationService.success(this.safeT('sidebar.chatDeleted', 'Conversation deleted successfully'));
        this.loadConversationsForCurrentTab();
      } catch {
        notificationService.error(this.safeT('sidebar.errorDeletingChat', 'Failed to delete conversation'));
      }
    },

    async handleMoveChat() {
      if (!this.activeChat || !this.destinationFolderId) {
        return;
      }
      if (!this.currentUser || !getUserId(this.currentUser)) {
        notificationService.error(this.safeT('sidebar.errorNoUser', 'User data is missing'));
        return;
      }
      const isRemovingFromFolder = this.destinationFolderId === 'no_folder';
      try {
        if (isRemovingFromFolder) {
          await chatHistoryService.removeConversationFromFolder(this.activeChat._key, this.selectedFolderId);
          if (this.$store.state.chatHistory.folderChats[this.selectedFolderId]) {
            await this.$store.dispatch('chatHistory/removeChatFromFolder', {
              chatId: this.activeChat._key,
              folderId: this.selectedFolderId
            });
          }
          const sourceCount = (this.folderCounts[this.selectedFolderId] || 1) - 1;
          this.folderCounts[this.selectedFolderId] = Math.max(0, sourceCount);
          this.selectedFolderId = 'default';
          this.folderSelected = false;
        } else {
          await chatHistoryService.moveConversation(
            this.activeChat._key,
            this.selectedFolderId,
            this.destinationFolderId
          );
          await this.moveChat({
            chatId: this.activeChat._key,
            fromFolderId: this.selectedFolderId,
            toFolderId: this.destinationFolderId
          });
          const sourceCount = (this.folderCounts[this.selectedFolderId] || 1) - 1;
          const destCount = (this.folderCounts[this.destinationFolderId] || 0) + 1;
          this.folderCounts[this.selectedFolderId] = Math.max(0, sourceCount);
          this.folderCounts[this.destinationFolderId] = destCount;
          if (sourceCount <= 0 && this.selectedFolderId !== 'default') {
            this.selectedFolderId = this.nonDefaultFolders.length > 0 ? this.nonDefaultFolders[0].id : 'default';
            this.folderSelected = this.selectedFolderId !== 'default';
          } else {
            this.selectedFolderId = this.destinationFolderId;
            this.folderSelected = true;
          }
        }
        if (!this.$store.state.chatHistory.folderChats.default.includes(this.activeChat._key)) {
          await this.$store.dispatch('chatHistory/addChatToFolder', {
            chatId: this.activeChat._key,
            folderId: 'default'
          });
        }
        this.showMoveChatDialog = false;
        this.destinationFolderId = null;
        this.showChatMenu = false;
        notificationService.success(
          isRemovingFromFolder
            ? this.safeT('sidebar.chatRemovedFromFolders', 'Conversation removed from folder')
            : this.safeT('sidebar.chatMoved', 'Conversation moved successfully')
        );
        this.loadConversationsForCurrentTab();
        if (this.activeTab === 'folders') {
          if (isRemovingFromFolder || this.selectedFolderId === 'default') {
            if (this.selectedFolderId !== 'default') {
              await this.fetchFolderChats(this.selectedFolderId);
            } else {
              this.conversations = [];
              this.forceDisplayConversations();
            }
          } else {
            await this.selectFolder(this.selectedFolderId);
          }
        }
      } catch {
        notificationService.error(
          isRemovingFromFolder
            ? this.safeT('sidebar.errorRemovingChat', 'Failed to remove conversation from folder')
            : this.safeT('sidebar.errorMovingChat', 'Failed to move conversation')
        );
      }
    },

    formatDate(dateStr) {
      if (!dateStr) return '';
      let date;
      try {
        date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return dateStr;
        }
      } catch {
        return dateStr;
      }
      const today = new Date();
      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      if (date.getFullYear() === today.getFullYear()) {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        });
      }
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },

    async fetchFolderChats(folderId, isSelected = false) {
      try {
        this.isLoading = true;
        this.errorMessage = null;
        if (isSelected) {
          this.conversations = [];
        }
        if (!this.currentUser || !getUserId(this.currentUser)) {
          this.errorMessage = 'User data is missing';
          return;
        }
        const folderData = await chatHistoryService.getFolder(folderId, {
          params: { limit: 100, offset: 0 }
        });
        if (folderData && folderData.conversations) {
          const convs = folderData.conversations.map((conv) => ({
            ...conv,
            isStarred: conv.isStarred === true,
            isArchived: conv.isArchived === true,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0
          }));
          const nonArchivedConvs = convs.filter((conv) => conv.isArchived !== true);
          if (isSelected) {
            this.conversations = convs;
            this.forceDisplayConversations();
          }
          this.folderCounts[folderId] = nonArchivedConvs.length;
          await this.$store.dispatch('chatHistory/setFolderChats', {
            folderId,
            chats: convs.map((conv) => conv._key)
          });
        } else {
          this.folderCounts[folderId] = 0;
        }
      } catch (error) {
        this.errorMessage =
          this.safeT('sidebar.errorLoadingFolder', 'Failed to load folder: ') + (error.message || 'Unknown error');
        notificationService.error(this.errorMessage);
      } finally {
        this.isLoading = false;
      }
    }
  }
};
</script>

<style scoped>
.chat-folders-content {
  flex-grow: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.search-container {
  display: flex;
  margin-bottom: var(--space-md);
  padding: var(--space-xs);
  width: 100%;
}

.chat-folders {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-sidebar);
  color: var(--fg);
}

.folders-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-md);
  border-bottom: 1px solid var(--border);
}

.folders-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.add-folder-btn {
}

.folders-list {
  overflow-y: auto;
  flex-shrink: 0;
  padding: var(--space-sm) 0;
}

.folder-item {
  display: flex;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--fg);
}

.folder-item:hover {
  background-color: var(--bg);
}

.folder-item-active {
  background-color: var(--accent-muted);
}

.folder-icon {
  margin-right: var(--space-md);
  color: var(--accent);
}

.folder-details {
  flex-grow: 1;
}

.folder-name {
  font-weight: 500;
  color: var(--fg);
}

.folder-count {
  font-size: var(--text-base);
  color: var(--muted);
}

.folder-actions {
  display: flex;
  gap: var(--space-sm);
  opacity: 0;
  transition: opacity 0.2s;
}

.folder-item:hover .folder-actions {
  opacity: 1;
}

.folder-chats {
  padding: var(--space-md) var(--space-md);
  border-top: 1px solid var(--border-light);
  overflow-y: auto;
  flex-grow: 1;
  background-color: var(--bg-sidebar);
}

.folder-chats h3 {
  margin: 0 0 var(--space-md) 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--fg);
}

.chats-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.chat-item {
  display: flex;
  position: relative;
  width: calc(100% - 10px);
  max-width: 412px;
  margin-bottom: var(--space-sm);
}

.chat-icon {
  margin-right: var(--space-md);
  color: var(--accent);
  padding-top: 2px;
  flex-shrink: 0;
}

.chat-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-sm);
}

.chat-title {
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 100px);
  font-size: var(--text-lg);
  cursor: pointer;
}

.chat-title:hover {
  text-decoration: underline;
  color: var(--accent);
}

.chat-actions-group {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
}

.chat-message-count {
  font-size: var(--text-base);
  color: var(--muted-soft);
  margin-bottom: var(--space-xs);
}

.chat-preview {
  font-size: var(--text-base);
  color: var(--muted);
  margin-bottom: var(--space-sm);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.chat-footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
}

.chat-category {
  display: inline-block;
  padding: 2px var(--space-sm);
  background-color: var(--accent-muted);
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: var(--text-base);
  max-width: fit-content;
  margin-bottom: var(--space-xs);
}

.chat-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.chat-tag {
  display: inline-block;
  padding: 2px var(--space-sm);
  background-color: var(--accent-muted);
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: var(--text-base);
  color: var(--fg);
}

.chat-dates {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--muted-soft);
}

.archive-checkbox {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: var(--text-sm);
  color: var(--muted-soft);
  cursor: pointer;
}

.archive-checkbox input {
  margin-bottom: 2px;
}

.archive-label {
  font-size: var(--text-xs);
  text-align: center;
}

.empty-folder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-xl) var(--space-md);
  color: var(--muted-soft);
  text-align: center;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.warning-text {
  color: var(--danger);
  font-size: var(--text-base);
  margin-top: var(--space-sm);
}

/* Context menu base styles */
.context-menu {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}

/* Explicit light mode class */
.context-menu-light {
  background-color: var(--surface);
  border: 1px solid var(--border);
}

/* Explicit dark mode class */
.context-menu-dark {
  background-color: var(--surface);
  border: 1px solid var(--border);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  text-align: left;
}

.menu-item i,
.menu-item svg {
  width: 16px;
  color: var(--muted); /* Lighter icons in light mode */
}

/* Red text for delete option */
.text-danger {
  color: var(--danger);
}

/* Light mode specific menu item styles */
.context-menu-light .menu-item {
  color: var(--fg);
}

.context-menu-light .menu-item:hover {
  background-color: var(--bg);
}

.context-menu-light .menu-item i,
.context-menu-light .menu-item svg {
  color: var(--muted);
}

/* Dark mode specific menu item styles */
.context-menu-dark .menu-item {
  color: var(--fg);
}

.context-menu-dark .menu-item:hover {
  background-color: var(--bg);
}

.context-menu-dark .menu-item i,
.context-menu-dark .menu-item svg {
  color: var(--muted);
}

/* Debug information styling */
.debug-info {
  background-color: var(--bg);
  padding: var(--space-sm);
  margin-bottom: var(--space-md);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--fg);
}

[data-theme='dark'] .debug-info {
  background-color: var(--muted-soft);
  color: var(--border-light);
}

.debug-info p {
  margin: 0;
  line-height: 1.5;
}

.debug-chat {
  padding: var(--space-xs);
  margin: var(--space-xs) 0;
  border-bottom: 1px solid var(--border-light);
}

[data-theme='dark'] .debug-chat {
  border-color: var(--fg);
}

/* Star and archive badges */
.starred-badge,
.archived-badge {
  display: inline-block;
  margin-top: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 600;
}

.starred-badge {
  background-color: var(--warning-bg);
  color: var(--warning);
}

.archived-badge {
  background-color: var(--info-bg);
  color: var(--muted);
}

/* Star button with outline when not starred */
.star-btn {
}

.star-btn svg {
  color: var(--warning);
}

.star-btn svg[fill='none'] {
  color: var(--muted-soft);
}

.move-chat-dialog {
  z-index: 10000;
}
</style>
