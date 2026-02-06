// RightSidebarView.swift
// Right sidebar with related documents and FAQ

import SwiftUI

struct RightSidebarView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(AppLocaleService.self) private var appLocale

    var relatedDocs: [DocumentItem]
    var accessToken: String?

    @State private var faqItems: [FAQItem] = []
    @State private var isLoadingFaq = false
    @State private var lastFaqLangCode = "en"

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Info & Resources")
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(theme.primaryTextColor)
                Spacer()
            }
            .padding()
            .overlay(alignment: .bottom) { Divider() }

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Related Documents Section
                    sectionTitle("Related Documents", icon: "doc.text")

                    if relatedDocs.isEmpty {
                        emptyState("No related documents")
                    } else {
                        ForEach(relatedDocs) { doc in
                            DocumentRow(document: doc, accessToken: accessToken)
                        }
                    }

                    Spacer().frame(height: 16)

                    // FAQ Section
                    sectionTitle("Frequently Asked Questions", icon: "questionmark.circle")

                    if isLoadingFaq {
                        HStack {
                            Spacer()
                            ProgressView()
                                .padding()
                            Spacer()
                        }
                    } else if faqItems.isEmpty {
                        emptyState("FAQ not available")
                    } else {
                        ForEach(faqItems) { item in
                            FAQRow(item: item)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
        }
        .background(theme.surfaceColor)
        .task {
            await loadFAQ()
        }
        .onChange(of: appLocale.currentLocale) { _, _ in
            Task { await loadFAQ() }
        }
    }

    // MARK: - Section Title

    @ViewBuilder
    private func sectionTitle(_ title: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
            Text(title)
                .font(.subheadline)
                .fontWeight(.bold)
                .foregroundColor(theme.secondaryTextColor)
        }
    }

    // MARK: - Empty State

    @ViewBuilder
    private func emptyState(_ message: String) -> some View {
        Text(message)
            .font(.caption)
            .foregroundColor(theme.secondaryTextColor)
            .italic()
            .frame(maxWidth: .infinity)
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous))
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
        return String(format: "%.2f%%", score * 100)
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

    var body: some View {
        Button(action: openDocument) {
            VStack(alignment: .leading, spacing: 0) {
                // Title row with icon
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: document.type.icon)
                        .font(.subheadline)
                        .foregroundColor(document.type.color)

                    Text(document.title)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(theme.primaryTextColor)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .padding(.bottom, 6)

                Divider()
                    .padding(.vertical, 4)

                // Detail rows
                if let fileName = document.fileName, fileName != document.title {
                    detailRow(label: "File Name", value: fileName)
                }

                HStack(spacing: 0) {
                    detailRow(label: "Format", value: document.fileFormat ?? "FILE")
                    detailRow(label: "Size", value: DocumentItem.formatFileSize(document.fileSize))
                }

                if let docId = document.documentId, !docId.isEmpty {
                    detailRow(label: "ID", value: docId)
                }

                detailRow(label: "Labels", value: document.labels ?? "Unknown")
                detailRow(label: "Confidence", value: DocumentItem.formatScore(document.confidence))
            }
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                    .stroke(theme.glassBorder, lineWidth: 1)
            )
            .shadow(theme.shadowSoft)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func detailRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Text("\(label): ")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundColor(theme.secondaryTextColor)

            Text(value)
                .font(.caption2)
                .foregroundColor(theme.primaryTextColor)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
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

        let viewUrl = "https://genie-ai.itu.int/api/files/\(fileId)/view?access_token=\(token)"
        if let url = URL(string: viewUrl) {
            openURL(url)
        }
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
            Button(action: {
                withAnimation(theme.animationStandard) { isExpanded.toggle() }
            }) {
                HStack(alignment: .top) {
                    Text(item.question)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundColor(theme.primaryTextColor)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(theme.secondaryTextColor)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .padding(.top, 2)
                }
                .padding(12)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(item.answer)
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .lineSpacing(4)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: theme.radiusSM, style: .continuous)
                .stroke(theme.glassBorder, lineWidth: 1)
        )
    }
}

#Preview {
    RightSidebarView(
        relatedDocs: [
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
                title: "Huduma Centre Locations",
                url: "https://example.com",
                type: .web,
                fileName: nil,
                fileFormat: "HTML",
                fileSize: nil,
                documentId: nil,
                labels: nil,
                confidence: 0.72
            )
        ],
        accessToken: nil
    )
    .frame(width: 300)
    .environment(ThemeManager())
    .environment(AppLocaleService.shared)
}
