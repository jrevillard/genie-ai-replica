<!-- Modified version with chat history service integration -->
<template>
  <div class="chat-folders" :data-theme="$route.meta.theme || 'light'">
    <!-- Folders Section - Only show in second-level folders tab, hide in history tab when viewing All tab -->
    <template v-if="shouldShowFoldersSection">
      <div class="folders-header">
        <h3>{{ safeT("sidebar.folders", "Folders") }}</h3>
        <button
          @click="showCreateFolderDialog = true"
          class="add-folder-btn"
          title="Create New Folder"
        >
          <i class="fas fa-folder-plus"></i>
        </button>
      </div>

      <!-- Folder List -->
      <div class="folders-list">
        <div
          v-for="folder in nonDefaultFolders"
          :key="folder.id"
          :class="[
            'folder-item',
            { 'folder-item-active': selectedFolderId === folder.id },
          ]"
          @click="selectFolder(folder.id)"
        >
          <div class="folder-icon">
            <i class="fas fa-folder"></i>
          </div>
          <div class="folder-details">
            <div class="folder-name">{{ folder.name }}</div>
            <div class="folder-count">
              {{ getChatCount(folder.id) }}
              {{ getChatCount(folder.id) === 1 ? "chat" : "chats" }}
            </div>
          </div>
          <div class="folder-actions">
            <button
              @click.stop="openEditFolderDialog(folder)"
              class="edit-btn"
              title="Edit Folder"
            >
              <i class="fas fa-edit"></i>
            </button>
            <button
              @click.stop="openDeleteFolderDialog(folder)"
              class="delete-btn"
              title="Delete Folder"
            >
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Chats in Selected Folder or Tab -->
    <div class="folder-chats">
      <!-- Search field (shown in all tabs except folders) -->
      <div v-if="shouldShowSearch" class="search-container">
        <input
          type="text"
          v-model="searchTerm"
          placeholder="Search conversations..."
          class="search-input"
          @input="handleExistingSearchInput($event)"
        />
        <button @click="loadConversationsForCurrentTab" class="search-button">
          <i class="fas fa-search"></i>
        </button>
      </div>

      <h3>{{ getTabTitle() }}</h3>

      <!-- Debug information -->
      <div v-if="debug" class="debug-info">
        <p>Current tab: {{ currentSecondLevelTab }}</p>
        <p>Conversations: {{ conversations.length }}</p>
        <p>
          First conversation:
          {{ conversations.length > 0 ? conversations[0].title : "none" }}
        </p>
      </div>

      <!-- Add direct dump for starred tab -->
      <div
        v-if="debug && currentSecondLevelTab === 'starred'"
        class="debug-info"
      >
        <p>Direct dump of conversations:</p>
        <div v-for="c in conversations" :key="c._key" class="debug-chat">
          {{ c.title }} - Starred: {{ c.isStarred }}
        </div>
      </div>

      <!-- Add direct dump for archived tab -->
      <div
        v-if="debug && currentSecondLevelTab === 'archived'"
        class="debug-info"
      >
        <p>Direct dump of conversations:</p>
        <div v-for="c in conversations" :key="c._key" class="debug-chat">
          {{ c.title }} - Archived: {{ c.isArchived }}
        </div>
      </div>

      <!-- Loading state -->
      <div class="loading-state" v-if="isLoading">
        <i class="fas fa-spinner fa-spin"></i>
        <p>{{ safeT("sidebar.loadingChats", "Loading conversations...") }}</p>
      </div>

      <!-- Error state -->
      <div class="error-state" v-else-if="errorMessage">
        <i class="fas fa-exclamation-circle"></i>
        <p>{{ errorMessage }}</p>
        <button @click="loadConversationsForCurrentTab" class="retry-btn">
          {{ safeT("sidebar.retry", "Retry") }}
        </button>
      </div>

      <!-- Conversations list - Using direct conversations array -->
      <div class="chats-list" v-else-if="conversations.length > 0">
        <div
          v-for="conversation in conversations"
          :key="conversation._key"
          class="chat-item"
          @click="openChat(conversation._key)"
        >
          <!-- Updated chat item structure -->
          <div class="chat-icon">
            <i class="fas fa-comment"></i>
          </div>

          <div class="chat-content">
            <div class="chat-header">
              <div class="chat-title">{{ conversation.title }}</div>

              <div class="chat-actions-group">
                <button
                  @click.stop="toggleStarred(conversation)"
                  class="star-btn"
                  :title="
                    conversation.isStarred
                      ? safeT('sidebar.unstar', 'Unstar')
                      : safeT('sidebar.star', 'Star')
                  "
                >
                  <i
                    :class="
                      conversation.isStarred ? 'fas fa-star' : 'far fa-star'
                    "
                  ></i>
                </button>

                <label class="archive-checkbox">
                  <input
                    type="checkbox"
                    :checked="conversation.isArchived"
                    @change="toggleArchived(conversation, $event)"
                    @click.stop
                  />
                  <span class="archive-label">{{
                    safeT("sidebar.archive", "Archive")
                  }}</span>
                </label>

                <button
                  @click.stop="showChatActionsMenu(conversation, $event)"
                  class="action-btn"
                  title="Chat Actions"
                >
                  <i class="fas fa-ellipsis-v"></i>
                </button>
              </div>
            </div>

            <div class="chat-message-count">
              {{ conversation.messageCount || 0 }}
              {{
                conversation.messageCount === 1
                  ? safeT("sidebar.message", "message")
                  : safeT("sidebar.messages", "messages")
              }}
            </div>

            <div class="chat-preview">{{ conversation.preview }}</div>

            <div class="chat-footer">
              <span class="chat-category" v-if="conversation.category">
                {{ conversation.category }}
              </span>

              <div class="chat-dates">
                <span class="chat-created">
                  {{ safeT("sidebar.created", "Created") }}:
                  {{ formatDate(conversation.created) }}
                </span>
                <span class="chat-updated">
                  {{ safeT("sidebar.updated", "Updated") }}:
                  {{ formatDate(conversation.updated) }}
                </span>
              </div>
            </div>

            <!-- Add visible badges to make starred/archived status more obvious -->
            <div class="status-badges">
              <div v-if="conversation.isStarred" class="starred-badge">
                ★ Starred
              </div>
              <div v-if="conversation.isArchived" class="archived-badge">
                📦 Archived
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div class="empty-state" v-else>
        <p>{{ getEmptyStateMessage() }}</p>
        <!-- Add appropriate icons for empty states based on tab -->
        <i
          v-if="currentSecondLevelTab === 'starred'"
          class="fas fa-star empty-state-icon"
        ></i>
        <i
          v-else-if="currentSecondLevelTab === 'archived'"
          class="fas fa-archive empty-state-icon"
        ></i>
        <i
          v-else-if="currentSecondLevelTab === 'all'"
          class="fas fa-comments empty-state-icon"
        ></i>
        <i
          v-else-if="currentSecondLevelTab === 'folders'"
          class="fas fa-folder-open empty-state-icon"
        ></i>
      </div>
    </div>

    <!-- Create Folder Dialog -->
    <modal-dialog
      v-if="showCreateFolderDialog"
      @close="showCreateFolderDialog = false"
    >
      <template v-slot:header>
        <h3>{{ safeT("sidebar.createFolder", "Create Folder") }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="folderName">{{
            safeT("sidebar.folderName", "Folder Name")
          }}</label>
          <input
            type="text"
            id="folderName"
            v-model="newFolderName"
            :placeholder="
              safeT('sidebar.folderNamePlaceholder', 'Enter folder name')
            "
            @keyup.enter="handleCreateFolder"
          />
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showCreateFolderDialog = false" class="cancel-btn">
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button
          @click="handleCreateFolder"
          class="primary-btn"
          :disabled="!newFolderName.trim()"
        >
          {{ safeT("common.create", "Create") }}
        </button>
      </template>
    </modal-dialog>

    <!-- Edit Folder Dialog -->
    <modal-dialog
      v-if="showEditFolderDialog"
      @close="
        editingFolder = null;
        showEditFolderDialog = false;
      "
    >
      <template v-slot:header>
        <h3>{{ safeT("sidebar.editFolder", "Edit Folder") }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="editFolderName">{{
            safeT("sidebar.folderName", "Folder Name")
          }}</label>
          <input
            type="text"
            id="editFolderName"
            v-model="editingFolderName"
            :placeholder="
              safeT('sidebar.folderNamePlaceholder', 'Enter folder name')
            "
            @keyup.enter="handleUpdateFolder"
          />
        </div>
      </template>
      <template v-slot:footer>
        <button
          @click="
            editingFolder = null;
            showEditFolderDialog = false;
          "
          class="cancel-btn"
        >
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button
          @click="handleUpdateFolder"
          class="primary-btn"
          :disabled="!editingFolderName.trim()"
        >
          {{ safeT("common.save", "Save") }}
        </button>
      </template>
    </modal-dialog>

    <!-- Delete Folder Confirmation -->
    <modal-dialog
      v-if="showDeleteFolderDialog"
      @close="
        editingFolder = null;
        showDeleteFolderDialog = false;
      "
    >
      <template v-slot:header>
        <h3>{{ safeT("sidebar.deleteFolder", "Delete Folder") }}</h3>
      </template>
      <template v-slot:body>
        <p>
          {{
            safeT(
              "sidebar.deleteFolderConfirm",
              "Are you sure you want to delete the folder"
            )
          }}: {{ editingFolder ? editingFolder.name : "" }}?
        </p>
        <p class="warning-text">
          {{
            safeT(
              "sidebar.chatsMoveWarning",
              "All chats in this folder will be moved to the default folder."
            )
          }}
        </p>
      </template>
      <template v-slot:footer>
        <button
          @click="
            editingFolder = null;
            showDeleteFolderDialog = false;
          "
          class="cancel-btn"
        >
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button @click="handleDeleteFolder" class="danger-btn">
          {{ safeT("common.delete", "Delete") }}
        </button>
      </template>
    </modal-dialog>

    <!-- Chat Action Menu -->
    <context-menu
      v-if="showChatMenu"
      :position="menuPosition"
      @close="showChatMenu = false"
    >
      <button @click="promptRenameChat" class="menu-item">
        <i class="fas fa-edit"></i>
        {{ safeT("sidebar.renameChat", "Rename Chat") }}
      </button>
      <button @click="showMoveChatDialog = true" class="menu-item">
        <i class="fas fa-exchange-alt"></i>
        {{ safeT("sidebar.moveChat", "Move Chat") }}
      </button>
      <button @click="promptDeleteChat" class="menu-item text-danger">
        <i class="fas fa-trash"></i>
        {{ safeT("sidebar.deleteChat", "Delete Chat") }}
      </button>
    </context-menu>

    <!-- Move Chat Dialog -->
    <modal-dialog v-if="showMoveChatDialog" @close="showMoveChatDialog = false">
      <template v-slot:header>
        <h3>{{ safeT("sidebar.moveChat", "Move Chat") }}</h3>
      </template>
      <template v-slot:body>
        <p>
          {{ safeT("sidebar.moveChatTo", "Move chat to") }}:
          {{ activeChat ? activeChat.title : "" }}
        </p>
        <div class="form-group">
          <label for="destinationFolder">{{
            safeT("sidebar.selectFolder", "Select folder")
          }}</label>
          <select id="destinationFolder" v-model="destinationFolderId">
            <option
              v-for="folder in availableFolders"
              :key="folder.id"
              :value="folder.id"
              :disabled="selectedFolderId === folder.id"
            >
              {{ folder.name }}
            </option>
          </select>
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showMoveChatDialog = false" class="cancel-btn">
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button
          @click="handleMoveChat"
          class="primary-btn"
          :disabled="
            !destinationFolderId || selectedFolderId === destinationFolderId
          "
        >
          {{ safeT("common.move", "Move") }}
        </button>
      </template>
    </modal-dialog>

    <!-- Rename Chat Dialog -->
    <modal-dialog
      v-if="showRenameChatDialog"
      @close="showRenameChatDialog = false"
    >
      <template v-slot:header>
        <h3>{{ safeT("sidebar.renameChat", "Rename Chat") }}</h3>
      </template>
      <template v-slot:body>
        <div class="form-group">
          <label for="chatTitle">{{
            safeT("sidebar.chatTitle", "Chat Title")
          }}</label>
          <input
            type="text"
            id="chatTitle"
            v-model="newChatTitle"
            :placeholder="
              safeT('sidebar.chatTitlePlaceholder', 'Enter chat title')
            "
            @keyup.enter="handleRenameChat"
          />
        </div>
      </template>
      <template v-slot:footer>
        <button @click="showRenameChatDialog = false" class="cancel-btn">
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button
          @click="handleRenameChat"
          class="primary-btn"
          :disabled="!newChatTitle.trim()"
        >
          {{ safeT("common.save", "Save") }}
        </button>
      </template>
    </modal-dialog>

    <!-- Delete Chat Confirmation -->
    <modal-dialog
      v-if="showDeleteChatDialog"
      @close="showDeleteChatDialog = false"
    >
      <template v-slot:header>
        <h3>{{ safeT("sidebar.deleteChat", "Delete Chat") }}</h3>
      </template>
      <template v-slot:body>
        <p>
          {{
            safeT(
              "sidebar.deleteChatConfirm",
              "Are you sure you want to delete the chat"
            )
          }}: {{ activeChat ? activeChat.title : "" }}?
        </p>
        <p class="warning-text">
          {{
            safeT("sidebar.deleteChatWarning", "This action cannot be undone.")
          }}
        </p>
      </template>
      <template v-slot:footer>
        <button @click="showDeleteChatDialog = false" class="cancel-btn">
          {{ safeT("common.cancel", "Cancel") }}
        </button>
        <button @click="handleDeleteChat" class="danger-btn">
          {{ safeT("common.delete", "Delete") }}
        </button>
      </template>
    </modal-dialog>
  </div>
</template>

<script>
import { mapGetters, mapActions } from "vuex";
import ModalDialog from "./ModalDialog.vue";
import ContextMenu from "./ContextMenu.vue";
import chatHistoryService from "@/services/chatHistoryService";
import userService from "@/services/userService";
import notificationService from "@/services/notificationService";

export default {
  name: "ChatFolders",

  components: {
    ModalDialog,
    ContextMenu,
  },

  data() {
    return {
      selectedFolderId: "default",
      currentSecondLevelTab: "all", // Default to 'all' since that seems to be the default

      // Conversation data
      conversations: [],
      isLoading: false,
      errorMessage: null,
      searchTerm: "",
      searchDebounceTimeout: null,

      // For creating folders
      showCreateFolderDialog: false,
      newFolderName: "",

      // For editing folders
      editingFolder: null,
      editingFolderName: "",
      showEditFolderDialog: false,
      showDeleteFolderDialog: false,

      // For chat actions
      activeChat: null,
      showChatMenu: false,
      menuPosition: { x: 0, y: 0 },
      showMoveChatDialog: false,
      destinationFolderId: null,
      showRenameChatDialog: false,
      newChatTitle: "",
      showDeleteChatDialog: false,

      // Store the current user
      currentUser: null,

      // Category mapping (will be populated from backend)
      categories: {
        // Example format:
        // 'category-id-1': 'General',
        // 'category-id-2': 'Work',
      },

      // Debug mode
      debug: false, // Set to true to show debug info, false for production
    };
  },

  computed: {
    ...mapGetters("chatHistory", [
      "getAllFolders",
      "getChatsByFolderId",
      "getFolderById",
      "getChatById",
    ]),

    folders() {
      return this.getAllFolders;
    },

    nonDefaultFolders() {
      return this.folders.filter((folder) => !folder.isDefault);
    },

    // Logic to determine if we should show the folders section
    shouldShowFoldersSection() {
      // From the logs, we see parent.activeTab is 'history'
      // We need to determine if we're in the 'folders' second-level tab
      // Check for URL or active second-level tab
      const url = window.location.href;

      // If URL contains 'folders' as a path segment or hash
      if (url.includes("/folders") || url.includes("#folders")) {
        return true;
      }

      // If the current second-level tab is 'folders'
      if (this.currentSecondLevelTab === "folders") {
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
      return this.folders.filter((folder) => !folder.isDefault);
    },

    // Determine if search field should be visible
    shouldShowSearch() {
      // Show search field for all tabs except the folders tab
      return this.currentSecondLevelTab !== "folders";
    },

    // Filtered conversations - now simpler since we're doing most filtering on the backend
    filteredConversations() {
      console.log(
        `Displaying ${this.conversations.length} conversations for tab: ${this.currentSecondLevelTab}`
      );

      try {
        let filteredChats = [...this.conversations];

        // Apply additional filtering based on tab - this is a safety measure
        // since the backend should already be filtering correctly
        if (this.currentSecondLevelTab === "starred") {
          // Ensure we only show starred conversations
          filteredChats = filteredChats.filter(
            (conv) => conv.isStarred === true
          );
          console.log(
            `After starred filtering: ${filteredChats.length} conversations`
          );
        } else if (this.currentSecondLevelTab === "archived") {
          // Ensure we only show archived conversations
          filteredChats = filteredChats.filter(
            (conv) => conv.isArchived === true
          );
          console.log(
            `After archived filtering: ${filteredChats.length} conversations`
          );
        }

        // Apply local search term filtering
        if (
          this.searchTerm &&
          this.searchTerm.trim() !== "" &&
          !this.isLoading
        ) {
          const searchTermLower = this.searchTerm.trim().toLowerCase();
          filteredChats = filteredChats.filter((conv) => {
            // Search in title, preview and category
            return (
              (conv.title &&
                conv.title.toLowerCase().includes(searchTermLower)) ||
              (conv.preview &&
                conv.preview.toLowerCase().includes(searchTermLower)) ||
              (conv.category &&
                conv.category.toLowerCase().includes(searchTermLower))
            );
          });
        }

        // Sort by most recent update
        return filteredChats.sort((a, b) => {
          // Safely handle date comparison
          const dateA = a.updated ? new Date(a.updated) : new Date(0);
          const dateB = b.updated ? new Date(b.updated) : new Date(0);

          // Check if dates are valid
          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            console.warn("Invalid date in conversation sorting:", {
              dateA,
              dateB,
            });
            return 0;
          }

          return dateB - dateA;
        });
      } catch (error) {
        console.error("Error filtering/sorting conversations:", error);
        return this.conversations; // Return unfiltered/unsorted list on error
      }
    },
  },

  created() {
    // Load the current user when component is created
    this.loadCurrentUser();
  },

  mounted() {
    console.log("ChatFolders component mounted");

    // Add this code at the beginning of the mounted hook
    // to remove any duplicate search fields as soon as the component loads
    this.$nextTick(() => {
      // Find all search containers
      const searchContainers = document.querySelectorAll(".search-container");

      if (searchContainers.length > 1) {
        console.log(
          `Found ${searchContainers.length} search containers on initial load, removing duplicates`
        );

        // Keep only the first search container (the one from the template)
        const templateSearchContainer = searchContainers[0];

        // Remove all other search containers
        for (let i = 1; i < searchContainers.length; i++) {
          if (searchContainers[i] !== templateSearchContainer) {
            searchContainers[i].remove();
          }
        }
      }

      // Add MutationObserver to detect and remove any dynamically added search fields
      const observer = new MutationObserver((mutations) => {
        const searchContainers = document.querySelectorAll(".search-container");
        if (searchContainers.length > 1) {
          console.log(
            `Detected ${searchContainers.length} search containers from mutation, cleaning up`
          );
          // Keep only the first search container
          for (let i = 1; i < searchContainers.length; i++) {
            searchContainers[i].remove();
          }
        }
      });

      // Observe the folder-chats container for any changes
      const folderChats = document.querySelector(".folder-chats");
      if (folderChats) {
        observer.observe(folderChats, { childList: true, subtree: true });
      }
    });

    // Check parent's activeTab (which appears to be 'history' from logs)
    if (this.$parent && this.$parent.activeTab) {
      console.log("Parent activeTab:", this.$parent.activeTab);
    }

    // Set up event listener for hash/URL changes
    this.checkCurrentTab();
    window.addEventListener("hashchange", this.checkCurrentTab);

    // Check for active tab elements in the DOM
    this.checkActiveTabElements();

    // Load current user (which will then load conversations)
    this.loadCurrentUser();

    // Connect to existing search field in UI
    this.connectExistingSearchField();

    // Add click event listeners to tab buttons
    this.addTabClickListeners();

    // Add a small delay to ensure all folders are loaded
    setTimeout(() => {
      // If we're already in the Folders tab, select the first custom folder
      if (
        this.currentSecondLevelTab === "folders" &&
        this.selectedFolderId === "default"
      ) {
        this.selectFirstCustomFolder();
      }
    }, 500);

    // Log current service URLs for debugging
    try {
      // Try to get base URL from httpService if it's available
      if (window.httpService && window.httpService.getBaseUrl) {
        console.log("API Base URL:", window.httpService.getBaseUrl());
      }
    } catch (error) {
      console.warn("Could not determine API base URL:", error);
    }
  },

  beforeDestroy() {
    window.removeEventListener("hashchange", this.checkCurrentTab);

    // Clean up search field connection if needed
    const searchInput = document.querySelector(
      'input[placeholder="Search conversations..."]'
    );
    if (searchInput) {
      searchInput.removeEventListener("input", this.handleExistingSearchInput);
    }
  },

  methods: {
    ...mapActions("chatHistory", [
      "createFolder",
      "updateFolder",
      "deleteFolder",
      "updateChat",
      "deleteChat",
      "moveChat",
    ]),

    // Helper to safely use $t with fallbacks
    safeT(key, fallback) {
      try {
        if (typeof this.$t === "function") {
          return this.$t(key);
        }
        return fallback;
      } catch (error) {
        console.warn(`Translation error for key ${key}:`, error);
        return fallback;
      }
    },

    // Add event listeners to tab buttons
    addTabClickListeners() {
      console.log("Adding tab click listeners");

      // Wait for DOM to be fully loaded
      setTimeout(() => {
        // Clean up any existing handlers first
        const allTabs = document.querySelectorAll(".chat-sub-tab");
        allTabs.forEach((tab) => {
          // Clone the element to remove all event listeners
          const newTab = tab.cloneNode(true);
          tab.parentNode.replaceChild(newTab, tab);

          // Add our handler
          const text = newTab.textContent.trim().toLowerCase();
          newTab.addEventListener("click", (event) => {
            console.log(`Tab clicked: ${text}`);
            this.handleTabClick(text);
          });
        });

        console.log(`Set up clean click handlers for ${allTabs.length} tabs`);
      }, 500);
    },

    // Log all elements that might be tabs to understand the DOM structure
    debugLogAllElements() {
      console.log("DEBUG: Logging all potential tab elements");

      // Look for elements with these classes which might be tab-related
      const potentialTabContainers = document.querySelectorAll(
        ".tabs, .tab-container, .nav-tabs, .nav"
      );
      console.log("Found potential tab containers:", potentialTabContainers);

      // Look for all link or button elements that could be tabs
      const allLinks = document.querySelectorAll("a");
      console.log("All links in document:", allLinks);

      // Look for elements that contain tab-related text
      const allElements = document.querySelectorAll("*");
      const possibleTabs = Array.from(allElements).filter((el) => {
        const text = el.textContent.trim().toLowerCase();
        return (
          ["all", "starred", "archived", "folders"].includes(text) &&
          !["script", "style"].includes(el.tagName.toLowerCase())
        );
      });

      console.log("Elements containing tab text:", possibleTabs);
    },

    // Set up manual click handlers for tabs based on what we observed in the DOM
    setUpManualTabClickHandlers() {
      console.log("Setting up manual tab click handlers");

      // Directly try to select the chat-sub-tab elements we saw in the logs
      const allTabElements = document.querySelectorAll(
        ".chat-sub-tab, [data-tab], li"
      );

      console.log(
        `Found ${allTabElements.length} potential tab elements by class/attribute`
      );

      allTabElements.forEach((el) => {
        const text = el.textContent.trim().toLowerCase();
        console.log(
          `Examining potential tab element: ${text}, classes: ${el.className}`
        );

        // Set up click handlers for any element that might be a tab
        if (text === "all" || text.includes("all chats")) {
          el.addEventListener("click", () => this.handleTabClick("all"));
          console.log("Added click handler for All tab");
        } else if (text === "starred") {
          el.addEventListener("click", () => this.handleTabClick("starred"));
          console.log("Added click handler for Starred tab");
        } else if (text === "archived") {
          el.addEventListener("click", () => this.handleTabClick("archived"));
          console.log("Added click handler for Archived tab");
        } else if (text === "folders") {
          el.addEventListener("click", () => this.handleTabClick("folders"));
          console.log("Added click handler for Folders tab");
        }
      });

      // One more approach: get child elements of the first .tabs container
      const tabsContainer = document.querySelector(
        ".tabs, .nav-tabs, .tab-container, .nav"
      );
      if (tabsContainer) {
        console.log("Found tabs container:", tabsContainer);

        const childTabs = Array.from(tabsContainer.children);
        console.log(
          `Found ${childTabs.length} child elements in tabs container`
        );

        // Add click handlers to each child, which might be tabs
        childTabs.forEach((tab, index) => {
          const text = tab.textContent.trim().toLowerCase();
          console.log(`Tab container child ${index}: ${text}`);

          tab.addEventListener("click", (event) => {
            console.log(`Tab container child clicked: ${text}`);

            // Try to figure out which tab was clicked based on position or text
            if (index === 0 || text.includes("all")) {
              this.handleTabClick("all");
            } else if (index === 1 || text.includes("folder")) {
              this.handleTabClick("folders");
            } else if (index === 2 || text.includes("star")) {
              this.handleTabClick("starred");
            } else if (index === 3 || text.includes("archiv")) {
              this.handleTabClick("archived");
            }
          });
        });
      }
    },

    // Handle tab click events - now with improved implementation
    handleTabClick(tabName) {
      console.log(`Tab clicked handler triggered for: ${tabName}`);

      if (this.currentSecondLevelTab !== tabName) {
        console.log(
          `Tab changed from ${this.currentSecondLevelTab} to ${tabName}`
        );

        // First clear any existing data and set loading state
        this.conversations = [];
        this.isLoading = true;

        // Update tab
        this.currentSecondLevelTab = tabName;

        // Reset search term
        this.searchTerm = "";

        // Clear any duplicate search fields
        this.cleanupDuplicateSearchFields();

        // Make sure the search field is visible for appropriate tabs
        this.ensureSearchFieldVisible();

        // Find and activate the clicked tab
        document
          .querySelectorAll(".chat-sub-tab")
          .forEach((tab) => tab.classList.remove("active"));

        // Find and activate the clicked tab
        const clickedTab = Array.from(
          document.querySelectorAll(".chat-sub-tab")
        ).find((tab) => tab.textContent.trim().toLowerCase() === tabName);
        if (clickedTab) {
          clickedTab.classList.add("active");
        }

        // Load conversations explicitly by tab type
        if (tabName === "starred") {
          this.loadSpecificTabConversations("starred");
        } else if (tabName === "archived") {
          this.loadSpecificTabConversations("archived");
        } else if (tabName === "all") {
          this.loadConversations();
        } else if (tabName === "folders") {
          // For folders tab, select the first custom folder
          this.selectFirstCustomFolder();
        }
      }
    },

    // A new direct approach to loading conversations for specific tabs
    async loadSpecificTabConversations(tabType) {
      console.log(`Direct loading for ${tabType} tab with proper parameters`);
      this.isLoading = true;
      this.errorMessage = null;
      this.conversations = []; // Clear conversations immediately to avoid showing stale data

      try {
        if (!this.currentUser || !this.currentUser._key) {
          this.errorMessage = "User data is missing";
          this.isLoading = false;
          return;
        }

        // Set up parameters specifically for this tab type
        let options = { limit: 100, offset: 0 };

        if (tabType === "starred") {
          // For Starred tab, send filterStarred=true
          options.filterStarred = true;
          options.includeArchived = false;
          console.log("Using STARRED filter params:", options);
        } else if (tabType === "archived") {
          // For Archived tab, send includeArchived=true
          options.includeArchived = true;
          options.filterArchived = true; // If supported by API
          console.log("Using ARCHIVED filter params:", options);
        }

        // Add search term if present
        if (this.searchTerm && this.searchTerm.trim() !== "") {
          options.searchTerm = this.searchTerm.trim();
        }

        // Make the API call with the proper parameters
        const response = await chatHistoryService.getUserConversations(
          this.currentUser._key,
          options
        );

        console.log(
          `Got ${
            response.conversations?.length || 0
          } total conversations from API`
        );

        // Process and store the results
        const processedConversations = (response.conversations || []).map(
          (conv) => ({
            ...conv,
            isStarred: conv.isStarred === true,
            isArchived: conv.isArchived === true,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0,
          })
        );

        // Additional client-side filtering as a fallback
        if (tabType === "starred") {
          this.conversations = processedConversations.filter(
            (conv) => conv.isStarred === true
          );
        } else if (tabType === "archived") {
          this.conversations = processedConversations.filter(
            (conv) => conv.isArchived === true
          );
        } else {
          this.conversations = processedConversations;
        }

        console.log(
          `Processed ${this.conversations.length} ${tabType} conversations`
        );

        // Force UI update in the next cycle
        this.$nextTick(() => {
          this.forceDisplayConversations();
        });
      } catch (error) {
        console.error(`Error loading ${tabType} conversations:`, error);
        this.errorMessage = `Failed to load conversations: ${
          error.message || "Unknown error"
        }`;
      } finally {
        this.isLoading = false;
      }
    },

    // Cleanup duplicate search fields
    cleanupDuplicateSearchFields() {
      // Find all search fields
      const searchFields = document.querySelectorAll(
        'input[placeholder="Search conversations..."]'
      );
      if (searchFields.length > 1) {
        console.log(
          `Found ${searchFields.length} search fields, removing duplicates`
        );
        // Keep only the first one
        for (let i = 1; i < searchFields.length; i++) {
          const field = searchFields[i];
          if (field.parentNode) {
            field.parentNode.remove();
          }
        }
      }
    },

    // Load the current user
    async loadCurrentUser() {
      try {
        console.log("Loading current user data");
        this.currentUser = userService.getCurrentUser();

        if (!this.currentUser) {
          this.currentUser = await userService.getCurrentUserInfo();
        }

        console.log("Current user loaded:", this.currentUser);

        // Check if we have a valid user ID
        if (
          !this.currentUser ||
          (!this.currentUser._key && !this.currentUser.id)
        ) {
          console.error(
            "User data loaded but no valid ID found:",
            this.currentUser
          );
          this.errorMessage = this.safeT(
            "sidebar.errorLoadingUser",
            "User data is incomplete. Please reload the page."
          );
          return;
        }

        // Ensure _key exists (needed for userId in requests)
        if (!this.currentUser._key && this.currentUser.id) {
          // If there's an id but no _key, use id as _key
          this.currentUser._key = this.currentUser.id;
          console.log("Using user.id as user._key:", this.currentUser._key);
        }

        // Now that we have a valid user, load conversations
        this.loadConversations();
      } catch (error) {
        console.error("Error loading current user:", error);
        this.errorMessage = this.safeT(
          "sidebar.errorLoadingUser",
          "Error loading user data"
        );
      }
    },

    // Force display conversations
    forceDisplayConversations() {
      console.log("Force displaying conversations:", this.conversations.length);

      // Create a clone of the conversations array to force reactivity
      this.conversations = [...this.conversations];

      // Force component update
      this.$forceUpdate();

      // Schedule another update after a short delay to ensure rendering
      setTimeout(() => {
        this.$forceUpdate();
      }, 100);
    },

    // Load conversations from the backend
    async loadConversations() {
      console.log("Loading conversations for tab:", this.currentSecondLevelTab);
      this.isLoading = true;
      this.errorMessage = null;

      try {
        // Ensure we have a user ID
        if (!this.currentUser || !this.currentUser._key) {
          console.error(
            "Cannot load conversations: No current user or missing user ID"
          );
          this.errorMessage = this.safeT(
            "sidebar.errorLoadingUser",
            "User data is missing. Please reload the page."
          );
          this.isLoading = false;
          return;
        }

        const userId = this.currentUser._key;
        console.log(`Loading conversations for user ID: ${userId}`);

        // Define options based on the current tab
        const options = {
          limit: 100, // Load a reasonable number of conversations at once
          offset: 0,
        };

        // Set the right filters based on the current tab
        if (this.currentSecondLevelTab === "all") {
          // For All Chats tab, exclude archived conversations
          options.includeArchived = false;
          options.filterStarred = false;
        } else if (this.currentSecondLevelTab === "starred") {
          // For Starred tab, only get starred conversations
          options.includeArchived = false; // Don't include archived starred chats
          options.filterStarred = true;
          console.log("Loading STARRED conversations with options:", options);
        } else if (this.currentSecondLevelTab === "archived") {
          // For Archived tab, only get archived conversations
          options.includeArchived = true;
          options.filterArchived = true; // Use explicit archived filter
          console.log("Loading ARCHIVED conversations with options:", options);
        }

        // Add search term if it exists
        if (this.searchTerm && this.searchTerm.trim() !== "") {
          options.searchTerm = this.searchTerm.trim();
        }

        console.log("Fetching conversations with options:", options);

        // Fetch conversations from service WITH USER ID
        const response = await chatHistoryService.getUserConversations(
          userId,
          options
        );
        console.log(
          `Received ${
            response.conversations?.length || 0
          } conversations from server:`,
          response
        );

        // If we didn't get conversations array or it's empty but should have data,
        // try alternate approach
        if (!response.conversations || response.conversations.length === 0) {
          if (this.currentSecondLevelTab === "starred") {
            console.log(
              "No starred conversations returned, trying alternate approach"
            );
            // Try getting all conversations and filtering for starred
            const allResponse = await chatHistoryService.getUserConversations(
              userId,
              { limit: 100, offset: 0 }
            );

            if (
              allResponse.conversations &&
              allResponse.conversations.length > 0
            ) {
              // Filter for starred conversations
              response.conversations = allResponse.conversations.filter(
                (conv) => conv.isStarred === true
              );
              console.log(
                `Found ${response.conversations.length} starred conversations using alternate approach`
              );
            }
          } else if (this.currentSecondLevelTab === "archived") {
            console.log(
              "No archived conversations returned, trying alternate approach"
            );
            // Try getting all conversations with includeArchived flag
            const allResponse = await chatHistoryService.getUserConversations(
              userId,
              { limit: 100, offset: 0, includeArchived: true }
            );

            if (
              allResponse.conversations &&
              allResponse.conversations.length > 0
            ) {
              // Filter for archived conversations
              response.conversations = allResponse.conversations.filter(
                (conv) => conv.isArchived === true
              );
              console.log(
                `Found ${response.conversations.length} archived conversations using alternate approach`
              );
            }
          }
        }

        // Process each conversation to add UI-specific properties
        this.conversations = (response.conversations || []).map((conv) => {
          return {
            ...conv,
            // Make sure these properties exist and are boolean
            isStarred: conv.isStarred === true,
            isArchived: conv.isArchived === true,
            preview: this.generatePreview(conv),
            messageCount: conv.messageCount || 0,
          };
        });

        // Additional client-side filtering for safety
        if (this.currentSecondLevelTab === "archived") {
          this.conversations = this.conversations.filter(
            (conv) => conv.isArchived === true
          );
        } else if (this.currentSecondLevelTab === "starred") {
          this.conversations = this.conversations.filter(
            (conv) => conv.isStarred === true
          );
        }

        console.log(
          `Loaded ${this.conversations.length} conversations for ${this.currentSecondLevelTab} tab`
        );

        // Force UI update
        this.forceDisplayConversations();

        // Load categories if they're not loaded yet
        if (Object.keys(this.categories).length === 0) {
          this.loadCategories();
        }
      } catch (error) {
        console.error("Error loading conversations:", error);
        this.errorMessage = this.safeT(
          "sidebar.errorLoadingConversations",
          "Failed to load conversations. Please try again."
        );
      } finally {
        this.isLoading = false;
      }
    },

    // Load conversations helper
    loadConversationsForCurrentTab() {
      console.log(
        `Loading conversations for current tab: ${this.currentSecondLevelTab}`
      );

      if (this.currentSecondLevelTab === "starred") {
        this.loadSpecificTabConversations("starred");
      } else if (this.currentSecondLevelTab === "archived") {
        this.loadSpecificTabConversations("archived");
      } else {
        this.loadConversations();
      }
    },

    // Generate a preview from the conversation
    generatePreview(conversation) {
      // If the conversation has a lastMessage field, use it
      if (conversation.lastMessage) {
        return conversation.lastMessage.length > 100
          ? conversation.lastMessage.substring(0, 97) + "..."
          : conversation.lastMessage;
      }

      // If there's a lastMessagePreview object, use its content
      if (
        conversation.lastMessagePreview &&
        conversation.lastMessagePreview.content
      ) {
        return conversation.lastMessagePreview.content.length > 100
          ? conversation.lastMessagePreview.content.substring(0, 97) + "..."
          : conversation.lastMessagePreview.content;
      }

      // Otherwise use a placeholder
      return this.safeT("sidebar.noPreview", "No preview available");
    },

    // Load categories from backend (service method would need to be implemented)
    async loadCategories() {
      try {
        console.log("Loading categories");
        // Call a service method to load categories
        // For now, let's just use dummy categories
        this.categories = {
          general: "General",
          work: "Work",
          personal: "Personal",
        };
      } catch (error) {
        console.error("Error loading categories:", error);
      }
    },

    // Get category name by ID
    getCategoryName(categoryId) {
      if (!categoryId) return "";
      return this.categories[categoryId] || categoryId;
    },

    // Toggle starred status of a conversation
    async toggleStarred(conversation) {
      try {
        console.log(
          `Toggling starred status for conversation ${conversation._key}`
        );
        const newStatus = !conversation.isStarred;

        if (!this.currentUser || !this.currentUser._key) {
          console.error(
            "Cannot update conversation: No current user or missing user ID"
          );
          notificationService.error(
            this.safeT(
              "sidebar.errorNoUser",
              "User data is missing. Please reload the page."
            )
          );
          return;
        }

        // Update in UI immediately for responsiveness
        conversation.isStarred = newStatus;

        // Update on backend
        await chatHistoryService.updateConversation(conversation._key, {
          isStarred: newStatus,
          userId: this.currentUser._key, // Pass userId for analytics tracking
        });

        // If we're in the starred tab and unstarring a conversation, remove it from the list
        if (this.currentSecondLevelTab === "starred" && !newStatus) {
          this.conversations = this.conversations.filter(
            (conv) => conv._key !== conversation._key
          );
          this.forceDisplayConversations();
        }

        // Show confirmation
        if (newStatus) {
          notificationService.success(
            this.safeT("sidebar.chatStarred", "Conversation has been starred")
          );
        } else {
          notificationService.info(
            this.safeT(
              "sidebar.chatUnstarred",
              "Conversation has been unstarred"
            )
          );
        }
      } catch (error) {
        // Revert UI change on error
        conversation.isStarred = !conversation.isStarred;

        console.error("Error toggling starred status:", error);
        notificationService.error(
          this.safeT(
            "sidebar.errorUpdatingChat",
            "Failed to update conversation"
          )
        );
      }
    },

    // Toggle archived status of a conversation
    async toggleArchived(conversation, event) {
      try {
        console.log(
          `Toggling archived status for conversation ${conversation._key}`
        );
        const newStatus = event.target.checked;

        if (!this.currentUser || !this.currentUser._key) {
          console.error(
            "Cannot update conversation: No current user or missing user ID"
          );
          notificationService.error(
            this.safeT(
              "sidebar.errorNoUser",
              "User data is missing. Please reload the page."
            )
          );
          return;
        }

        // Update in UI immediately for responsiveness
        conversation.isArchived = newStatus;

        // Update on backend
        await chatHistoryService.updateConversation(conversation._key, {
          isArchived: newStatus,
          userId: this.currentUser._key, // Pass userId for analytics tracking
        });

        // If we're in any tab other than the archived tab and archiving a conversation,
        // remove it from the current list
        if (this.currentSecondLevelTab !== "archived" && newStatus) {
          this.conversations = this.conversations.filter(
            (conv) => conv._key !== conversation._key
          );
          this.forceDisplayConversations();
        }

        // If we're in the archived tab and unarchiving a conversation, remove it from the list
        if (this.currentSecondLevelTab === "archived" && !newStatus) {
          this.conversations = this.conversations.filter(
            (conv) => conv._key !== conversation._key
          );
          this.forceDisplayConversations();
        }

        // Show confirmation
        if (newStatus) {
          notificationService.success(
            this.safeT("sidebar.chatArchived", "Conversation has been archived")
          );
        } else {
          notificationService.info(
            this.safeT(
              "sidebar.chatUnarchived",
              "Conversation has been unarchived"
            )
          );
        }
      } catch (error) {
        // Revert UI change on error
        conversation.isArchived = !conversation.isArchived;

        console.error("Error toggling archived status:", error);
        notificationService.error(
          this.safeT(
            "sidebar.errorUpdatingChat",
            "Failed to update conversation"
          )
        );
      }
    },

    // Check the current URL to determine which second-level tab we're in
    checkCurrentTab() {
      const url = window.location.href;
      const oldTab = this.currentSecondLevelTab;

      if (url.includes("/folders") || url.includes("#folders")) {
        this.currentSecondLevelTab = "folders";
      } else if (
        url.includes("/all") ||
        url.includes("#all") ||
        !url.includes("#")
      ) {
        this.currentSecondLevelTab = "all";
      } else if (url.includes("/starred") || url.includes("#starred")) {
        this.currentSecondLevelTab = "starred";
      } else if (url.includes("/archived") || url.includes("#archived")) {
        this.currentSecondLevelTab = "archived";
      }

      console.log("Current second-level tab:", this.currentSecondLevelTab);

      // If tab changed, reload the conversations for the new tab
      if (oldTab !== this.currentSecondLevelTab) {
        console.log(
          `Tab changed from ${oldTab} to ${this.currentSecondLevelTab}, reloading conversations`
        );
        // Clear search term when changing tabs
        this.searchTerm = "";

        // Update search input field if it exists
        const searchInput = document.querySelector(
          'input[placeholder="Search conversations..."]'
        );
        if (searchInput) {
          searchInput.value = "";
        }
      }

      // Always reload conversations when tab is checked - this ensures starred/archived tabs work
      console.log(
        `Always reloading conversations for tab: ${this.currentSecondLevelTab}`
      );

      // Use tab-specific loading
      this.loadConversationsForCurrentTab();

      // Ensure search field is visible in the new tab
      this.$nextTick(() => {
        if (this.currentSecondLevelTab !== "folders") {
          this.ensureSearchFieldVisible();
        }
      });

      // If we just switched to the Folders tab, auto-select the first custom folder
      if (oldTab !== "folders" && this.currentSecondLevelTab === "folders") {
        this.selectFirstCustomFolder();
      }
    },

    // Check active tab elements in the DOM
    checkActiveTabElements() {
      // Look for active elements among all tabs
      const activeElements = document.querySelectorAll(
        ".active, .selected, .router-link-active, .router-link-exact-active"
      );
      const oldTab = this.currentSecondLevelTab;

      activeElements.forEach((el) => {
        const text = el.textContent.trim().toLowerCase();
        console.log("Found active element:", text, el.tagName, el.className);

        // Update current tab based on text content
        if (text === "folders") {
          this.currentSecondLevelTab = "folders";
        } else if (text === "all") {
          this.currentSecondLevelTab = "all";
        } else if (text === "starred") {
          this.currentSecondLevelTab = "starred";
        } else if (text === "archived") {
          this.currentSecondLevelTab = "archived";
        }
      });

      // If tab changed, reload the conversations for the new tab
      if (oldTab !== this.currentSecondLevelTab) {
        console.log(
          `Tab changed from ${oldTab} to ${this.currentSecondLevelTab} (detected from DOM), reloading conversations`
        );
        // Clear search term when changing tabs
        this.searchTerm = "";

        // Update search input field if it exists
        const searchInput = document.querySelector(
          'input[placeholder="Search conversations..."]'
        );
        if (searchInput) {
          searchInput.value = "";
        }

        // Use tab-specific loading based on tab type
        this.loadConversationsForCurrentTab();
      }

      // If we just switched to the Folders tab, auto-select the first custom folder
      if (oldTab !== "folders" && this.currentSecondLevelTab === "folders") {
        this.selectFirstCustomFolder();
      }
    },

    // Connect to the existing search field in the UI
    connectExistingSearchField() {
      console.log("Connecting to existing search field");

      // Find the existing search input in the DOM
      // Using the placeholder text from your screenshot
      const searchInput = document.querySelector(
        'input[placeholder="Search conversations..."]'
      );

      if (searchInput) {
        console.log("Found existing search input:", searchInput);

        // Add event listener to the existing search field
        searchInput.addEventListener("input", this.handleExistingSearchInput);

        // If there's an existing search button, connect to it as well
        const searchButton =
          searchInput.parentElement.querySelector("button") ||
          document.querySelector(".search-button");

        if (searchButton) {
          console.log("Found search button, adding click handler");
          searchButton.addEventListener("click", () =>
            this.handleExistingSearchInput({ target: searchInput })
          );
        }
      } else {
        console.warn("Could not find existing search input in DOM");
        // Try to create search field if it doesn't exist
        //this.createSearchFieldIfNeeded();
      }
    },

    // Ensure search field is visible in non-folders tabs
    ensureSearchFieldVisible() {
      // Skip for folders tab
      if (this.currentSecondLevelTab === "folders") {
        return;
      }

      // Check if search field exists
      const searchInput = document.querySelector(
        'input[placeholder="Search conversations..."]'
      );

      if (!searchInput) {
        console.log("Search field not found, creating it");
        //this.createSearchFieldIfNeeded();
      } else {
        // Make sure it's visible and connected to our search handler
        searchInput.addEventListener("input", this.handleExistingSearchInput);

        const searchContainer =
          searchInput.closest(".search-container") || searchInput.parentElement;

        if (searchContainer) {
          searchContainer.style.display = "flex";
        }
      }
    },

    // Handle input from the existing search field
    handleExistingSearchInput(event) {
      console.log("Search input changed");
      this.searchTerm = event.target.value;

      // Reload conversations with the new search term
      console.log(
        `Search term changed to: ${this.searchTerm}, reloading conversations`
      );

      // Debounce search to avoid too many API calls
      if (this.searchDebounceTimeout) {
        clearTimeout(this.searchDebounceTimeout);
      }

      this.searchDebounceTimeout = setTimeout(() => {
        // If search term is very short, perform local filtering only
        if (this.searchTerm && this.searchTerm.length < 3) {
          // Just trigger a re-computation of filteredConversations
          this.$forceUpdate();
        } else {
          // For longer search terms, query the backend
          this.loadConversationsForCurrentTab();
        }
      }, 300); // Wait 300ms after typing stops
    },

    // Get appropriate title for current tab
    getTabTitle() {
      if (this.currentSecondLevelTab === "all") {
        return this.safeT("sidebar.allChats", "All Chats");
      } else if (this.currentSecondLevelTab === "starred") {
        return this.safeT("sidebar.starredChats", "Starred");
      } else if (this.currentSecondLevelTab === "archived") {
        return this.safeT("sidebar.archivedChats", "Archived");
      } else if (this.currentSecondLevelTab === "folders") {
        return this.selectedFolder
          ? this.selectedFolder.name
          : this.safeT("sidebar.folders", "Folders");
      }

      return this.safeT("sidebar.chats", "Chats");
    },

    // Get empty state message based on current tab
    getEmptyStateMessage() {
      if (this.searchTerm) {
        return this.safeT(
          "sidebar.noSearchResults",
          `No conversations found for "${this.searchTerm}"`
        );
      }

      if (this.currentSecondLevelTab === "all") {
        return this.safeT(
          "sidebar.noChats",
          "No conversations found. Start a new conversation!"
        );
      } else if (this.currentSecondLevelTab === "starred") {
        return this.safeT(
          "sidebar.noStarredChats",
          "No starred conversations yet. Star a conversation to add it here."
        );
      } else if (this.currentSecondLevelTab === "archived") {
        return this.safeT(
          "sidebar.noArchivedChats",
          "No archived conversations yet."
        );
      } else if (this.currentSecondLevelTab === "folders") {
        return this.safeT(
          "sidebar.emptyFolder",
          "This folder is empty. Move conversations here from the chat menu."
        );
      }

      return this.safeT("sidebar.noChats", "No conversations found.");
    },

    // Select the first custom folder in the list
    selectFirstCustomFolder() {
      console.log("Attempting to select first custom folder");
      const customFolders = this.nonDefaultFolders;

      if (customFolders.length > 0) {
        const firstFolder = customFolders[0];
        console.log("Auto-selecting folder:", firstFolder.name, firstFolder.id);
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
        this.newFolderName = "";
        this.showCreateFolderDialog = false;
      }
    },

    handleUpdateFolder() {
      if (this.editingFolder && this.editingFolderName.trim()) {
        this.updateFolder({
          folderId: this.editingFolder.id,
          name: this.editingFolderName.trim(),
        });
        this.editingFolder = null;
        this.editingFolderName = "";
        this.showEditFolderDialog = false;
      }
    },

    handleDeleteFolder() {
      if (this.editingFolder) {
        this.deleteFolder(this.editingFolder.id);

        // If we're currently viewing the deleted folder, switch to default
        if (this.selectedFolderId === this.editingFolder.id) {
          this.selectedFolderId = "default";
        }

        this.editingFolder = null;
        this.showDeleteFolderDialog = false;
      }
    },

    // Chat management
    openChat(chatId) {
      console.log(`Opening chat ${chatId}`);
      // Emit event to open chat in the main chat area
      this.$emit("open-chat", chatId);
    },

    // Context menu functionality for conversations
    showChatActionsMenu(chat, event) {
      console.log(`Showing actions menu for chat ${chat._key}`);
      this.activeChat = chat;

      // Get the dimensions of the button and viewport
      const rect = event.target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Position the menu to the left of the button, but make sure it stays on screen
      const menuWidth = 180; // Approximate width of the menu

      // Calculate position - default to directly below the button
      this.menuPosition = {
        // Place menu to the left of the button, but not too far left to avoid going off screen
        x: Math.max(10, rect.left - menuWidth + 20), // Keep at least 10px from left edge
        y: rect.bottom + 5, // Position below button with small gap
      };

      this.showChatMenu = true;

      // Use setTimeout to allow Vue to render the menu first, then adjust if needed
      setTimeout(() => {
        const menu = document.querySelector(".context-menu"); // Adjust selector if needed
        if (menu) {
          const menuRect = menu.getBoundingClientRect();

          // If menu goes off right edge, adjust position
          if (menuRect.right > viewportWidth - 10) {
            this.menuPosition.x = viewportWidth - menuWidth - 10;
          }

          // If menu goes off bottom, position it above the button
          const viewportHeight = window.innerHeight;
          if (menuRect.bottom > viewportHeight - 10) {
            this.menuPosition.y = rect.top - menuRect.height - 5;
          }
        }
      }, 0);
    },

    promptRenameChat() {
      if (this.activeChat) {
        console.log(`Prompting to rename chat ${this.activeChat._key}`);
        this.newChatTitle = this.activeChat.title;
        this.showRenameChatDialog = true;
        this.showChatMenu = false;
      }
    },

    async handleRenameChat() {
      if (!this.activeChat || !this.newChatTitle.trim()) {
        return;
      }

      console.log(
        `Renaming chat ${this.activeChat._key} to "${this.newChatTitle}"`
      );

      try {
        // Update both UI and backend
        // First update local state for immediate response
        const originalTitle = this.activeChat.title;
        this.activeChat.title = this.newChatTitle.trim();

        // Then update backend
        await chatHistoryService.updateConversation(this.activeChat._key, {
          title: this.newChatTitle.trim(),
          userId: this.currentUser._key, // Pass userId for analytics tracking
        });

        // Also update in Vuex state if needed
        this.updateChat({
          chatId: this.activeChat._key,
          title: this.newChatTitle.trim(),
        });

        // Close dialog
        this.showRenameChatDialog = false;

        // Show success notification
        notificationService.success(
          this.safeT("sidebar.chatRenamed", "Conversation renamed successfully")
        );
      } catch (error) {
        // Revert title on error
        this.activeChat.title = originalTitle;

        console.error("Error renaming chat:", error);
        notificationService.error(
          this.safeT(
            "sidebar.errorRenamingChat",
            "Failed to rename conversation"
          )
        );
      }
    },

    promptDeleteChat() {
      if (this.activeChat) {
        console.log(`Prompting to delete chat ${this.activeChat._key}`);
        this.showDeleteChatDialog = true;
        this.showChatMenu = false;
      }
    },

    async handleDeleteChat() {
      if (!this.activeChat) {
        return;
      }

      if (!this.currentUser || !this.currentUser._key) {
        console.error("Cannot delete chat: No current user or missing user ID");
        notificationService.error(
          this.safeT(
            "sidebar.errorNoUser",
            "User data is missing. Please reload the page."
          )
        );
        return;
      }

      console.log(`Deleting chat ${this.activeChat._key}`);

      try {
        // Call the service method normally - the backend will handle user ID extraction properly
        await chatHistoryService.deleteConversation(
          this.activeChat._key,
          this.currentUser._key
        );

        // Update UI
        this.conversations = this.conversations.filter(
          (c) => c._key !== this.activeChat._key
        );
        this.deleteChat(this.activeChat._key);
        this.showDeleteChatDialog = false;
        this.activeChat = null;
        notificationService.success(
          this.safeT("sidebar.chatDeleted", "Conversation deleted successfully")
        );

        // Reload conversations based on current tab
        this.loadConversationsForCurrentTab();
      } catch (error) {
        console.error("Error deleting chat:", error);
        notificationService.error(
          this.safeT(
            "sidebar.errorDeletingChat",
            "Failed to delete conversation"
          )
        );
      }
    },

    async handleMoveChat() {
      if (!this.activeChat || !this.destinationFolderId) {
        return;
      }

      if (!this.currentUser || !this.currentUser._key) {
        console.error("Cannot move chat: No current user or missing user ID");
        notificationService.error(
          this.safeT(
            "sidebar.errorNoUser",
            "User data is missing. Please reload the page."
          )
        );
        return;
      }

      console.log(
        `Moving chat ${this.activeChat._key} to folder ${this.destinationFolderId}`
      );

      try {
        // Update on backend using chatHistoryService
        // This should be implemented to handle folder moves
        // For now, we're updating the conversation with a new folderId
        await chatHistoryService.updateConversation(this.activeChat._key, {
          folderId: this.destinationFolderId,
          userId: this.currentUser._key,
        });

        // Update Vuex state
        this.moveChat({
          chatId: this.activeChat._key,
          fromFolderId: this.selectedFolderId,
          toFolderId: this.destinationFolderId,
        });

        // Close dialog
        this.showMoveChatDialog = false;
        this.destinationFolderId = null;

        // Show success notification
        notificationService.success(
          this.safeT("sidebar.chatMoved", "Conversation moved successfully")
        );

        // Refresh conversation list based on current tab
        this.loadConversationsForCurrentTab();
      } catch (error) {
        console.error("Error moving chat:", error);
        notificationService.error(
          this.safeT("sidebar.errorMovingChat", "Failed to move conversation")
        );
      }
    },

    // Utility methods
    formatDate(dateStr) {
      if (!dateStr) return "";

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
        return date.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      // If this year, show month and day
      if (date.getFullYear() === today.getFullYear()) {
        return date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
      }

      // Otherwise show full date
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
  },
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

/* Adjusted chat-item width (15% wider) and updated layout */
.chat-item {
  display: flex;
  padding: 12px;
  border-radius: 8px;
  background-color: var(--bg-card);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  color: var(--text-primary);
  position: relative;
  width: calc(100% - 10px); /* Adjust to fit sidebar width */
  max-width: 412px; /* 450px sidebar - 2*16px padding - 6px margins */
  margin-bottom: 8px;
}

.chat-item:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.chat-icon {
  margin-right: 12px;
  color: var(--accent-color);
  padding-top: 2px;
  flex-shrink: 0;
}

/* New structure for chat content */
.chat-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Header with title and action buttons */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-bottom: 8px;
}

.chat-title {
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 100px); /* Reduced from 110px to 100px */
  font-size: 1.05rem;
}

/* Grouped action buttons */
.chat-actions-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.chat-message-count {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.chat-preview {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Footer with category and dates */
.chat-footer {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.75rem;
}

.chat-category {
  display: inline-block;
  padding: 2px 6px;
  background-color: rgba(78, 151, 209, 0.1);
  border-radius: 4px;
  font-weight: 500;
  font-size: 0.8rem;
  max-width: fit-content;
  margin-bottom: 4px;
}

.chat-dates {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-tertiary);
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
  font-size: 0.7rem;
  text-align: center;
}

.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
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

/* Debug information styling */
.debug-info {
  background-color: rgba(0, 0, 0, 0.05);
  padding: 8px;
  margin-bottom: 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: #333;
}

[data-theme="dark"] .debug-info {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ddd;
}

.debug-info p {
  margin: 0;
  line-height: 1.5;
}

.debug-chat {
  padding: 5px;
  margin: 5px 0;
  border-bottom: 1px solid #eee;
}

[data-theme="dark"] .debug-chat {
  border-color: #444;
}

/* Search container styling */
.search-container {
  display: flex;
  margin-bottom: 15px;
  width: 100%;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-input);
  border-radius: 4px 0 0 4px;
  font-size: 1rem;
  background-color: var(--bg-input);
  color: var(--text-primary);
}

.search-button {
  padding: 8px 12px;
  background-color: var(--bg-button-primary);
  color: var(--text-button-primary);
  border: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
}

.search-button:hover {
  background-color: var(--accent-hover);
}

/* Star and archive badges */
.starred-badge,
.archived-badge {
  display: inline-block;
  margin-top: 8px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.starred-badge {
  background-color: rgba(245, 166, 35, 0.1);
  color: #f5a623;
}

.archived-badge {
  background-color: rgba(96, 125, 139, 0.1);
  color: #607d8b;
}

/* Empty state icons */
.empty-state-icon {
  font-size: 3rem;
  margin-top: 16px;
  color: var(--text-tertiary);
  opacity: 0.5;
}

/* Star button with outline when not starred */
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

.star-btn .fa-star-o {
  color: #8e8e8e !important; /* Force this color with !important to override any other styles */
}

/* Tab titles and section headings in dark mode */
[data-theme="dark"] .folder-chats h3,
html[data-theme="dark"] .folder-chats h3 {
  color: #ffffff !important; /* Force white color in dark mode */
}

/* This targets the "All Chats", "Starred", and "Archived" headings specifically */
[data-theme="dark"] .folder-chats > h3,
html[data-theme="dark"] .folder-chats > h3 {
  color: #ffffff !important;
}
</style>