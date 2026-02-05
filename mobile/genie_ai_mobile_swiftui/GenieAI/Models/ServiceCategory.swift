// ServiceCategory.swift
// Service category model for the left sidebar service tree

import Foundation

struct ServiceCategory: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var description: String?
    var icon: String?
    var children: [ServiceItem]?
    var order: Int?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case key
        case plainId = "id"
        case name
        case label
        case description
        case icon
        case children
        case order
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        icon: String? = nil,
        children: [ServiceItem]? = nil,
        order: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.children = children
        self.order = order
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // API may return _id, id, or key
        if let mongoId = try? container.decode(String.self, forKey: .id) {
            id = mongoId
        } else if let plainId = try? container.decode(String.self, forKey: .plainId) {
            id = plainId
        } else if let key = try? container.decode(String.self, forKey: .key) {
            id = key
        } else {
            id = UUID().uuidString
        }

        // API may return name or label
        if let label = try? container.decode(String.self, forKey: .label) {
            name = label
        } else {
            name = (try? container.decode(String.self, forKey: .name)) ?? "Unknown"
        }

        description = try? container.decode(String.self, forKey: .description)
        icon = try? container.decode(String.self, forKey: .icon)
        order = try? container.decode(Int.self, forKey: .order)

        // Children may be ServiceItem objects or plain strings
        if let items = try? container.decode([ServiceItem].self, forKey: .children) {
            children = items
        } else if let strings = try? container.decode([String].self, forKey: .children) {
            children = strings.map { ServiceItem(name: $0, categoryId: id) }
        } else {
            children = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(icon, forKey: .icon)
        try container.encodeIfPresent(children, forKey: .children)
        try container.encodeIfPresent(order, forKey: .order)
    }

    static func == (lhs: ServiceCategory, rhs: ServiceCategory) -> Bool {
        lhs.id == rhs.id
    }
}

struct ServiceItem: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var description: String?
    var categoryId: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case key
        case plainId = "id"
        case name
        case label
        case description
        case categoryId = "category_id"
        case categoryIdCamel = "categoryId"
    }

    init(
        id: String = UUID().uuidString,
        name: String,
        description: String? = nil,
        categoryId: String? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.categoryId = categoryId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // API may return _id, id, or key
        if let mongoId = try? container.decode(String.self, forKey: .id) {
            id = mongoId
        } else if let plainId = try? container.decode(String.self, forKey: .plainId) {
            id = plainId
        } else if let key = try? container.decode(String.self, forKey: .key) {
            id = key
        } else {
            id = UUID().uuidString
        }

        // API may return name or label
        if let label = try? container.decode(String.self, forKey: .label) {
            name = label
        } else {
            name = (try? container.decode(String.self, forKey: .name)) ?? "Unknown"
        }

        description = try? container.decode(String.self, forKey: .description)

        // API may return category_id or categoryId
        if let catId = try? container.decode(String.self, forKey: .categoryId) {
            categoryId = catId
        } else {
            categoryId = try? container.decode(String.self, forKey: .categoryIdCamel)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encodeIfPresent(categoryId, forKey: .categoryIdCamel)
    }

    static func == (lhs: ServiceItem, rhs: ServiceItem) -> Bool {
        lhs.id == rhs.id
    }
}

// Label for categorizing and filtering
struct Label: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var color: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case name
        case color
    }

    init(id: String = UUID().uuidString, name: String, color: String? = nil) {
        self.id = id
        self.name = name
        self.color = color
    }

    static func == (lhs: Label, rhs: Label) -> Bool {
        lhs.id == rhs.id
    }
}
