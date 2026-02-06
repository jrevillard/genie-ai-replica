// QuickHelpButton.swift
// Model for Quick Help buttons in the chat view

import Foundation
import SwiftUI

struct QuickHelpButton: Identifiable, Equatable {
    let id: String
    let category: String?
    let labelKey: String
    let visibleTextKey: String
    let hiddenPromptKey: String
    let iconPath: String?
    let lightGradient: (start: String, end: String)?
    let darkGradient: (start: String, end: String)?
    let lightLabelColor: String?
    let darkLabelColor: String?
    let lightIconColor: String?
    let darkIconColor: String?

    var label: String {
        NSLocalizedString(labelKey, bundle: AppLocaleService.shared.localizedBundle, comment: "")
    }

    var visibleText: String {
        NSLocalizedString(visibleTextKey, bundle: AppLocaleService.shared.localizedBundle, comment: "")
    }

    var hiddenPrompt: String {
        NSLocalizedString(hiddenPromptKey, bundle: AppLocaleService.shared.localizedBundle, comment: "")
    }

    func gradient(for colorScheme: ColorScheme) -> LinearGradient {
        let colors: (start: String, end: String)
        if colorScheme == .dark, let dark = darkGradient {
            colors = dark
        } else if let light = lightGradient {
            colors = light
        } else {
            colors = ("#D3E0EA", "#A3BFFA")
        }

        return LinearGradient(
            colors: [Color(hex: colors.start), Color(hex: colors.end)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    func labelColor(for colorScheme: ColorScheme) -> Color {
        if colorScheme == .dark, let dark = darkLabelColor {
            return Color(hex: dark)
        }
        return Color(hex: lightLabelColor ?? "#1C2526")
    }

    func iconColor(for colorScheme: ColorScheme) -> Color {
        if colorScheme == .dark, let dark = darkIconColor {
            return Color(hex: dark)
        }
        return Color(hex: lightIconColor ?? "#4682B4")
    }

    static func == (lhs: QuickHelpButton, rhs: QuickHelpButton) -> Bool {
        lhs.id == rhs.id
    }

    // Default Quick Help buttons matching the Flutter config
    static let defaults: [QuickHelpButton] = [
        QuickHelpButton(
            id: "just-chat",
            category: nil,
            labelKey: "quickhelp.justChat",
            visibleTextKey: "quickhelp.justChatUserPrompt",
            hiddenPromptKey: "quickhelp.justChatPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#4F4F4F", "#333333"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "identity-civil",
            category: "1",
            labelKey: "quickhelp.applyForID",
            visibleTextKey: "quickhelp.applyForIDUserPrompt",
            hiddenPromptKey: "quickhelp.applyForIDPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#2C3E50", "#1A252F"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "taxes-revenue",
            category: "5",
            labelKey: "quickhelp.payTaxes",
            visibleTextKey: "quickhelp.payTaxesUserPrompt",
            hiddenPromptKey: "quickhelp.payTaxesPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#34495E", "#2C3E50"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "business-trade",
            category: "8",
            labelKey: "quickhelp.startBusiness",
            visibleTextKey: "quickhelp.startBusinessUserPrompt",
            hiddenPromptKey: "quickhelp.startBusinessPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#2E4053", "#212F3D"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "healthcare-social",
            category: "2",
            labelKey: "quickhelp.findHealthcare",
            visibleTextKey: "quickhelp.findHealthcareUserPrompt",
            hiddenPromptKey: "quickhelp.findHealthcarePrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#2980B9", "#1F618D"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "education-learning",
            category: "3",
            labelKey: "quickhelp.educationServices",
            visibleTextKey: "quickhelp.educationServicesUserPrompt",
            hiddenPromptKey: "quickhelp.educationServicesPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#1ABC9C", "#148F77"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "transportation-mobility",
            category: "7",
            labelKey: "quickhelp.transportLicenses",
            visibleTextKey: "quickhelp.transportLicensesUserPrompt",
            hiddenPromptKey: "quickhelp.transportLicensesPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#F39C12", "#B9770E"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "housing-urban",
            category: "9",
            labelKey: "quickhelp.housingPrograms",
            visibleTextKey: "quickhelp.housingProgramsUserPrompt",
            hiddenPromptKey: "quickhelp.housingProgramsPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#D35400", "#A04000"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        ),
        QuickHelpButton(
            id: "employment-labor",
            category: "4",
            labelKey: "quickhelp.findJobs",
            visibleTextKey: "quickhelp.findJobsUserPrompt",
            hiddenPromptKey: "quickhelp.findJobsPrompt",
            iconPath: nil,
            lightGradient: ("#D3E0EA", "#A3BFFA"),
            darkGradient: ("#8E44AD", "#6C3483"),
            lightLabelColor: "#1C2526",
            darkLabelColor: "#FFFFFF",
            lightIconColor: "#4682B4",
            darkIconColor: "#FFFFFF"
        )
    ]
}
