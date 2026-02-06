// ChatHistoryView.swift
// Chat history list with folders

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

    var searchText: String
    var onConversationSelected: ((Conversation) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Sub-tabs (underline indicator style matching Flutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(ChatHistoryTab.allCases, id: \.self) { tab in
                        let isActive = selectedTab == tab
                        Button(action: { selectedTab = tab }) {
                            VStack(spacing: 0) {
                                HStack(spacing: 6) {
                                    Image(systemName: tab.icon)
                                        .font(.system(size: 14))
                                    Text(tab.localizedTitle)
                                        .font(.system(size: 12, weight: isActive ? .bold : .semibold))
                                }
                                .foregroundColor(isActive ? theme.primaryColor : theme.secondaryTextColor)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 12)

                                // Underline indicator
                                Rectangle()
                                    .fill(isActive ? theme.primaryColor : Color.clear)
                                    .frame(height: 3)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
            }
            .frame(height: 48)
            .background(theme.surfaceColor)

            Divider()

            // Content
            ScrollView {
                LazyVStack(spacing: 0) {
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
            }
        }
        .task {
            await loadData()
        }
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

    @ViewBuilder
    private func conversationsList(_ conversations: [Conversation]) -> some View {
        let filtered = filterConversations(conversations)

        if historyService.isLoading {
            ProgressView()
                .padding()
        } else if filtered.isEmpty {
            Text("No recent chats")
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .padding()
        } else {
            ForEach(filtered) { conversation in
                ConversationRow(
                    conversation: conversation,
                    onTapped: { onConversationSelected?(conversation) },
                    onRename: { promptRename(conversation) },
                    onMoveToFolder: { promptMoveToFolder(conversation) },
                    onStar: { toggleStar(conversation) },
                    onArchive: { toggleArchive(conversation) },
                    onDelete: { deleteConversation(conversation) }
                )
            }
        }
    }

    @ViewBuilder
    private func foldersList() -> some View {
        // Create Folder Button
        Button(action: { showCreateFolder = true }) {
            HStack {
                Image(systemName: "plus.circle.fill")
                Text("Create Folder")
            }
            .font(.subheadline)
            .foregroundColor(theme.primaryColor)
            .padding()
        }

        ForEach(historyService.folders) { folder in
            FolderRow(
                folder: folder,
                isExpanded: selectedFolder?.id == folder.id,
                conversationCount: historyService.getConversationsInFolder(folder.id).count,
                onToggle: {
                    withAnimation {
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
                    .padding(.leading, 20)
                }
            }
        }
    }

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
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(conversation.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)

                        if conversation.isStarred {
                            Image(systemName: "star.fill")
                                .font(.caption2)
                                .foregroundColor(.yellow)
                        }
                    }

                    Text(conversation.preview)
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .lineLimit(1)

                    Text(formatDate(conversation.updatedAt))
                        .font(.caption2)
                        .foregroundColor(theme.secondaryTextColor)
                }

                Spacer()

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
                        .foregroundColor(theme.secondaryTextColor)
                        .padding(8)
                }
            }
            .padding()
            .contentShape(Rectangle())
            .onTapGesture(perform: onTapped)

            Divider()
                .padding(.leading)
        }
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
        VStack(spacing: 0) {
            HStack {
                Image(systemName: isExpanded ? "folder.fill" : "folder")
                    .foregroundColor(theme.primaryColor)

                Text(folder.name)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Spacer()

                Text("\(conversationCount)")
                    .font(.caption2)
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.secondaryColor)
                    .cornerRadius(8)

                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
            }
            .padding()
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)

            Divider()
                .padding(.leading)
        }
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
