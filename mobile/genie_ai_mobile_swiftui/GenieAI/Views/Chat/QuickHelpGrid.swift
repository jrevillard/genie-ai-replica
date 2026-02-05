// QuickHelpGrid.swift
// Grid of quick help buttons

import SwiftUI

struct QuickHelpGrid: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(\.colorScheme) private var colorScheme

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
    @Environment(\.colorScheme) private var colorScheme

    let button: QuickHelpButton
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: iconName)
                    .font(.system(size: 16))
                    .foregroundColor(button.iconColor(for: colorScheme))

                Text(button.label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(button.labelColor(for: colorScheme))
                    .lineLimit(1)

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(button.gradient(for: colorScheme))
            .cornerRadius(8)
            .shadow(color: .black.opacity(0.15), radius: 3, x: 0, y: 2)
        }
        .buttonStyle(.plain)
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
