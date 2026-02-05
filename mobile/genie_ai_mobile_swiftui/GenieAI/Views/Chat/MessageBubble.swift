// MessageBubble.swift
// Chat message bubble component

import SwiftUI

struct MessageBubble: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    let message: Message
    var onFeedbackTapped: (() -> Void)?

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
                    .background(theme.secondarySurfaceColor)
                    .clipShape(Circle())
            }

            VStack(alignment: message.role.isUser ? .trailing : .leading, spacing: 8) {
                // Message Content
                Text(message.content)
                    .font(.body)
                    .foregroundColor(message.role.isUser ? .white : theme.primaryTextColor)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        message.role.isUser
                            ? AnyShapeStyle(theme.navbarGradient)
                            : AnyShapeStyle(theme.secondarySurfaceColor)
                    )
                    .cornerRadius(16, corners: message.role.isUser ? [.topLeft, .topRight, .bottomLeft] : [.topLeft, .topRight, .bottomRight])

                // Sources (for assistant messages)
                if let sources = message.metadata?.sources, !sources.isEmpty {
                    SourcesView(sources: sources)
                }

                // Feedback Button (for assistant messages)
                if message.role.isAssistant && message.queryId != nil {
                    HStack {
                        if message.feedbackSubmitted == true {
                            Text(i18n.translate("feedback.success"))
                                .font(.caption)
                                .foregroundColor(theme.successColor)
                        } else {
                            Button(action: { onFeedbackTapped?() }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "hand.thumbsup")
                                    Text(i18n.translate("feedback.button"))
                                }
                                .font(.caption)
                                .foregroundColor(theme.primaryColor)
                            }
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
                if let url = source.url {
                    Link(destination: URL(string: url)!) {
                        HStack(spacing: 4) {
                            Image(systemName: "link")
                            Text(source.title ?? url)
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
                content: "To apply for a national ID in Kenya, you'll need to visit your nearest Huduma Centre with your birth certificate and copies of your parents' IDs.",
                queryId: "123"
            ),
            onFeedbackTapped: {}
        )
    }
    .environment(ThemeManager())
    .environment(I18nService())
}
