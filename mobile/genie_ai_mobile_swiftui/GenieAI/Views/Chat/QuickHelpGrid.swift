// QuickHelpGrid.swift
// Grid of quick help buttons

import SwiftUI

struct QuickHelpGrid: View {
    @Environment(ThemeManager.self) private var theme

    var onButtonTapped: (QuickHelpButton) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(QuickHelpButton.defaults) { button in
                QuickHelpButtonView(button: button) {
                    onButtonTapped(button)
                }
            }
        }
    }
}

struct QuickHelpButtonView: View {
    @Environment(ThemeManager.self) private var theme

    let button: QuickHelpButton
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .font(.system(size: 16))
                    .foregroundColor(theme.primaryColor)

                Text(button.label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(theme.primaryTextColor)
                    .lineLimit(1)

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous)
                    .fill(theme.primaryColor.opacity(0.06))
            )
            .clipShape(RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: theme.radiusMD, style: .continuous)
                    .stroke(theme.glassBorder, lineWidth: 1)
            )
            .shadow(theme.shadowSoft)
        }
        .buttonStyle(GlassPressButtonStyle(hapticsEnabled: theme.hapticsEnabled))
    }

    private var iconName: String {
        switch button.id {
        case "just-chat": return "message"
        case "identity-civil": return "person.text.rectangle"
        case "taxes-revenue": return "dollarsign.circle"
        case "business-trade": return "briefcase"
        case "healthcare-social": return "heart.text.square"
        case "education-learning": return "graduationcap"
        case "transportation-mobility": return "car"
        case "housing-urban": return "house"
        case "employment-labor": return "briefcase.fill"
        default: return "questionmark.circle"
        }
    }
}

#Preview {
    ScrollView {
        QuickHelpGrid(onButtonTapped: { button in
            print("Tapped: \(button.label)")
        })
        .padding()
    }
    .environment(ThemeManager())
}
