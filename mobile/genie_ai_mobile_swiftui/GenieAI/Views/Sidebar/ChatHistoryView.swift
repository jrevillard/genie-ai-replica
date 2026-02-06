// ChatHistoryView.swift
// Chat history list with folders — Liquid Glass design

import SwiftUI

enum ChatHistoryTab: String, CaseIterable {
    case all
    case folders
    case starred
    case archived

    var icon: String {
        switch self {
        case .all: return "bubble.left.and.bubble.right"
        case .folders: return "folder"
        case .starred: return "star"
        case .archived: return "archivebox"
        }
    }

    var localizedTitle: String {
        switch self {
        case .all: return String(localized: "All Chats")
        case .folders: return String(localized: "Folders")
        case .starred: return String(localized: "Starred")
        case .archived: return String(localized: "Archived")
        }
    }

    /// Icon for tab-specific empty states
    var emptyIcon: String {
        switch self {
        case .all: return "bubble.left.and.bubble.right"
        case .folders: return "folder"
        case .starred: return "star.slash"
        case .archived: return "archivebox"
        }
    }

    var emptyMessage: String {
        switch self {
        case .all: return String(localized: "No recent chats")
        case .folders: return String(localized: "No folders yet")
        case .starred: return String(localized: "No starred chats")
        case .archived: return String(localized: "No archived chats")
        }
    }
}

struct ChatHistoryView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AuthService.self) private var authService

    @State private var historyService = ChatHistoryService()
    @State private var selectedTab: ChatHistoryTab = .all
    @State private var showCreateFolder = false
    @State private var selectedFolder: Folder?
    @State private var showRenameAlert = false
    @State private var renameText = ""
    @State private var conversationToRename: Conversation?
    @State private var showMoveToFolder = false
    @State private var conversationToMove: Conversation?
    @State private var visibleCount = 0

    var searchText: String
    var onConversationSelected: ((Conversation) -> Void)?

    /// Total items for staggered animation
    private var totalItemCount: Int {
        switch selectedTab {
        case .all:
            let items = filterConversations(historyService.getAllNonArchivedConversations())
            return max(items.count, 1)
        case .folders:
            return 1 + historyService.folders.count // create button + folders
        case .starred:
            let items = filterConversations(historyService.getStarredConversations())
            return max(items.count, 1)
        case .archived:
            let items = filterConversations(historyService.getArchivedConversations())
            return max(items.count, 1)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Glass pill tab bar
            tabBar

            // Content
            ScrollView {
                LazyVStack(spacing: theme.spacingMD) {
                    switch selectedTab {
                    case .all:
                        conversationsList(historyService.getAllNonArchivedConversations())

                    case .folders:
                        foldersList()

                    case .starred:
                        conversationsList(historyService.getStarredConversations())

                    case .archived:
                        conversationsList(historyService.getArchivedConversations())
                    }
                }
                .padding(.horizontal, theme.spacingMD)
                .padding(.top, theme.spacingMD)
                .padding(.bottom, theme.spacingXL)
            }
        }
        .task {
            await loadData()
        }
        .onAppear { triggerStaggeredAnimation() }
        .onChange(of: selectedTab) { _, _ in triggerStaggeredAnimation() }
        .sheet(isPresented: $showCreateFolder) {
            CreateFolderSheet(onSave: createFolder, onDismiss: { showCreateFolder = false })
        }
        .alert("Rename Chat", isPresented: $showRenameAlert) {
            TextField("Rename Chat", text: $renameText)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                renameConversation()
            }
        }
        .sheet(isPresented: $showMoveToFolder) {
            MoveToFolderSheet(
                folders: historyService.folders,
                onSelect: moveConversationToFolder,
                onDismiss: {
                    showMoveToFolder = false
                    conversationToMove = nil
                }
            )
        }
    }

    // MARK: - Tab Bar

    private var tabBar: some View {
        HStack(spacing: theme.spacingXS) {
            ForEach(ChatHistoryTab.allCases, id: \.self) { tab in
                let isActive = selectedTab == tab
                Button {
                    withAnimation(theme.animationSmooth) {
                        selectedTab = tab
                    }
                    if theme.hapticsEnabled {
                        UISelectionFeedbackGenerator().selectionChanged()
                    }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 16))
                        Text(tab.localizedTitle)
                            .font(.system(size: 11, weight: isActive ? .bold : .semibold))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .foregroundColor(isActive ? theme.primaryColor : theme.secondaryTextColor)
                    .background {
                        if isActive {
                            RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                                .fill(.thinMaterial)
                                .overlay(
                                    RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                                        .stroke(theme.glassBorder, lineWidth: 1)
                                )
                                .shadow(theme.shadowSoft)
                                .padding(theme.spacingXS)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, theme.spacingXS)
        .background(.ultraThinMaterial)
    }

    // MARK: - Staggered Animation

    private func triggerStaggeredAnimation() {
        visibleCount = 0
        DispatchQueue.main.async {
            visibleCount = totalItemCount
        }
    }

    // MARK: - Conversations List

    @ViewBuilder
    private func conversationsList(_ conversations: [Conversation]) -> some View {
        let filtered = filterConversations(conversations)

        if historyService.isLoading {
            loadingState
        } else if filtered.isEmpty {
            emptyState(
                message: selectedTab.emptyMessage,
                icon: selectedTab.emptyIcon,
                index: 0
            )
        } else {
            ForEach(Array(filtered.enumerated()), id: \.element.id) { offset, conversation in
                ConversationRow(
                    conversation: conversation,
                    onTapped: { onConversationSelected?(conversation) },
                    onRename: { promptRename(conversation) },
                    onMoveToFolder: { promptMoveToFolder(conversation) },
                    onStar: { toggleStar(conversation) },
                    onArchive: { toggleArchive(conversation) },
                    onDelete: { deleteConversation(conversation) }
                )
                .staggeredAppearance(index: offset, visibleCount: visibleCount, theme: theme)
            }
        }
    }

    // MARK: - Folders List

    @ViewBuilder
    private func foldersList() -> some View {
        // Create Folder Button
        Button(action: { showCreateFolder = true }) {
            HStack(spacing: theme.spacingMD) {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(theme.primaryColor.opacity(0.85), in: Circle())

                Text("Create Folder")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.primaryTextColor)

                Spacer()
            }
            .padding(theme.spacingMD)
            .glassCard(theme: theme)
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
        .staggeredAppearance(index: 0, visibleCount: visibleCount, theme: theme)

        ForEach(Array(historyService.folders.enumerated()), id: \.element.id) { offset, folder in
            VStack(spacing: 0) {
                FolderRow(
                    folder: folder,
                    isExpanded: selectedFolder?.id == folder.id,
                    conversationCount: historyService.getConversationsInFolder(folder.id).count,
                    onToggle: {
                        withAnimation(theme.animationSmooth) {
                            selectedFolder = selectedFolder?.id == folder.id ? nil : folder
                        }
                    },
                    onDelete: { deleteFolder(folder) }
                )

                if selectedFolder?.id == folder.id {
                    let conversations = historyService.getConversationsInFolder(folder.id)
                    ForEach(conversations) { conversation in
                        ConversationRow(
                            conversation: conversation,
                            onTapped: { onConversationSelected?(conversation) },
                            onRename: { promptRename(conversation) },
                            onMoveToFolder: { promptMoveToFolder(conversation) },
                            onStar: { toggleStar(conversation) },
                            onArchive: { toggleArchive(conversation) },
                            onDelete: { deleteConversation(conversation) }
                        )
                        .padding(.leading, theme.spacingLG)
                        .padding(.top, theme.spacingXS)
                    }
                }
            }
            .staggeredAppearance(index: 1 + offset, visibleCount: visibleCount, theme: theme)
        }
    }

    // MARK: - Empty State

    @ViewBuilder
    private func emptyState(message: String, icon: String, index: Int) -> some View {
        VStack(spacing: theme.spacingMD) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundColor(theme.secondaryTextColor.opacity(0.5))

            Text(message)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .italic()
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous)
                .stroke(theme.glassBorder, lineWidth: 1)
        )
        .staggeredAppearance(index: index, visibleCount: visibleCount, theme: theme)
    }

    // MARK: - Loading State

    private var loadingState: some View {
        VStack(spacing: theme.spacingMD) {
            ProgressView()
                .tint(theme.primaryColor)
            Text("Loading chats...")
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
    }

    // MARK: - Helpers

    private func filterConversations(_ conversations: [Conversation]) -> [Conversation] {
        if searchText.isEmpty {
            return conversations
        }
        return conversations.filter {
            $0.title.localizedCaseInsensitiveContains(searchText) ||
            $0.preview.localizedCaseInsensitiveContains(searchText)
        }
    }

    private func loadData() async {
        guard let userId = authService.currentUser?.id else { return }

        do {
            try await historyService.getUserConversations(userId: userId)
            try await historyService.getUserFolders(userId: userId)
            triggerStaggeredAnimation()
        } catch {
            print("[ChatHistoryView] Load error: \(error)")
        }
    }

    private func toggleStar(_ conversation: Conversation) {
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["isStarred": !conversation.isStarred]
            )
        }
    }

    private func toggleArchive(_ conversation: Conversation) {
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["isArchived": !conversation.isArchived]
            )
        }
    }

    private func deleteConversation(_ conversation: Conversation) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.deleteConversation(id: conversation.id, userId: userId)
        }
    }

    private func createFolder(name: String) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            _ = try? await historyService.createFolder(name: name, userId: userId)
            showCreateFolder = false
        }
    }

    private func deleteFolder(_ folder: Folder) {
        guard let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.deleteFolder(id: folder.id, userId: userId)
        }
    }

    private func promptRename(_ conversation: Conversation) {
        conversationToRename = conversation
        renameText = conversation.title
        showRenameAlert = true
    }

    private func renameConversation() {
        guard let conversation = conversationToRename, !renameText.isEmpty else { return }
        Task {
            _ = try? await historyService.updateConversation(
                id: conversation.id,
                updates: ["title": renameText]
            )
        }
    }

    private func promptMoveToFolder(_ conversation: Conversation) {
        conversationToMove = conversation
        showMoveToFolder = true
    }

    private func moveConversationToFolder(_ folderId: String) {
        guard let conversation = conversationToMove,
              let userId = authService.currentUser?.id else { return }
        Task {
            try? await historyService.addConversationToFolder(
                folderId: folderId,
                conversationId: conversation.id,
                userId: userId
            )
            showMoveToFolder = false
            conversationToMove = nil
        }
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    @Environment(ThemeManager.self) private var theme

    let conversation: Conversation
    var onTapped: () -> Void
    var onRename: (() -> Void)?
    var onMoveToFolder: (() -> Void)?
    var onStar: () -> Void
    var onArchive: () -> Void
    var onDelete: () -> Void

    var body: some View {
        Button(action: onTapped) {
            HStack(alignment: .top, spacing: theme.spacingMD) {
                // Colored circle icon badge (deterministic color per conversation)
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(CategoryPalette.color(for: conversation.title), in: Circle())

                VStack(alignment: .leading, spacing: theme.spacingXS) {
                    HStack(spacing: 6) {
                        Text(conversation.title)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryTextColor)
                            .lineLimit(1)

                        if conversation.isStarred {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundColor(theme.primaryColor)
                        }
                    }

                    Text(conversation.preview)
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .lineLimit(1)

                    Text(formatDate(conversation.updatedAt))
                        .font(.caption2)
                        .foregroundColor(theme.secondaryTextColor.opacity(0.7))
                }

                Spacer(minLength: 0)

                // Ellipsis menu with glass background
                Menu {
                    if let onRename {
                        Button {
                            onRename()
                        } label: {
                            SwiftUI.Label("Rename Chat", systemImage: "pencil")
                        }
                    }

                    if let onMoveToFolder {
                        Button {
                            onMoveToFolder()
                        } label: {
                            SwiftUI.Label("Move Chat", systemImage: "folder")
                        }
                    }

                    Button {
                        onStar()
                    } label: {
                        SwiftUI.Label(
                            conversation.isStarred ? String(localized: "Unstar") : String(localized: "Star"),
                            systemImage: conversation.isStarred ? "star.slash" : "star"
                        )
                    }

                    Button {
                        onArchive()
                    } label: {
                        SwiftUI.Label(
                            conversation.isArchived ? String(localized: "Unarchive") : String(localized: "Archive"),
                            systemImage: "archivebox"
                        )
                    }

                    Divider()

                    Button(role: .destructive, action: onDelete) {
                        SwiftUI.Label("Delete Chat", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14))
                        .foregroundColor(theme.secondaryTextColor)
                        .frame(width: 32, height: 32)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }
            .padding(theme.spacingMD)
            .glassCard(theme: theme)
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Folder Row

struct FolderRow: View {
    @Environment(ThemeManager.self) private var theme

    let folder: Folder
    let isExpanded: Bool
    let conversationCount: Int
    var onToggle: () -> Void
    var onDelete: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: theme.spacingMD) {
                // Colored circle icon badge (deterministic color per folder)
                Image(systemName: isExpanded ? "folder.fill" : "folder")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(CategoryPalette.color(for: folder.name), in: Circle())

                Text(folder.name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.primaryTextColor)

                Spacer()

                // Count pill
                Text("\(conversationCount)")
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.primaryColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(theme.primaryColor.opacity(0.12), in: Capsule())

                // Rotating chevron
                Image(systemName: "chevron.forward")
                    .font(.footnote)
                    .fontWeight(.semibold)
                    .foregroundColor(isExpanded ? theme.primaryColor : theme.secondaryTextColor)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }
            .padding(theme.spacingMD)
            .glassCard(theme: theme)
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
    }
}

// MARK: - Create Folder Sheet

struct CreateFolderSheet: View {
    @Environment(ThemeManager.self) private var theme

    @State private var folderName = ""

    var onSave: (String) -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                TextField("Enter folder name", text: $folderName)
                    .textFieldStyle(GenieTextFieldStyle())
                    .padding()

                Spacer()
            }
            .navigationTitle("Create Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onDismiss)
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Create") {
                        onSave(folderName)
                    }
                    .disabled(folderName.isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Move to Folder Sheet

struct MoveToFolderSheet: View {
    @Environment(ThemeManager.self) private var theme

    let folders: [Folder]
    var onSelect: (String) -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(folders) { folder in
                    Button {
                        onSelect(folder.id)
                    } label: {
                        HStack {
                            Image(systemName: "folder")
                                .foregroundColor(theme.primaryColor)
                            Text(folder.name)
                                .foregroundColor(theme.primaryTextColor)
                        }
                    }
                }
            }
            .navigationTitle("Move Chat To")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: onDismiss)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

#Preview {
    ChatHistoryView(searchText: "")
        .environment(ThemeManager())
        .environment(AuthService())
}
