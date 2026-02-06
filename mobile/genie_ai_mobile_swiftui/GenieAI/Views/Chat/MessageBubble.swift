// MessageBubble.swift
// Chat message bubble component with markdown rendering

import SwiftUI

struct MessageBubble: View {
    @Environment(ThemeManager.self) private var theme

    let message: Message
    var onFeedbackTapped: (() -> Void)?

    @State private var appeared = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if message.role.isUser {
                Spacer(minLength: 60)
            } else {
                // Bot Avatar
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(theme.navbarGradient)
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
                    .shadow(color: theme.primaryColor.opacity(0.15), radius: 6, y: 2)
            }

            VStack(alignment: message.role.isUser ? .trailing : .leading, spacing: 8) {
                // Message Content with Markdown
                Group {
                    if message.role.isUser {
                        Text(message.content)
                            .font(.body)
                            .foregroundColor(.white)
                    } else {
                        markdownContent(message.content)
                            .font(.body)
                            .foregroundColor(theme.primaryTextColor)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background {
                    if message.role.isUser {
                        UnevenRoundedRectangle(
                            topLeadingRadius: theme.radiusLG,
                            bottomLeadingRadius: theme.radiusLG,
                            bottomTrailingRadius: theme.radiusSM,
                            topTrailingRadius: theme.radiusLG
                        )
                        .fill(AnyShapeStyle(theme.navbarGradient))
                        .shadow(theme.shadowSoft)
                    } else {
                        UnevenRoundedRectangle(
                            topLeadingRadius: theme.radiusLG,
                            bottomLeadingRadius: theme.radiusSM,
                            bottomTrailingRadius: theme.radiusLG,
                            topTrailingRadius: theme.radiusLG
                        )
                        .fill(.ultraThinMaterial)
                        .overlay(
                            UnevenRoundedRectangle(
                                topLeadingRadius: theme.radiusLG,
                                bottomLeadingRadius: theme.radiusSM,
                                bottomTrailingRadius: theme.radiusLG,
                                topTrailingRadius: theme.radiusLG
                            )
                            .stroke(theme.glassBorder, lineWidth: 1)
                        )
                        .shadow(theme.shadowSoft)
                    }
                }

                // Sources (for assistant messages)
                if let sources = message.metadata?.sources, !sources.isEmpty {
                    SourcesView(sources: sources)
                }

                // Confidence Score (for assistant messages)
                if let confidence = message.confidence, message.role.isAssistant {
                    Text("Confidence: \(String(format: "%.1f", confidence * 100))%")
                        .font(.caption2)
                        .italic()
                        .foregroundColor(theme.secondaryTextColor)
                }

                // Feedback Button (for assistant messages)
                if message.role.isAssistant && message.queryId != nil {
                    HStack {
                        if message.feedbackSubmitted == true {
                            Text("Thank you for your feedback!")
                                .font(.caption)
                                .foregroundColor(theme.successColor)
                        } else {
                            Button(action: { onFeedbackTapped?() }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "hand.thumbsup")
                                    Text("Feedback")
                                }
                                .font(.caption)
                                .foregroundColor(theme.primaryColor)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule()
                                        .fill(theme.primaryColor.opacity(0.08))
                                )
                            }
                            .hapticOnTap(theme: theme)
                        }
                    }
                }

                // Timestamp
                Text(formatTime(message.timestamp))
                    .font(.caption2)
                    .foregroundColor(theme.secondaryTextColor)
            }

            if message.role.isUser {
                // User Avatar
                Image(systemName: "person.fill")
                    .font(.title3)
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(theme.primaryColor)
                    .clipShape(Circle())
            } else {
                Spacer(minLength: 60)
            }
        }
        .padding(.horizontal)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 12)
        .onAppear {
            withAnimation(theme.animationSmooth) {
                appeared = true
            }
        }
    }

    @ViewBuilder
    private func markdownContent(_ text: String) -> some View {
        if let attributedString = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            Text(attributedString)
                .textSelection(.enabled)
        } else {
            Text(text)
                .textSelection(.enabled)
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Sources View

struct SourcesView: View {
    @Environment(ThemeManager.self) private var theme

    let sources: [MessageMetadata.DocumentSource]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(sources.prefix(3)) { source in
                if let urlString = source.url, let url = URL(string: urlString) {
                    Link(destination: url) {
                        HStack(spacing: 4) {
                            Image(systemName: "link")
                            Text(source.title ?? urlString)
                                .lineLimit(1)
                        }
                        .font(.caption)
                        .foregroundColor(theme.primaryColor)
                    }
                }
            }
        }
        .padding(.horizontal, 8)
    }
}

// MARK: - Corner Radius Extension

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

#Preview {
    VStack {
        MessageBubble(
            message: Message(
                role: .user,
                content: "Hello, how can I apply for a national ID?"
            )
        )

        MessageBubble(
            message: Message(
                role: .assistant,
                content: "To apply for a **national ID** in Kenya, you'll need to visit your nearest *Huduma Centre* with:\n\n1. Birth certificate\n2. Copies of parents' IDs\n\nFor more info, visit [Huduma](https://example.com).",
                queryId: "123",
                confidence: 0.95
            ),
            onFeedbackTapped: {}
        )
    }
    .environment(ThemeManager())
}
