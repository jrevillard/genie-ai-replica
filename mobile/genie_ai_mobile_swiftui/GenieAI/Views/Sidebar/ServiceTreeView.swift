// ServiceTreeView.swift
// Hierarchical display of service categories

import SwiftUI

struct ServiceTreeView: View {
    @Environment(ThemeManager.self) private var theme
    @Environment(I18nService.self) private var i18n

    @State private var serviceTreeService = ServiceTreeService()
    @State private var expandedCategories: Set<String> = []

    var searchText: String
    var onCategorySelected: ((ServiceCategory) -> Void)?
    var onServiceSelected: ((ServiceItem) -> Void)?

    var filteredCategories: [ServiceCategory] {
        if searchText.isEmpty {
            return serviceTreeService.categories
        }
        return serviceTreeService.categories.filter { category in
            category.name.localizedCaseInsensitiveContains(searchText) ||
            category.children?.contains { $0.name.localizedCaseInsensitiveContains(searchText) } == true
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if serviceTreeService.isLoading {
                    ProgressView()
                        .padding()
                } else if filteredCategories.isEmpty {
                    Text(i18n.translate("sidebar.noSearchResults", args: ["term": searchText]))
                        .font(.subheadline)
                        .foregroundColor(theme.secondaryTextColor)
                        .padding()
                } else {
                    ForEach(filteredCategories) { category in
                        CategoryRow(
                            category: category,
                            isExpanded: expandedCategories.contains(category.id),
                            searchText: searchText,
                            onToggle: {
                                withAnimation {
                                    if expandedCategories.contains(category.id) {
                                        expandedCategories.remove(category.id)
                                    } else {
                                        expandedCategories.insert(category.id)
                                    }
                                }
                            },
                            onCategoryTapped: { onCategorySelected?(category) },
                            onServiceTapped: { onServiceSelected?($0) }
                        )
                    }
                }
            }
        }
        .task {
            if serviceTreeService.categories.isEmpty {
                try? await serviceTreeService.getAllCategories(locale: i18n.currentLocale)
            }
        }
    }
}

struct CategoryRow: View {
    @Environment(ThemeManager.self) private var theme

    let category: ServiceCategory
    let isExpanded: Bool
    let searchText: String
    var onToggle: () -> Void
    var onCategoryTapped: () -> Void
    var onServiceTapped: ((ServiceItem) -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Category Header
            HStack {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundColor(theme.secondaryTextColor)
                    .frame(width: 20)

                Text(category.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(theme.primaryTextColor)

                Spacer()

                if let count = category.children?.count, count > 0 {
                    Text("\(count)")
                        .font(.caption2)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.primaryColor)
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .onTapGesture(count: 2, perform: onCategoryTapped)
            .onTapGesture(perform: onToggle)

            // Children (if expanded)
            if isExpanded, let children = category.children {
                ForEach(filteredChildren(children)) { service in
                    ServiceRow(service: service) {
                        onServiceTapped?(service)
                    }
                }
            }

            Divider()
                .padding(.leading)
        }
    }

    private func filteredChildren(_ children: [ServiceItem]) -> [ServiceItem] {
        if searchText.isEmpty {
            return children
        }
        return children.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }
}

struct ServiceRow: View {
    @Environment(ThemeManager.self) private var theme

    let service: ServiceItem
    var onTapped: () -> Void

    var body: some View {
        HStack {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundColor(theme.secondaryTextColor)

            Text(service.name)
                .font(.subheadline)
                .foregroundColor(theme.primaryTextColor)

            Spacer()
        }
        .padding(.leading, 40)
        .padding(.trailing)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onTapGesture(perform: onTapped)
    }
}

#Preview {
    ServiceTreeView(searchText: "")
        .environment(ThemeManager())
        .environment(I18nService())
}
