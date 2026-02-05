// ConfigService.swift
// Loads and provides access to genie-ai-config.json

import Foundation

struct AppConfig: Codable {
    let app: AppInfo
    let theme: ThemeConfig
    let features: FeaturesConfig?
    let custom: [String: AnyCodable]?

    struct AppInfo: Codable {
        let title: String
        let icon: IconConfig

        struct IconConfig: Codable {
            let type: String
            let value: String
        }
    }

    struct ThemeConfig: Codable {
        let primaryColor: String
        let secondaryColor: String
        let backgroundColor: String?
        let textColor: String?
        let navbar: NavbarConfig

        struct NavbarConfig: Codable {
            let gradientStart: String
            let gradientEnd: String
            let textColor: String
        }
    }

    struct FeaturesConfig: Codable {
        let chat: ChatConfig?

        struct ChatConfig: Codable {
            let welcomeMessage: String?
            let botName: String?
            let quickHelp: QuickHelpConfig?

            struct QuickHelpConfig: Codable {
                let layout: LayoutConfig?
                let defaults: DefaultsConfig?
                let buttons: [QuickHelpButtonConfig]?

                struct LayoutConfig: Codable {
                    let columns: Int?
                    let gapX: String?
                    let gapY: String?
                    let childAspectRatio: Double?
                }

                struct DefaultsConfig: Codable {
                    let height: String?
                    let fontSize: String?
                    let borderRadius: String?
                    let showShadow: Bool?
                    let showBorder: Bool?
                }

                struct QuickHelpButtonConfig: Codable {
                    let id: String
                    let category: String?
                    let action: ActionConfig
                    let appearance: AppearanceConfig?

                    struct ActionConfig: Codable {
                        let visibleText: String
                        let hiddenPrompt: String
                    }

                    struct AppearanceConfig: Codable {
                        let label: LabelConfig?
                        let icon: IconConfig?
                        let style: StyleConfig?
                        let darkMode: DarkModeConfig?

                        struct LabelConfig: Codable {
                            let text: String?
                            let color: String?
                        }

                        struct IconConfig: Codable {
                            let value: String?
                            let color: String?
                        }

                        struct StyleConfig: Codable {
                            let background: BackgroundConfig?

                            struct BackgroundConfig: Codable {
                                let gradient: GradientConfig?

                                struct GradientConfig: Codable {
                                    let start: String?
                                    let end: String?
                                    let direction: String?
                                }
                            }
                        }

                        struct DarkModeConfig: Codable {
                            let label: LabelConfig?
                            let icon: IconConfig?
                            let style: StyleConfig?
                        }
                    }
                }
            }
        }
    }
}

// Helper for encoding/decoding arbitrary JSON
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let intValue = try? container.decode(Int.self) {
            value = intValue
        } else if let doubleValue = try? container.decode(Double.self) {
            value = doubleValue
        } else if let stringValue = try? container.decode(String.self) {
            value = stringValue
        } else if let boolValue = try? container.decode(Bool.self) {
            value = boolValue
        } else if let arrayValue = try? container.decode([AnyCodable].self) {
            value = arrayValue.map { $0.value }
        } else if let dictValue = try? container.decode([String: AnyCodable].self) {
            value = dictValue.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let intValue as Int:
            try container.encode(intValue)
        case let doubleValue as Double:
            try container.encode(doubleValue)
        case let stringValue as String:
            try container.encode(stringValue)
        case let boolValue as Bool:
            try container.encode(boolValue)
        case let arrayValue as [Any]:
            try container.encode(arrayValue.map { AnyCodable($0) })
        case let dictValue as [String: Any]:
            try container.encode(dictValue.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}

@Observable
class ConfigService {
    static let shared = ConfigService()

    private(set) var config: AppConfig?
    private(set) var isLoaded = false

    var appTitle: String {
        config?.app.title ?? "Genie AI"
    }

    var welcomeMessage: String {
        config?.features?.chat?.welcomeMessage ?? "Welcome to Genie AI!"
    }

    var botName: String {
        config?.features?.chat?.botName ?? "Genie AI"
    }

    var primaryColor: String {
        config?.theme.primaryColor ?? "#4682B4"
    }

    var secondaryColor: String {
        config?.theme.secondaryColor ?? "#5F9EA0"
    }

    var backgroundColor: String {
        config?.theme.backgroundColor ?? "#D3E0EA"
    }

    var textColor: String {
        config?.theme.textColor ?? "#1C2526"
    }

    var navbarGradientStart: String {
        config?.theme.navbar.gradientStart ?? "#4682B4"
    }

    var navbarGradientEnd: String {
        config?.theme.navbar.gradientEnd ?? "#5F9EA0"
    }

    var navbarTextColor: String {
        config?.theme.navbar.textColor ?? "#F0F8FF"
    }

    var quickHelpButtons: [AppConfig.FeaturesConfig.ChatConfig.QuickHelpConfig.QuickHelpButtonConfig] {
        config?.features?.chat?.quickHelp?.buttons ?? []
    }

    private init() {
        loadConfig()
    }

    private func loadConfig() {
        guard let url = Bundle.main.url(forResource: "genie-ai-config", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            print("[ConfigService] Failed to load config file")
            return
        }

        do {
            config = try JSONDecoder().decode(AppConfig.self, from: data)
            isLoaded = true
            print("[ConfigService] Config loaded successfully")
        } catch {
            print("[ConfigService] Failed to decode config: \(error)")
        }
    }
}
