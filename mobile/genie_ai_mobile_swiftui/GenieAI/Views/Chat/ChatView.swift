// ChatView.swift
// Main chat interface

import SwiftUI
import PDFKit

struct ChatView: View {
    @Environment(AuthService.self) private var authService
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale
    @Environment(ConnectivityService.self) private var connectivity
    @Environment(LocalRAGBridge.self) private var localRAG

    @State private var chatService = ChatService()
    @State private var chatHistoryService = ChatHistoryService()
    @State private var messages: [Message] = []
    @State private var sessionId = UUID().uuidString
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var showFeedbackSheet = false
    @State private var selectedMessageForFeedback: Message?
    @State private var selectedCategoryId: String?
    @State private var selectedCategoryName: String?
    @State private var contextLabels: String?

    // Save/Load state
    @State private var currentConversationId: String?
    @State private var conversationTitle = ""
    @State private var lastSavedMessageCount = 0
    @State private var showSaveDialog = false
    @State private var showNewChatConfirmation = false
    @State private var showExportPDFSheet = false
    @State private var welcomeAppeared = false

    // Initial state passed from sidebar
    var initialConversation: Conversation?
    var initialCategoryId: String?
    var initialCategoryName: String?
    var initialContextLabels: String?

    var onNewChat: (() -> Void)?
    var onRelatedDocumentsUpdate: (([DocumentItem]) -> Void)?

    var hasUnsavedChanges: Bool {
        messages.count > lastSavedMessageCount && messages.contains(where: { $0.role == .user })
    }

    private var showQuickHelpOverlay: Bool {
        messages.isEmpty || (messages.count == 1 && messages.first?.role == .assistant)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Category Context Bar
            if let categoryName = selectedCategoryName, !categoryName.isEmpty {
                categoryContextBar(categoryName)
            }

            // Messages area with quick help overlay
            ZStack {
                VStack(spacing: 0) {
                    // Messages List
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                // Messages
                                ForEach(messages) { message in
                                    MessageBubble(
                                        message: message,
                                        onFeedbackTapped: {
                                            selectedMessageForFeedback = message
                                            showFeedbackSheet = true
                                        }
                                    )
                                    .id(message.id)
                                }

                                // Typing indicator
                                if isLoading {
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(systemName: "sparkles")
                                            .font(.title3)
                                            .foregroundStyle(theme.navbarGradient)
                                            .frame(width: 36, height: 36)
                                            .background(.ultraThinMaterial)
                                            .clipShape(Circle())

                                        HStack(spacing: 8) {
                                            BouncingDotsView(color: theme.primaryColor)
                                        }
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: theme.radiusLG, style: .continuous)
                                                .stroke(theme.glassBorder, lineWidth: 1)
                                        )

                                        Spacer(minLength: 60)
                                    }
                                    .padding(.horizontal)
                                }
                            }
                            .padding(.vertical)
                        }
                        .onChange(of: messages.count) { _, _ in
                            if let lastMessage = messages.last {
                                withAnimation {
                                    proxy.scrollTo(lastMessage.id, anchor: .bottom)
                                }
                            }
                        }
                        .safeAreaInset(edge: .bottom) {
                            ChatInputView(
                                text: $inputText,
                                isLoading: isLoading,
                                onSend: sendMessage,
                                onNewChat: { handleNewChat() },
                                onSave: { showSaveDialog = true },
                                onExportPDF: { showExportPDFSheet = true },
                                onShareWhatsApp: { shareToWhatsApp() }
                            )
                        }
                    }
                }

                // Quick Help Overlay (matches Flutter's Stack-based overlay)
                if showQuickHelpOverlay {
                    ScrollView {
                        VStack(spacing: 16) {
                            WelcomeView()
                                .padding()

                            QuickHelpGrid(onButtonTapped: handleQuickHelp)
                                .padding(.horizontal)
                        }
                        .padding(.bottom)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.ultraThinMaterial)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .offset(y: 20)),
                        removal: .scale(scale: 0.92)
                            .combined(with: .offset(y: 30))
                            .combined(with: .opacity)
                            .animation(.easeIn(duration: 0.5))
                    ))
                }
            }
            .animation(theme.animationSmooth, value: showQuickHelpOverlay)
        }
        .sheet(isPresented: $showFeedbackSheet) {
            if let message = selectedMessageForFeedback {
                FeedbackSheet(
                    message: message,
                    onSubmit: submitFeedback,
                    onDismiss: { showFeedbackSheet = false }
                )
            }
        }
        .sheet(isPresented: $showSaveDialog) {
            SaveConversationSheet(
                title: $conversationTitle,
                onSave: saveConversation,
                onDismiss: { showSaveDialog = false }
            )
        }
        .sheet(isPresented: $showExportPDFSheet) {
            ExportPDFSheet(
                messages: messages,
                onDismiss: { showExportPDFSheet = false }
            )
        }
        .alert("chatbot.dialogs.newChatTitle", isPresented: $showNewChatConfirmation) {
            Button("Discard", role: .destructive) {
                performNewChat()
            }
            Button("Save First") {
                showSaveDialog = true
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You have unsaved changes. Are you sure you want to start a new chat?")
        }
        .onAppear {
            if let conversation = initialConversation {
                loadConversation(conversation)
            } else {
                addWelcomeMessage()
                if let categoryId = initialCategoryId {
                    setCategoryContext(
                        categoryId: categoryId,
                        categoryName: initialCategoryName,
                        labels: initialContextLabels
                    )
                }
            }
        }
        .onChange(of: initialCategoryName) { _, newValue in
            // Reactively update category context as user toggles services
            // in the sidebar (without recreating the view)
            setCategoryContext(
                categoryId: initialCategoryId,
                categoryName: newValue,
                labels: initialContextLabels
            )
        }
    }

    // MARK: - Category Context Bar

    @ViewBuilder
    private func categoryContextBar(_ categoryName: String) -> some View {
        HStack {
            // Left accent bar
            RoundedRectangle(cornerRadius: 2)
                .fill(theme.primaryColor)
                .frame(width: 3, height: 24)

            Image(systemName: "lightbulb.fill")
                .foregroundColor(theme.primaryColor)

            Text("\(String(localized: "Context:")) \(categoryName)")
                .font(.subheadline)
                .foregroundColor(theme.primaryTextColor)

            Spacer()

            Button {
                selectedCategoryId = nil
                selectedCategoryName = nil
                contextLabels = nil
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(theme.secondaryTextColor)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.thinMaterial)
    }

    // MARK: - Welcome View

    @ViewBuilder
    private func WelcomeView() -> some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 50))
                .foregroundStyle(theme.navbarGradient)
                .scaleEffect(welcomeAppeared ? 1.0 : 0.6)
                .rotationEffect(.degrees(welcomeAppeared ? 0 : -20))

            Text(ConfigService.shared.botName)
                .font(.title)
                .fontWeight(.bold)

            Text("How can I help you today?")
                .font(.headline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .opacity(welcomeAppeared ? 1.0 : 0)
        .offset(y: welcomeAppeared ? 0 : 16)
        .padding(.top, 40)
        .animation(theme.animationBounce, value: welcomeAppeared)
        .onAppear {
            guard !welcomeAppeared else { return }
            withAnimation(theme.animationBounce) {
                welcomeAppeared = true
            }
        }
    }

    // MARK: - Welcome Message

    private func addWelcomeMessage() {
        guard messages.isEmpty else { return }
        let welcomeMsg = Message(
            role: .assistant,
            content: String(localized: "Welcome! How can I help you today?"),
            isSaved: true
        )
        messages.append(welcomeMsg)
        lastSavedMessageCount = 1
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""

        let userMessage = Message(
            role: .user,
            content: text
        )
        messages.append(userMessage)

        sendQuery(userMessage: userMessage)
    }

    private func handleQuickHelp(_ button: QuickHelpButton) {
        let userMessage = Message(
            role: .user,
            content: button.visibleText,
            actualContent: button.hiddenPrompt
        )
        messages.append(userMessage)

        selectedCategoryId = button.category
        sendQuery(userMessage: userMessage, hiddenPrompt: button.hiddenPrompt)
    }

    private func sendQuery(userMessage: Message, hiddenPrompt: String? = nil) {
        guard let userId = authService.currentUser?.id else { return }

        isLoading = true

        Task {
            do {
                // Build messages for API - use actualContent when available
                var apiMessages = messages.map { msg in
                    Message(
                        id: msg.id,
                        role: msg.role,
                        content: msg.actualContent ?? msg.content
                    )
                }

                // If there's a hidden prompt from quick help, replace the last user message content
                if let prompt = hiddenPrompt {
                    if let lastIndex = apiMessages.lastIndex(where: { $0.role == .user }) {
                        apiMessages[lastIndex] = Message(
                            id: apiMessages[lastIndex].id,
                            role: .user,
                            content: prompt
                        )
                    }
                }

                let response: QueryResponse

                if connectivity.isOnline {
                    // Online: use cloud API
                    response = try await chatService.submitQuery(
                        sessionId: sessionId,
                        messages: apiMessages,
                        userId: userId,
                        categoryId: selectedCategoryId,
                        contextLabels: contextLabels,
                        language: appLocale.currentLocale
                    )
                } else {
                    // Offline: use local RAG
                    let labels = contextLabels?.components(separatedBy: ",")
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty } ?? []

                    response = try await chatService.submitOfflineQuery(
                        messages: apiMessages,
                        localRAG: localRAG,
                        contextLabels: labels
                    )
                }

                // Add assistant response
                let assistantMessage = Message(
                    role: .assistant,
                    content: response.messageContent,
                    queryId: response.id,
                    confidence: response.confidence,
                    metadata: MessageMetadata(sources: response.sources)
                )

                await MainActor.run {
                    messages.append(assistantMessage)
                    isLoading = false

                    // Update related documents
                    if let sources = response.sources, !sources.isEmpty {
                        updateRelatedDocuments(from: sources)
                    }
                }
            } catch {
                await MainActor.run {
                    isLoading = false
                    let errorContent = connectivity.isOnline
                        ? String(localized: "Error processing your request.")
                        : String(localized: "Offline mode: unable to generate a response. Please check that the local model is loaded.")
                    let errorMessage = Message(
                        role: .assistant,
                        content: errorContent
                    )
                    messages.append(errorMessage)
                }
            }
        }
    }

    // MARK: - Related Documents

    private func updateRelatedDocuments(from sources: [MessageMetadata.DocumentSource]) {
        let newDocs = sources.compactMap { DocumentItem.from($0) }
        onRelatedDocumentsUpdate?(newDocs)
    }

    // MARK: - Save/Load

    private func saveConversation() {
        guard let userId = authService.currentUser?.id else { return }
        guard !messages.isEmpty else { return }

        let title = conversationTitle.isEmpty ? String(localized: "Untitled Conversation") : conversationTitle

        Task {
            do {
                if let existingId = currentConversationId {
                    // Update existing conversation
                    let _ = try await chatHistoryService.updateConversation(
                        id: existingId,
                        updates: ["title": title]
                    )

                    // Save unsaved messages
                    for i in 0..<messages.count {
                        if messages[i].isSaved != true {
                            try await chatHistoryService.addMessage(
                                conversationId: existingId,
                                message: messages[i],
                                userId: userId
                            )
                            await MainActor.run {
                                messages[i].isSaved = true
                            }
                        }
                    }
                } else {
                    // Create new conversation
                    let conversation = try await chatHistoryService.createConversation(
                        title: title,
                        userId: userId,
                        sessionId: sessionId
                    )

                    await MainActor.run {
                        currentConversationId = conversation.id
                    }

                    // Save all messages
                    for i in 0..<messages.count {
                        if messages[i].isSaved != true {
                            try await chatHistoryService.addMessage(
                                conversationId: conversation.id,
                                message: messages[i],
                                userId: userId
                            )
                            await MainActor.run {
                                messages[i].isSaved = true
                            }
                        }
                    }
                }

                await MainActor.run {
                    lastSavedMessageCount = messages.count
                    showSaveDialog = false
                }
            } catch {
                print("[ChatView] Save error: \(error)")
            }
        }
    }

    func loadConversation(_ conversation: Conversation) {
        // Fetch full conversation from API
        guard let userId = authService.currentUser?.id else {
            // Fallback to local data
            messages = conversation.messages ?? []
            sessionId = conversation.sessionId
            currentConversationId = conversation.id
            conversationTitle = conversation.title
            lastSavedMessageCount = messages.count
            return
        }

        Task {
            do {
                let data = try await APIService.shared.get(
                    "chat/conversations/\(conversation.id)",
                    params: ["userId": userId]
                )

                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = JSONDecoder.flexibleDateStrategy
                let fullConversation = try decoder.decode(Conversation.self, from: data)

                await MainActor.run {
                    messages = (fullConversation.messages ?? []).map { msg in
                        var m = msg
                        m.isSaved = true
                        return m
                    }
                    sessionId = fullConversation.sessionId
                    currentConversationId = fullConversation.id
                    conversationTitle = fullConversation.title
                    lastSavedMessageCount = messages.count

                    // Collect related docs from all assistant messages
                    let allSources = messages.compactMap { $0.metadata?.sources }.flatMap { $0 }
                    if !allSources.isEmpty {
                        updateRelatedDocuments(from: allSources)
                    }
                }
            } catch {
                // Fallback to local data
                await MainActor.run {
                    messages = conversation.messages ?? []
                    sessionId = conversation.sessionId
                    currentConversationId = conversation.id
                    conversationTitle = conversation.title
                    lastSavedMessageCount = messages.count
                }
            }
        }
    }

    // MARK: - New Chat

    func handleNewChat() {
        if hasUnsavedChanges {
            showNewChatConfirmation = true
        } else {
            performNewChat()
        }
    }

    private func performNewChat() {
        welcomeAppeared = false
        messages = []
        sessionId = UUID().uuidString
        selectedCategoryId = nil
        selectedCategoryName = nil
        contextLabels = nil
        currentConversationId = nil
        conversationTitle = ""
        lastSavedMessageCount = 0
        addWelcomeMessage()
        onNewChat?()
    }

    func startNewChat() {
        handleNewChat()
    }

    // MARK: - Category/Service Selection

    func setCategoryContext(categoryId: String?, categoryName: String?, labels: String? = nil) {
        selectedCategoryId = categoryId
        selectedCategoryName = categoryName
        contextLabels = labels
    }

    private func submitFeedback(rating: Int, comment: String?, isPositive: Bool) {
        guard let message = selectedMessageForFeedback,
              let queryId = message.queryId,
              let userId = authService.currentUser?.id else { return }

        Task {
            do {
                try await chatService.submitFeedback(
                    queryId: queryId,
                    userId: userId,
                    rating: rating,
                    comment: comment,
                    isPositive: isPositive
                )

                await MainActor.run {
                    if let index = messages.firstIndex(where: { $0.id == message.id }) {
                        messages[index].feedbackSubmitted = true
                    }
                    showFeedbackSheet = false
                }
            } catch {
                print("[ChatView] Feedback error: \(error)")
            }
        }
    }

    private func shareToWhatsApp() {
        guard !messages.isEmpty else { return }

        let title = conversationTitle.isEmpty
            ? String(localized: "Untitled Conversation")
            : conversationTitle

        var text = "Conversation with NAAT (\(title)):\n\n"
        for msg in messages {
            let role = msg.role == .user ? "Me" : "NAAT"
            text += "*\(role)*: \(msg.content)\n\n"
        }

        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""

        // Try native WhatsApp app first, fall back to wa.me
        if let appURL = URL(string: "whatsapp://send?text=\(encoded)"),
           UIApplication.shared.canOpenURL(appURL) {
            UIApplication.shared.open(appURL)
        } else if let webURL = URL(string: "https://wa.me/?text=\(encoded)") {
            UIApplication.shared.open(webURL)
        }
    }
}

// MARK: - Save Conversation Sheet

struct SaveConversationSheet: View {
    @Environment(ThemeManager.self) private var theme

    @Binding var title: String
    var onSave: () -> Void
    var onDismiss: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("Save Conversation")
                    .font(.title2)
                    .fontWeight(.bold)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Chat Title")
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)

                    TextField("chatbot.chatTitlePlaceholder", text: $title)
                        .textFieldStyle(GenieTextFieldStyle())
                }
                .padding(.horizontal)

                Spacer()

                HStack(spacing: 16) {
                    Button(action: onDismiss) {
                        Text("Cancel")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.gray.opacity(0.2))
                            .foregroundColor(theme.primaryTextColor)
                            .cornerRadius(12)
                    }

                    Button(action: onSave) {
                        Text("Save")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(theme.primaryColor)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom)
            }
            .padding(.top, 24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Export PDF Sheet

struct ExportPDFSheet: View {
    @Environment(ThemeManager.self) private var theme

    let messages: [Message]
    var onDismiss: () -> Void

    @State private var isExporting = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "doc.richtext")
                    .font(.system(size: 50))
                    .foregroundColor(theme.primaryColor)

                Text("Export Chat to PDF")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("Export this conversation to a PDF file")
                    .font(.subheadline)
                    .foregroundColor(theme.secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                Text("\(messages.filter { $0.role != .system }.count) \(String(localized: "messages"))")
                    .font(.headline)
                    .foregroundColor(theme.primaryColor)

                Spacer()

                Button(action: exportPDF) {
                    HStack {
                        if isExporting {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Image(systemName: "square.and.arrow.up")
                        Text("Export Chat to PDF")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(theme.primaryColor)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(isExporting || messages.isEmpty)
                .padding(.horizontal)
                .padding(.bottom)
            }
            .padding(.top, 24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(theme.secondaryTextColor)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func exportPDF() {
        isExporting = true

        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792))
        let pdfData = renderer.pdfData { context in
            var yPosition: CGFloat = 50
            let pageWidth: CGFloat = 612
            let margin: CGFloat = 50
            let textWidth = pageWidth - (margin * 2)

            context.beginPage()

            // Title
            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 20),
                .foregroundColor: UIColor.label
            ]
            let title = "Chat Export"
            title.draw(at: CGPoint(x: margin, y: yPosition), withAttributes: titleAttributes)
            yPosition += 40

            // Date
            let dateFormatter = DateFormatter()
            dateFormatter.dateStyle = .long
            dateFormatter.timeStyle = .short
            let dateString = dateFormatter.string(from: Date())
            let dateAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 12),
                .foregroundColor: UIColor.secondaryLabel
            ]
            dateString.draw(at: CGPoint(x: margin, y: yPosition), withAttributes: dateAttributes)
            yPosition += 30

            for message in messages where message.role != .system {
                let roleLabel = message.role == .user ? "You" : "Assistant"
                let roleAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.boldSystemFont(ofSize: 12),
                    .foregroundColor: UIColor.secondaryLabel
                ]
                let contentAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 14),
                    .foregroundColor: UIColor.label
                ]

                // Check if we need a new page
                let contentRect = message.content.boundingRect(
                    with: CGSize(width: textWidth, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin],
                    attributes: contentAttributes,
                    context: nil
                )

                if yPosition + contentRect.height + 40 > 742 {
                    context.beginPage()
                    yPosition = 50
                }

                roleLabel.draw(at: CGPoint(x: margin, y: yPosition), withAttributes: roleAttributes)
                yPosition += 20

                message.content.draw(
                    with: CGRect(x: margin, y: yPosition, width: textWidth, height: contentRect.height),
                    options: [.usesLineFragmentOrigin],
                    attributes: contentAttributes,
                    context: nil
                )
                yPosition += contentRect.height + 20
            }
        }

        // Share the PDF
        let activityVC = UIActivityViewController(
            activityItems: [pdfData],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }

        isExporting = false
        onDismiss()
    }
}

#Preview {
    ChatView()
        .environment(AuthService())
        .environment(ThemeManager())
        .environment(AppLocaleService.shared)
        .environment(ConnectivityService())
        .environment(LocalRAGBridge())
}
