// ConfirmDialog.swift
// Reusable confirmation dialog

import SwiftUI

struct ConfirmDialog: View {
    @Environment(ThemeManager.self) private var theme

    let title: String
    let message: String
    let confirmText: String?
    let cancelText: String?
    let isDestructive: Bool
    var onConfirm: () -> Void
    var onCancel: () -> Void

    init(
        title: String,
        message: String,
        confirmText: String? = nil,
        cancelText: String? = nil,
        isDestructive: Bool = false,
        onConfirm: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        self.message = message
        self.confirmText = confirmText
        self.cancelText = cancelText
        self.isDestructive = isDestructive
        self.onConfirm = onConfirm
        self.onCancel = onCancel
    }

    var body: some View {
        VStack(spacing: 20) {
            // Title
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)

            // Message
            Text(message)
                .font(.subheadline)
                .foregroundColor(theme.secondaryTextColor)
                .multilineTextAlignment(.center)

            // Buttons
            HStack(spacing: 16) {
                Button(action: onCancel) {
                    Text(cancelText ?? String(localized: "Cancel"))
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.gray.opacity(0.2))
                        .foregroundColor(theme.primaryTextColor)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                }
                .hapticOnTap(theme: theme)

                Button(action: onConfirm) {
                    Text(confirmText ?? String(localized: "Confirm"))
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(isDestructive ? Color.red : theme.primaryColor)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
                }
                .hapticOnTap(.medium, theme: theme)
            }
        }
        .padding(24)
        .glassCardElevated(theme: theme)
        .padding(32)
    }
}

// MARK: - View Modifier for Confirm Dialog

struct ConfirmDialogModifier: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let message: String
    let confirmText: String?
    let isDestructive: Bool
    var onConfirm: () -> Void

    func body(content: Content) -> some View {
        content
            .overlay {
                if isPresented {
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .ignoresSafeArea()
                        .onTapGesture {
                            isPresented = false
                        }

                    ConfirmDialog(
                        title: title,
                        message: message,
                        confirmText: confirmText,
                        isDestructive: isDestructive,
                        onConfirm: {
                            onConfirm()
                            isPresented = false
                        },
                        onCancel: {
                            isPresented = false
                        }
                    )
                }
            }
    }
}

extension View {
    func confirmDialog(
        isPresented: Binding<Bool>,
        title: String,
        message: String,
        confirmText: String? = nil,
        isDestructive: Bool = false,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(ConfirmDialogModifier(
            isPresented: isPresented,
            title: title,
            message: message,
            confirmText: confirmText,
            isDestructive: isDestructive,
            onConfirm: onConfirm
        ))
    }
}

#Preview {
    ConfirmDialog(
        title: "Delete Conversation?",
        message: "This action cannot be undone.",
        isDestructive: true,
        onConfirm: {},
        onCancel: {}
    )
    .environment(ThemeManager())
}
