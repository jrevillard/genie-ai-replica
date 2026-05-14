// RightSidebarView.swift
// Right sidebar with related documents and FAQ

import SwiftUI
import os

private let sidebarLogger = Logger(subsystem: "com.genieai", category: "sidebar.right")

struct RightSidebarView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale
    @Environment(RelatedDocsStore.self) private var relatedDocsStore

    var accessToken: String?
    var showHeader: Bool = true

    @State private var faqItems: [FAQItem] = []
    @State private var isLoadingFaq = false
    @State private var lastFaqLangCode = "en"
    @State private var visibleCount = 0

    /// Convenience accessor — keeps the rest of the body terse and lets us
    /// swap out the storage without touching every read site.
    private var relatedDocs: [DocumentItem] { relatedDocsStore.docs }

    /// Total number of animatable items (section headers + cards/empty states)
    private var totalItemCount: Int {
        // Section header for docs + doc cards (or 1 empty state) + section header for FAQ + FAQ cards (or 1 empty/loading state)
        let docCount = relatedDocs.isEmpty ? 1 : relatedDocs.count
        let faqCount = faqItems.isEmpty ? 1 : faqItems.count
        return 1 + docCount + 1 + faqCount
    }

    var body: some View {
        // Side-effect log inside body — fires on every body re-evaluation so
        // we can confirm SwiftUI is invalidating this view when its
        // `relatedDocs` prop changes.
        let _ = sidebarLogger.info("body render: relatedDocs=\(relatedDocs.count, privacy: .public) visibleCount=\(visibleCount, privacy: .public)")
        VStack(spacing: 0) {
            // Header (hidden when presented in a sheet with its own navigation title)
            if showHeader {
                HStack {
                    Text("Info & Resources")
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundColor(theme.primaryTextColor)
                    Spacer()
                }
                .padding()
                .overlay(alignment: .bottom) { Divider() }
            }

            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacingLG) {
                    // Related Documents Section
                    sectionTitle("Related Documents", icon: "doc.text", index: 0)

                    if relatedDocs.isEmpty {
                        emptyState("No related documents", icon: "doc.text.magnifyingglass", index: 1)
                    } else {
                        ForEach(Array(relatedDocs.enumerated()), id: \.element.id) { offset, doc in
                            DocumentRow(document: doc, accessToken: accessToken)
                                .staggeredAppearance(index: 1 + offset, visibleCount: visibleCount, theme: theme)
                        }
                    }

                    Spacer().frame(height: theme.spacingLG)

                    // FAQ Section
                    let faqHeaderIndex = 1 + (relatedDocs.isEmpty ? 1 : relatedDocs.count)
                    sectionTitle("Frequently Asked Questions", icon: "questionmark.circle", index: faqHeaderIndex)

                    if isLoadingFaq {
                        faqLoadingState(index: faqHeaderIndex + 1)
                    } else if faqItems.isEmpty {
                        emptyState("FAQ not available", icon: "questionmark.bubble", index: faqHeaderIndex + 1)
                    } else {
                        ForEach(Array(faqItems.enumerated()), id: \.element.id) { offset, item in
                            FAQRow(item: item)
                                .staggeredAppearance(index: faqHeaderIndex + 1 + offset, visibleCount: visibleCount, theme: theme)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
        }
        .background(.ultraThinMaterial)
        .task {
            await loadFAQ()
        }
        .onChange(of: appLocale.currentLocale) { _, _ in
            Task { await loadFAQ() }
        }
        .onAppear {
            sidebarLogger.info("onAppear: relatedDocs=\(relatedDocs.count, privacy: .public) visibleCount=\(visibleCount, privacy: .public) totalItemCount=\(totalItemCount, privacy: .public) animationsEnabled=\(theme.animationsEnabled, privacy: .public)")
            triggerStaggeredAnimation()
        }
        .onChange(of: faqItems.count) { _, _ in triggerStaggeredAnimation() }
        // Without this, opening the sidebar BEFORE a query completes sets
        // visibleCount based on relatedDocs.count == 0. When the response
        // arrives and relatedDocs becomes [1], totalItemCount happens to
        // stay the same (empty state collapses to count=1), but the
        // staggered animation never re-runs to confirm the new DocumentRow's
        // opacity — and on some SwiftUI builds it ends up stuck at 0. Fire
        // the animation again whenever the doc list changes.
        .onChange(of: relatedDocs.count) { _, newCount in
            sidebarLogger.info("relatedDocs.count changed -> \(newCount, privacy: .public). Re-triggering staggered animation.")
            triggerStaggeredAnimation()
        }
    }

    // MARK: - Staggered Animation Trigger

    private func triggerStaggeredAnimation() {
        visibleCount = 0
        DispatchQueue.main.async {
            visibleCount = totalItemCount
        }
    }

    // MARK: - Section Title

    @ViewBuilder
    private func sectionTitle(_ title: String, icon: String, index: Int) -> some View {
        HStack(spacing: theme.spacingMD) {
            Image(systemName: icon)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(theme.primaryColor.opacity(0.85), in: RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous))

            Text(title)
                .font(.subheadline)
                .fontWeight(.bold)
                .foregroundColor(theme.primaryTextColor)
        }
        .staggeredAppearance(index: index, visibleCount: visibleCount, theme: theme)
    }

    // MARK: - Empty State

    @ViewBuilder
    private func emptyState(_ message: String, icon: String, index: Int) -> some View {
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

    // MARK: - FAQ Loading State

    @ViewBuilder
    private func faqLoadingState(index: Int) -> some View {
        VStack(spacing: theme.spacingMD) {
            ProgressView()
                .tint(theme.primaryColor)
            Text("Loading FAQ...")
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
        }
        .frame(maxWidth: .infinity)
        .padding(theme.spacingXL)
        .staggeredAppearance(index: index, visibleCount: visibleCount, theme: theme)
    }

    // MARK: - FAQ Loading

    private func loadFAQ() async {
        isLoadingFaq = true
        defer { isLoadingFaq = false }

        guard let url = Bundle.main.url(forResource: "FAQ", withExtension: "md"),
              let baseMarkdown = try? String(contentsOf: url, encoding: .utf8) else {
            faqItems = []
            return
        }

        let langCode = appLocale.currentLocale
        var markdownContent = baseMarkdown

        if langCode != "en" {
            do {
                let data = try await APIService.shared.post("translate/markdown", data: [
                    "markdown": baseMarkdown,
                    "source_lang": "en",
                    "target_lang": langCode
                ])

                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let translated = json["translated_markdown"] {
                    if let arr = translated as? [String] {
                        markdownContent = arr.joined(separator: "\n")
                    } else if let str = translated as? String {
                        markdownContent = str
                    }
                }
            } catch {
                // Fallback to English
                markdownContent = baseMarkdown
            }
        }

        lastFaqLangCode = langCode
        faqItems = parseFaqMarkdown(markdownContent)
    }

    private func parseFaqMarkdown(_ markdown: String) -> [FAQItem] {
        var faqs: [FAQItem] = []
        let lines = markdown.components(separatedBy: "\n")

        var currentQuestion: String?
        var currentAnswer = ""

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("## ") {
                if let question = currentQuestion {
                    faqs.append(FAQItem(
                        question: question,
                        answer: currentAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
                    ))
                    currentAnswer = ""
                }
                currentQuestion = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                // Strip bold markers from question
                if let q = currentQuestion, q.hasPrefix("**") && q.hasSuffix("**") {
                    currentQuestion = String(q.dropFirst(2).dropLast(2))
                }
            } else if currentQuestion != nil {
                currentAnswer += line + "\n"
            }
        }

        if let question = currentQuestion {
            faqs.append(FAQItem(
                question: question,
                answer: currentAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
            ))
        }

        return faqs
    }
}

// MARK: - Document Item

struct DocumentItem: Identifiable {
    let id = UUID()
    let title: String
    let url: String?
    let type: DocumentType
    let fileName: String?
    let fileFormat: String?
    let fileSize: Int?
    let documentId: String?
    let labels: String?
    let confidence: Double?

    enum DocumentType {
        case pdf
        case web
        case video
        case word
        case excel
        case powerpoint
        case image
        case audio
        case text
        case other

        var icon: String {
            switch self {
            case .pdf: return "doc.richtext.fill"
            case .web: return "globe"
            case .video: return "play.rectangle.fill"
            case .word: return "doc.fill"
            case .excel: return "tablecells.fill"
            case .powerpoint: return "rectangle.fill.on.rectangle.angled.fill"
            case .image: return "photo.fill"
            case .audio: return "waveform.circle.fill"
            case .text: return "doc.plaintext.fill"
            case .other: return "doc.fill"
            }
        }

        var color: Color {
            switch self {
            case .pdf: return .red
            case .web: return .blue
            case .video: return .purple
            case .word: return .blue
            case .excel: return .green
            case .powerpoint: return .orange
            case .image: return .teal
            case .audio: return .pink
            case .text: return .gray
            case .other: return .secondary
            }
        }
    }

    static func from(_ source: MessageMetadata.DocumentSource) -> DocumentItem? {
        let urlStr = source.url
        let isExternal = (urlStr ?? "").hasPrefix("http")

        let docType = detectType(
            url: urlStr,
            fileType: source.fileType,
            fileName: source.fileName ?? source.title
        )

        let allLabels = collectLabels(
            categoryLabel: source.categoryLabel,
            serviceLabels: source.serviceLabels,
            labels: source.labels
        )

        let format = getFileFormat(
            fileType: source.fileType,
            fileName: source.fileName
        )

        return DocumentItem(
            title: source.title ?? source.fileName ?? urlStr ?? "Unknown",
            url: urlStr,
            type: isExternal ? .web : docType,
            fileName: source.fileName,
            fileFormat: format,
            fileSize: source.fileSize,
            documentId: source.documentId,
            labels: allLabels.isEmpty ? nil : allLabels,
            confidence: source.score
        )
    }

    static func detectType(url: String?, fileType: String?, fileName: String?) -> DocumentType {
        let type = (fileType ?? "").lowercased()
        let name = (fileName ?? "").lowercased()

        if type == "pdf" || name.hasSuffix(".pdf") { return .pdf }
        if type.contains("word") || name.contains(".doc") { return .word }
        if type.contains("excel") || name.contains(".xls") { return .excel }
        if type.contains("powerpoint") || name.contains(".ppt") { return .powerpoint }
        if type.contains("image") || name.hasSuffix(".jpg") || name.hasSuffix(".png") { return .image }
        if type.contains("video") { return .video }
        if type.contains("audio") { return .audio }
        if name.hasSuffix(".md") || name.hasSuffix(".txt") { return .text }

        return .other
    }

    static func getFileFormat(fileType: String?, fileName: String?) -> String {
        if let ft = fileType, !ft.isEmpty {
            if ft.contains("/") { return ft.components(separatedBy: "/").last?.uppercased() ?? "FILE" }
            return ft.uppercased()
        }
        if let fn = fileName, fn.contains(".") {
            return (fn.components(separatedBy: ".").last ?? "FILE").uppercased()
        }
        return "FILE"
    }

    static func formatFileSize(_ bytes: Int?) -> String {
        guard let bytes = bytes, bytes > 0 else { return "Unknown" }
        let suffixes = ["B", "KB", "MB", "GB"]
        let i = min(Int(log(Double(bytes)) / log(1024)), suffixes.count - 1)
        let size = Double(bytes) / pow(1024, Double(i))
        return String(format: "%.1f %@", size, suffixes[i])
    }

    static func formatScore(_ score: Double?) -> String {
        guard let score = score else { return "Unknown" }
        return String(format: "%.0f%%", score * 100)
    }

    private static func collectLabels(
        categoryLabel: [String]?,
        serviceLabels: [String]?,
        labels: [String]?
    ) -> String {
        var all = Set<String>()
        if let c = categoryLabel { all.formUnion(c) }
        if let s = serviceLabels { all.formUnion(s) }
        if let l = labels { all.formUnion(l) }
        return all.joined(separator: ", ")
    }
}

// MARK: - Document Row (Rich Card)

struct DocumentRow: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(\.openURL) private var openURL

    let document: DocumentItem
    var accessToken: String?

    /// Split labels string into individual label strings, max 3
    private var labelPills: [String] {
        guard let labels = document.labels else { return [] }
        return Array(
            labels.components(separatedBy: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .prefix(3)
        )
    }

    /// Confidence color: green >= 80%, orange >= 50%, gray below
    private var confidenceColor: Color {
        guard let score = document.confidence else { return .gray }
        if score >= 0.8 { return .green }
        if score >= 0.5 { return .orange }
        return .gray
    }

    var body: some View {
        Button(action: openDocument) {
            VStack(alignment: .leading, spacing: theme.spacingMD) {
                // Top row: icon + title + confidence badge
                HStack(alignment: .top, spacing: theme.spacingMD) {
                    // Prominent colored circle icon
                    Image(systemName: document.type.icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(document.type.color, in: Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(document.title)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(theme.primaryTextColor)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)

                        // Show file name as caption only when different from title
                        if let fileName = document.fileName, fileName != document.title {
                            Text(fileName)
                                .font(.caption2)
                                .foregroundColor(theme.secondaryTextColor)
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 0)

                    // Confidence badge
                    if let score = document.confidence {
                        Text(DocumentItem.formatScore(score))
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundStyle(confidenceColor)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(confidenceColor.opacity(0.12), in: Capsule())
                    }
                }

                // Metadata pills row
                HStack(spacing: 6) {
                    metadataPill(document.fileFormat ?? "FILE")

                    if let size = document.fileSize, size > 0 {
                        metadataPill(DocumentItem.formatFileSize(size))
                    }

                    Spacer(minLength: 0)
                }

                // Label pills row
                if !labelPills.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(labelPills, id: \.self) { label in
                            Text(label)
                                .font(.caption2)
                                .fontWeight(.medium)
                                .foregroundColor(theme.primaryColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(theme.primaryColor.opacity(0.08), in: Capsule())
                        }
                    }
                }
            }
            .padding(theme.spacingMD)
            .glassCard(theme: theme)
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
    }

    @ViewBuilder
    private func metadataPill(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundColor(theme.secondaryTextColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func openDocument() {
        // External URL — open directly
        if let urlStr = document.url, urlStr.hasPrefix("http") {
            if let url = URL(string: urlStr) {
                openURL(url)
            }
            return
        }

        // Internal file — open via files API with token
        guard let fileId = document.documentId, !fileId.isEmpty else { return }
        guard let token = accessToken, !token.isEmpty else { return }

        let viewUrl = "https://app.youngailinz.org/api/files/\(fileId)/view?access_token=\(token)"
        if let url = URL(string: viewUrl) {
            openURL(url)
        }
    }
}

// MARK: - Flow Layout (for label pills)

private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (positions: [CGPoint], size: CGSize) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
            maxX = max(maxX, currentX - spacing)
        }

        return (positions, CGSize(width: maxX, height: currentY + lineHeight))
    }
}

// MARK: - FAQ Item

struct FAQItem: Identifiable {
    let id = UUID()
    let question: String
    let answer: String
}

struct FAQRow: View {
    @Environment(ThemeManager.self) private var theme

    let item: FAQItem
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Question header — entire row is tappable
            HStack(alignment: .center, spacing: theme.spacingMD) {
                // Leading icon
                Image(systemName: isExpanded ? "lightbulb.fill" : "lightbulb")
                    .font(.body)
                    .foregroundColor(isExpanded ? Color(red: 0.92, green: 0.75, blue: 0.20) : Color(red: 0.78, green: 0.65, blue: 0.30))
                    .frame(width: 24)

                Text(item.question)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(theme.primaryTextColor)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.forward")
                    .font(.footnote)
                    .fontWeight(.semibold)
                    .foregroundColor(isExpanded ? theme.primaryColor : theme.secondaryTextColor)
                    .rotationEffect(.degrees(isExpanded ? 90 : 0))
            }
            .padding(.horizontal, theme.spacingLG)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
            .onTapGesture {
                withAnimation(theme.animationSmooth) { isExpanded.toggle() }
                if theme.hapticsEnabled {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
            .zIndex(1)

            // Answer body — clipped so it reveals downward without leaking behind the header
            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    Divider()
                        .padding(.horizontal, theme.spacingLG)

                    HStack(alignment: .top, spacing: theme.spacingMD) {
                        // Align with question text via matching icon width
                        Image(systemName: "text.quote")
                            .font(.caption)
                            .foregroundColor(theme.primaryColor.opacity(0.4))
                            .frame(width: 24)
                            .padding(.top, 2)

                        Text(LocalizedStringKey(item.answer))
                            .font(.subheadline)
                            .foregroundColor(theme.secondaryTextColor)
                            .lineSpacing(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .multilineTextAlignment(.leading)
                    }
                    .padding(.horizontal, theme.spacingLG)
                    .padding(.top, theme.spacingMD)
                    .padding(.bottom, theme.spacingLG)
                }
                .clipped()
                .transition(.opacity)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
        .background {
            if isExpanded {
                RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous)
                    .fill(theme.primaryColor.opacity(0.04))
            }
        }
        .glassCard(theme: theme, radius: theme.radiusMD)
    }
}

#Preview {
    let store = RelatedDocsStore()
    store.docs = [
        DocumentItem(
            title: "Annual Tax Guidelines 2024",
            url: "https://example.com/doc.pdf",
            type: .pdf,
            fileName: "tax_guide_v3_final.pdf",
            fileFormat: "PDF",
            fileSize: 2_500_000,
            documentId: "doc-123",
            labels: "Taxation, Finance",
            confidence: 0.95
        ),
        DocumentItem(
            title: "Service Centre Locations",
            url: "https://example.com",
            type: .web,
            fileName: nil,
            fileFormat: "HTML",
            fileSize: nil,
            documentId: nil,
            labels: nil,
            confidence: 0.72
        ),
        DocumentItem(
            title: "Internal Policy Document",
            url: nil,
            type: .word,
            fileName: "internal_policy_v2.docx",
            fileFormat: "DOCX",
            fileSize: 450_000,
            documentId: "doc-456",
            labels: nil,
            confidence: nil
        )
    ]
    return RightSidebarView(accessToken: nil)
        .frame(width: 300)
        .environment(ThemeManager())
        .environment(AppLocaleService.shared)
        .environment(store)
}
