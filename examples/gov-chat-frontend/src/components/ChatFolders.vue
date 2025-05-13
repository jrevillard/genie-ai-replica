<!-- Modified version with chat history service integration -->
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

    <!-- Chats in Selected Folder or Tab -->
    <div class="folder-chats">
      <!-- Note: Using existing search field in the UI, not adding a new one -->
      
      <h3>{{ getTabTitle() }}</h3>

      <!-- Loading state -->
      <div class="loading-state" v-if="isLoading">
        <i class="fas fa-spinner fa-spin"></i>
        <p>{{ $t('sidebar.loadingChats') }}</p>
      </div>

      <!-- Error state -->
      <div class="error-state" v-else-if="errorMessage">
        <i class="fas fa-exclamation-circle"></i>
        <p>{{ errorMessage }}</p>
        <button @click="loadConversations" class="retry-btn">{{ $t('sidebar.retry') }}</button>
      </div>

      <div class="chats-list" v-else-if="filteredConversations.length > 0">
        <div v-for="conversation in filteredConversations" :key="conversation._key" class="chat-item" @click="openChat(conversation._key)">
          <div class="chat-icon">
            <i class="fas fa-comment"></i>
          </div>
          <div class="chat-details">
            <div class="chat-title">{{ conversation.title }}</div>
            <div class="chat-meta">
              <span class="chat-category" v-if="conversation.category">{{ conversation.category }}</span>
              <span class="chat-message-count">{{ conversation.messageCount || 0 }} {{ (conversation.messageCount === 1) ? $t('sidebar.message') : $t('sidebar.messages') }}</span>
            </div>
            <div class="chat-preview">{{ conversation.preview }}</div>
            <div class="chat-dates">
              <span class="chat-created">{{ $t('sidebar.created') }}: {{ formatDate(conversation.created) }}</span>
              <span class="chat-updated">{{ $t('sidebar.updated') }}: {{ formatDate(conversation.updated) }}</span>
            </div>
          </div>
          <div class="chat-status">
            <button @click.stop="toggleStarred(conversation)" class="star-btn" :title="conversation.isStarred ? $t('sidebar.unstar') : $t('sidebar.star')">
              <i :class="['fas', conversation.isStarred ? 'fa-star' : 'fa-star-o']"></i>
            </button>
            <label class="archive-checkbox">
              <input type="checkbox" :checked="conversation.isArchived" @change="toggleArchived(conversation, $event)" @click.stop>
              <span class="archive-label">{{ $t('sidebar.archive') }}</span>
            </label>
          </div>
          <div class="chat-actions">
            <button @click.stop="showChatActionsMenu(conversation, $event)" class="action-btn" title="Chat Actions">
              <i class="fas fa-ellipsis-v"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="empty-state" v-else>
        <p>{{ getEmptyStateMessage() }}</p>
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
import chatHistoryService from '@/services/chatHistoryService';
import userService from '@/services/userService';
import notificationService from '@/services/notificationService';

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
      
      // Conversation data
      conversations: [],
      isLoading: false,
      errorMessage: null,
      searchTerm: '',
      searchDebounceTimeout: null,
      
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
      showDeleteChatDialog: false,
      
      // Store the current user
      currentUser: null,
      
      // Category mapping (will be populated from backend)
      categories: {
        // Example format:
        // 'category-id-1': 'General',
        // 'category-id-2': 'Work',
      }
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
    },
    
    // Filtered conversations - now simpler since we're doing most filtering on the backend
    filteredConversations() {
      console.log(`Displaying ${this.conversations.length} conversations for tab: ${this.currentSecondLevelTab}`);
      
      try {
        // Sort by most recent update
        return [...this.conversations].sort((a, b) => {
          // Safely handle date comparison
          const dateA = a.updated ? new Date(a.updated) : new Date(0);
          const dateB = b.updated ? new Date(b.updated) : new Date(0);
          
          // Check if dates are valid
          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            console.warn('Invalid date in conversation sorting:', { dateA, dateB });
            return 0;
          }
          
          return dateB - dateA;
        });
      } catch (error) {
        console.error('Error filtering/sorting conversations:', error);
        return this.conversations; // Return unfiltered/unsorted list on error
      }
    }
  },

  created() {
    // Load the current user when component is created
    this.loadCurrentUser();
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
    
    // Load current user (which will then load conversations)
    this.loadCurrentUser();
    
    // Connect to existing search field in UI
    this.connectExistingSearchField();
    
    // Add a small delay to ensure all folders are loaded
    setTimeout(() => {
      // If we're already in the Folders tab, select the first custom folder
      if (this.currentSecondLevelTab === 'folders' && this.selectedFolderId === 'default') {
        this.selectFirstCustomFolder();
      }
    }, 500);
    
    // Log current service URLs for debugging
    try {
      // Try to get base URL from httpService if it's available
      if (window.httpService && window.httpService.getBaseUrl) {
        console.log('API Base URL:', window.httpService.getBaseUrl());
      }
    } catch (error) {
      console.warn('Could not determine API base URL:', error);
    }
  },
  
  beforeDestroy() {
    window.removeEventListener('hashchange', this.checkCurrentTab);
    
    // Clean up search field connection if needed
    const searchInput = document.querySelector('input[placeholder="Search conversations..."]');
    if (searchInput) {
      searchInput.removeEventListener('input', this.handleExistingSearchInput);
    }
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
    
    // Load the current user
    async loadCurrentUser() {
      try {
        console.log('Loading current user data');
        this.currentUser = userService.getCurrentUser();
        
        if (!this.currentUser) {
          this.currentUser = await userService.getCurrentUserInfo();
        }
        
        console.log('Current user loaded:', this.currentUser);
        
        // Check if we have a valid user ID
        if (!this.currentUser || (!this.currentUser._key && !this.currentUser.id)) {
          console.error('User data loaded but no valid ID found:', this.currentUser);
          this.errorMessage = this.$t('sidebar.errorLoadingUser', 'User data is incomplete. Please reload the page.');
          return;
        }
        
        // Ensure _key exists (needed for userId in requests)
        if (!this.currentUser._key && this.currentUser.id) {
          // If there's an id but no _key, use id as _key
          this.currentUser._key = this.currentUser.id;
          console.log('Using user.id as user._key:', this.currentUser._key);
        }
        
        // Now that we have a valid user, load conversations
        this.loadConversations();
        
      } catch (error) {
        console.error('Error loading current user:', error);
        this.errorMessage = this.$t('sidebar.errorLoadingUser', 'Error loading user data');
      }
    },
    
    // Load conversations from the backend
    async loadConversations() {
      console.log('Loading conversations for tab:', this.currentSecondLevelTab);
      this.isLoading = true;
      this.errorMessage = null;
      
      try {
        // Ensure we have a user ID
        if (!this.currentUser || !this.currentUser._key) {
          console.error('Cannot load conversations: No current user or missing user ID');
          this.errorMessage = this.$t('sidebar.errorLoadingUser', 'User data is missing. Please reload the page.');
          this.isLoading = false;
          return;
        }
        
        const userId = this.currentUser._key;
        console.log(`Loading conversations for user ID: ${userId}`);

        // Define options based on the current tab
        const options = {
          limit: 100, // Load a reasonable number of conversations at once
          offset: 0
        };
        
        // Set the right filters based on the current tab
        if (this.currentSecondLevelTab === 'all') {
          // For All Chats tab, exclude archived conversations
          options.includeArchived = false;
          options.filterStarred = false;
        } else if (this.currentSecondLevelTab === 'starred') {
          // For Starred tab, only get starred conversations
          options.includeArchived = false; // Don't include archived starred chats
          options.filterStarred = true;
        } else if (this.currentSecondLevelTab === 'archived') {
          // For Archived tab, only get archived conversations
          options.includeArchived = true;
          // We'll filter to show only archived in the frontend
        }
        
        // Add search term if it exists
        if (this.searchTerm && this.searchTerm.trim() !== '') {
          options.searchTerm = this.searchTerm.trim();
        }
        
        console.log('Fetching conversations with options:', options);
        
        // Fetch conversations from service WITH USER ID
        const response = await chatHistoryService.getUserConversations(userId, options);
        console.log('Conversations loaded:', response);
        
        // Process each conversation to add UI-specific properties
        this.conversations = response.conversations.map(conv => {
          return {
            ...conv,
            // Make sure these properties exist
            isStarred: !!conv.isStarred,
            isArchived: !!conv.isArchived,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0
          };
        });
        
        // For archived tab, we need additional filtering since the backend might return non-archived
        if (this.currentSecondLevelTab === 'archived') {
          this.conversations = this.conversations.filter(conv => conv.isArchived);
        }
        
        console.log(`Loaded ${this.conversations.length} conversations for ${this.currentSecondLevelTab} tab`);
        
        // Load categories if they're not loaded yet
        if (Object.keys(this.categories).length === 0) {
          this.loadCategories();
        }
      } catch (error) {
        console.error('Error loading conversations:', error);
        this.errorMessage = this.$t('sidebar.errorLoadingConversations', 'Failed to load conversations. Please try again.');
      } finally {
        this.isLoading = false;
      }
    },
    
    // Generate a preview from the conversation
    generatePreview(conversation) {
      // If the conversation has a lastMessage field, use it
      if (conversation.lastMessage) {
        return conversation.lastMessage.length > 100 
          ? conversation.lastMessage.substring(0, 97) + '...'
          : conversation.lastMessage;
      }
      
      // If there's a lastMessagePreview object, use its content
      if (conversation.lastMessagePreview && conversation.lastMessagePreview.content) {
        return conversation.lastMessagePreview.content.length > 100 
          ? conversation.lastMessagePreview.content.substring(0, 97) + '...'
          : conversation.lastMessagePreview.content;
      }
      
      // Otherwise use a placeholder
      return this.$t('sidebar.noPreview', 'No preview available');
    },
    
    // Load categories from backend (service method would need to be implemented)
    async loadCategories() {
      try {
        console.log('Loading categories');
        // Call a service method to load categories
        // For now, let's just use dummy categories
        this.categories = {
          'general': 'General',
          'work': 'Work',
          'personal': 'Personal'
        };
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    },
    
    // Get category name by ID
    getCategoryName(categoryId) {
      if (!categoryId) return '';
      return this.categories[categoryId] || categoryId;
    },
    
    // Toggle starred status of a conversation
    async toggleStarred(conversation) {
      try {
        console.log(`Toggling starred status for conversation ${conversation._key}`);
        const newStatus = !conversation.isStarred;
        
        if (!this.currentUser || !this.currentUser._key) {
          console.error('Cannot update conversation: No current user or missing user ID');
          notificationService.error(this.$t('sidebar.errorNoUser', 'User data is missing. Please reload the page.'));
          return;
        }
        
        // Update in UI immediately for responsiveness
        conversation.isStarred = newStatus;
        
        // Update on backend
        await chatHistoryService.updateConversation(conversation._key, {
          isStarred: newStatus,
          userId: this.currentUser._key // Pass userId for analytics tracking
        });
        
        // Show confirmation
        if (newStatus) {
          notificationService.success(this.$t('sidebar.chatStarred', 'Conversation has been starred'));
        } else {
          notificationService.info(this.$t('sidebar.chatUnstarred', 'Conversation has been unstarred'));
        }
      } catch (error) {
        // Revert UI change on error
        conversation.isStarred = !conversation.isStarred;
        
        console.error('Error toggling starred status:', error);
        notificationService.error(this.$t('sidebar.errorUpdatingChat', 'Failed to update conversation'));
      }
    },
    
    // Toggle archived status of a conversation
    async toggleArchived(conversation, event) {
      try {
        console.log(`Toggling archived status for conversation ${conversation._key}`);
        const newStatus = event.target.checked;
        
        if (!this.currentUser || !this.currentUser._key) {
          console.error('Cannot update conversation: No current user or missing user ID');
          notificationService.error(this.$t('sidebar.errorNoUser', 'User data is missing. Please reload the page.'));
          return;
        }
        
        // Update in UI immediately for responsiveness
        conversation.isArchived = newStatus;
        
        // Update on backend
        await chatHistoryService.updateConversation(conversation._key, {
          isArchived: newStatus,
          userId: this.currentUser._key // Pass userId for analytics tracking
        });
        
        // Show confirmation
        if (newStatus) {
          notificationService.success(this.$t('sidebar.chatArchived', 'Conversation has been archived'));
        } else {
          notificationService.info(this.$t('sidebar.chatUnarchived', 'Conversation has been unarchived'));
        }
      } catch (error) {
        // Revert UI change on error
        conversation.isArchived = !conversation.isArchived;
        
        console.error('Error toggling archived status:', error);
        notificationService.error(this.$t('sidebar.errorUpdatingChat', 'Failed to update conversation'));
      }
    },
    
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
      
      // If tab changed, reload the conversations for the new tab
      if (oldTab !== this.currentSecondLevelTab) {
        console.log(`Tab changed from ${oldTab} to ${this.currentSecondLevelTab}, reloading conversations`);
        this.loadConversations(); // Reload with appropriate filters for the current tab
      }
      
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
        } else if (text === 'starred') {
          this.currentSecondLevelTab = 'starred';
        } else if (text === 'archived') {
          this.currentSecondLevelTab = 'archived';
        }
      });
      
      // If tab changed, reload the conversations for the new tab
      if (oldTab !== this.currentSecondLevelTab) {
        console.log(`Tab changed from ${oldTab} to ${this.currentSecondLevelTab} (detected from DOM), reloading conversations`);
        this.loadConversations(); // Reload with appropriate filters for the current tab
      }
      
      // If we just switched to the Folders tab, auto-select the first custom folder
      if (oldTab !== 'folders' && this.currentSecondLevelTab === 'folders') {
        this.selectFirstCustomFolder();
      }
    },
    
    // Connect to the existing search field in the UI
    connectExistingSearchField() {
      console.log('Connecting to existing search field');
      
      // Find the existing search input in the DOM
      // Using the placeholder text from your screenshot
      const searchInput = document.querySelector('input[placeholder="Search conversations..."]');
      
      if (searchInput) {
        console.log('Found existing search input:', searchInput);
        
        // Add event listener to the existing search field
        searchInput.addEventListener('input', this.handleExistingSearchInput);
        
        // If there's an existing search button, connect to it as well
        const searchButton = searchInput.parentElement.querySelector('button') || 
                             document.querySelector('.search-button');
        
        if (searchButton) {
          console.log('Found search button, adding click handler');
          searchButton.addEventListener('click', () => this.handleExistingSearchInput({ target: searchInput }));
        }
      } else {
        console.warn('Could not find existing search input in DOM');
      }
    },
    
    // Handle input from the existing search field
    handleExistingSearchInput(event) {
      console.log('Search input changed');
      this.searchTerm = event.target.value;
      
      // Reload conversations with the new search term
      console.log(`Search term changed to: ${this.searchTerm}, reloading conversations`);
      
      // Debounce search to avoid too many API calls
      if (this.searchDebounceTimeout) {
        clearTimeout(this.searchDebounceTimeout);
      }
      
      this.searchDebounceTimeout = setTimeout(() => {
        this.loadConversations();
      }, 300); // Wait 300ms after typing stops
    },
    
    // Get appropriate title for current tab
    getTabTitle() {
      if (this.currentSecondLevelTab === 'all') {
        return this.$t('sidebar.allChats', 'All Chats');
      } else if (this.currentSecondLevelTab === 'starred') {
        return this.$t('sidebar.starredChats', 'Starred');
      } else if (this.currentSecondLevelTab === 'archived') {
        return this.$t('sidebar.archivedChats', 'Archived');
      } else if (this.currentSecondLevelTab === 'folders') {
        return this.selectedFolder ? this.selectedFolder.name : this.$t('sidebar.folders', 'Folders');
      }
      
      return this.$t('sidebar.chats', 'Chats');
    },
    
    // Get empty state message based on current tab
    getEmptyStateMessage() {
      if (this.searchTerm) {
        return this.$t('sidebar.noSearchResults', 'No conversations found for "{term}"', { term: this.searchTerm });
      }
      
      if (this.currentSecondLevelTab === 'all') {
        return this.$t('sidebar.noChats', 'No conversations found. Start a new conversation!');
      } else if (this.currentSecondLevelTab === 'starred') {
        return this.$t('sidebar.noStarredChats', 'No starred conversations yet. Star a conversation to add it here.');
      } else if (this.currentSecondLevelTab === 'archived') {
        return this.$t('sidebar.noArchivedChats', 'No archived conversations yet.');
      } else if (this.currentSecondLevelTab === 'folders') {
        return this.$t('sidebar.emptyFolder', 'This folder is empty. Move conversations here from the chat menu.');
      }
      
      return this.$t('sidebar.noChats', 'No conversations found.');
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
      console.log(`Opening chat ${chatId}`);
      // Emit event to open chat in the main chat area
      this.$emit('open-chat', chatId);
    },

    showChatActionsMenu(chat, event) {
      console.log(`Showing actions menu for chat ${chat._key}`);
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
        console.log(`Prompting to rename chat ${this.activeChat.id}`);
        this.newChatTitle = this.activeChat.title;
        this.showRenameChatDialog = true;
        this.showChatMenu = false;
      }
    }, 
    
    async handleRenameChat() {
      if (!this.activeChat || !this.newChatTitle.trim()) {
        return;
      }
      
      console.log(`Renaming chat ${this.activeChat.id} to "${this.newChatTitle}"`);
      
      try {
        // Update both UI and backend
        // First update local state for immediate response
        const originalTitle = this.activeChat.title;
        this.activeChat.title = this.newChatTitle.trim();
        
        // Then update backend
        await chatHistoryService.updateConversation(this.activeChat.id, {
          title: this.newChatTitle.trim()
        });
        
        // Also update in Vuex state if needed
        this.updateChat({
          chatId: this.activeChat.id,
          title: this.newChatTitle.trim()
        });
        
        // Close dialog
        this.showRenameChatDialog = false;
        
        // Show success notification
        notificationService.success(this.$t('sidebar.chatRenamed', 'Conversation renamed successfully'));
      } catch (error) {
        // Revert title on error
        this.activeChat.title = originalTitle;
        
        console.error('Error renaming chat:', error);
        notificationService.error(this.$t('sidebar.errorRenamingChat', 'Failed to rename conversation'));
      }
    },

    promptDeleteChat() {
      console.log(`Prompting to delete chat ${this.activeChat.id}`);
      this.showDeleteChatDialog = true;
      this.showChatMenu = false;
    },

    async handleDeleteChat() {
      if (!this.activeChat) {
        return;
      }
      
      console.log(`Deleting chat ${this.activeChat.id}`);
      
      try {
        // Delete on backend
        await chatHistoryService.deleteConversation(this.activeChat.id);
        
        // Remove from local state
        this.conversations = this.conversations.filter(c => c.id !== this.activeChat.id);
        
        // Also delete from Vuex state
        this.deleteChat(this.activeChat.id);
        
        // Close dialog
        this.showDeleteChatDialog = false;
        
        // Clear active chat
        this.activeChat = null;
        
        // Show success notification
        notificationService.success(this.$t('sidebar.chatDeleted', 'Conversation deleted successfully'));
      } catch (error) {
        console.error('Error deleting chat:', error);
        notificationService.error(this.$t('sidebar.errorDeletingChat', 'Failed to delete conversation'));
      }
    },

    async handleMoveChat() {
      if (!this.activeChat || !this.destinationFolderId) {
        return;
      }
      
      if (!this.currentUser || !this.currentUser._key) {
        console.error('Cannot move chat: No current user or missing user ID');
        notificationService.error(this.$t('sidebar.errorNoUser', 'User data is missing. Please reload the page.'));
        return;
      }
      
      console.log(`Moving chat ${this.activeChat._key} to folder ${this.destinationFolderId}`);
      
      try {
        // Update on backend (service would need a method for this)
        // This is a placeholder since the actual implementation would depend on your backend structure
        // For now, we're just updating the Vuex state
        
        // Update Vuex state
        this.moveChat({
          chatId: this.activeChat._key,
          fromFolderId: this.selectedFolderId,
          toFolderId: this.destinationFolderId
        });
        
        // Close dialog
        this.showMoveChatDialog = false;
        this.destinationFolderId = null;
        
        // Show success notification
        notificationService.success(this.$t('sidebar.chatMoved', 'Conversation moved successfully'));
      } catch (error) {
        console.error('Error moving chat:', error);
        notificationService.error(this.$t('sidebar.errorMovingChat', 'Failed to move conversation'));
      }
    },

    // Utility methods
    formatDate(dateStr) {
      if (!dateStr) return '';
      
      let date;
      try {
        // Try to parse the date string
        date = new Date(dateStr);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
          console.warn(`Invalid date string: ${dateStr}`);
          return dateStr; // Return the original string if it's not a valid date
        }
      } catch (error) {
        console.warn(`Error parsing date ${dateStr}:`, error);
        return dateStr; // Return the original string if parsing fails
      }

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

.chat-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.chat-category {
  padding: 2px 6px;
  background-color: rgba(78, 151, 209, 0.1);
  border-radius: 4px;
  font-weight: 500;
}

.chat-message-count {
  color: var(--text-tertiary);
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

.chat-dates {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.chat-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-right: 8px;
  gap: 8px;
}

.star-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
  transition: color 0.2s;
}

.star-btn:hover {
  color: var(--accent-color);
}

.star-btn .fa-star {
  color: #f5a623;
}

.archive-checkbox {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  cursor: pointer;
}

.archive-checkbox input {
  margin-bottom: 2px;
}

.archive-label {
  text-align: center;
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

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-tertiary);
  text-align: center;
}

.loading-state i,
.error-state i {
  font-size: 1.5rem;
  margin-bottom: 8px;
  color: var(--accent-color);
}

.error-state i {
  color: #e53935;
}

.retry-btn {
  margin-top: 8px;
  padding: 6px 12px;
  background-color: var(--bg-button-secondary);
  color: var(--text-button-secondary);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  cursor: pointer;
}

.retry-btn:hover {
  background-color: var(--bg-tertiary);
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