import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

class ServiceTreePanel extends ConsumerStatefulWidget {
  final String locale;
  final Function(Map<String, dynamic> selection) onSelectionChange;

  const ServiceTreePanel({
    super.key,
    this.locale = 'en',
    required this.onSelectionChange,
  });

  @override
  ConsumerState<ServiceTreePanel> createState() => _ServiceTreePanelState();
}

class _ServiceTreePanelState extends ConsumerState<ServiceTreePanel> {
  // Input Controller
  final TextEditingController _searchController = TextEditingController();

  // ===========================================================================
  // COMPONENT STATE
  // ===========================================================================

  // Raw data from API
  List<dynamic> _nodes = [];

  // Visual Selection Tracking
  // Maps Category Key -> List of Selected Child Indices
  // Example: { 'category_1': [0, 2], 'category_5': [1] }
  final Map<String, List<int>> _selectedNodes = {};

  // Logic Selection Tracking
  // Keeps track of the exact order of selection to determine the "Primary" category
  // and to construct the comma-separated context string.
  final List<Map<String, dynamic>> _orderedSelection = [];

  // UI State
  bool _isLoading = true;
  String? _errorMessage;

  // Search State
  String _searchQuery = "";
  Timer? _searchDebounce;

  // Locale Tracking to trigger re-fetch on language change
  String _lastLoadedLocale = "";

  @override
  void initState() {
    super.initState();
    debugPrint("[SERVICE_TREE] Component initialized. Loading categories...");
    // Initial load happens via the check in build() or here.
    // We let build() handle it to ensure consistency with I18nService.
  }

  @override
  void dispose() {
    _searchController.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  // ===========================================================================
  // DATA LOADING METHODS
  // ===========================================================================

  Future<void> _loadCategories() async {
    final currentLocale = I18nService().currentLocale.languageCode;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _lastLoadedLocale = currentLocale;
    });

    try {
      debugPrint(
        "[SERVICE_TREE] Fetching categories for locale: $currentLocale",
      );

      // Fetch categories using the OpenAPI-generated ServiceCategoriesApi
      final categoriesApi = ref.read(serviceCategoriesApiProvider);
      final response = await categoriesApi
          .apiServiceCategoriesCategoriesGetWithHttpInfo(locale: currentLocale);

      if (response.statusCode == 200) {
        final categories = jsonDecode(response.body) as List<dynamic>;

        if (mounted) {
          setState(() {
            _nodes = categories;
            _isLoading = false;
          });
          debugPrint(
            "[SERVICE_TREE] Successfully loaded ${_nodes.length} categories.",
          );
        }
      } else {
        throw Exception('Failed to load categories: ${response.statusCode}');
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = tr("userProfile.errors.loadingFailed");
          _isLoading = false;
        });
        debugPrint("[SERVICE_TREE] Error loading categories: $e");
      }
    }
  }

  void _onSearchChanged(String query) {
    if (_searchDebounce?.isActive ?? false) _searchDebounce!.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      setState(() {
        _searchQuery = query.toLowerCase();
      });
    });
  }

  // ===========================================================================
  // SELECTION LOGIC (MULTI-SELECT & CONTEXT AWARE)
  // ===========================================================================

  // FIX: Added catKey parameter to ensure visual state matches logic state
  void _toggleChildSelection(
    Map<String, dynamic> category,
    dynamic serviceItem,
    int index,
    String catKey,
  ) {
    // 1. The category id IS the tree's catKey — the parameter is extracted
    // from the same node this handler was invoked for. Reading the raw
    // node's 'id'/'key' yields an empty string (the tree publishes neither)
    // and every selection then carried an EMPTY category id: the chat read
    // it as "no scope" and the query left unfiltered.
    final String categoryId = catKey;

    // 2. Normalize Service Data (Handling the String vs Map crash)
    String serviceId;
    String serviceName;
    // The ENGLISH translation — the SSOT the filter wire speaks. The
    // localized name is display-only.
    String serviceEn = "";

    if (serviceItem is Map) {
      serviceId = (serviceItem['id'] ?? serviceItem['key'] ?? "").toString();
      serviceName = serviceItem['label'] ?? serviceItem['name'] ?? "Unknown";
      final en = serviceItem['nameEN'];
      serviceEn = (en is String) ? en : "";
    } else {
      // Handle simple string case
      serviceId = serviceItem.toString();
      serviceName = serviceItem.toString();
    }

    // 3. Update Selection State
    // Check if this specific item is already selected. The children
    // carry no id/key, so their identity is the (category, label) pair:
    // matching on the name alone crossed the categories — two services
    // named alike in different categories toggled each other's scope,
    // and the highlight desynced from what the chat received.
    //
    // The ENGLISH label is the identity, the same spelling the web keys
    // on: a DISPLAY name is not unique — the tree falls back to the
    // English name for an entity the locale has no translation for, so
    // two entities in one category can read the same — and the English
    // label is what the wire speaks.
    //
    // The tapped row picks the key, and the stored row must answer in
    // the SAME key space (the web's one-predicate rule): an entity with
    // no English label at all carries none (it will refuse at send,
    // visibly), so the display name stands in for it — and a stored row
    // that HAS an English label is never matched on its display name.
    final existingIndex = _orderedSelection.indexWhere(
      (item) =>
          (item['id'] == serviceId && serviceId.isNotEmpty) ||
          (serviceEn.isNotEmpty
              ? item['nameEn'] == serviceEn && item['category_id'] == categoryId
              : item['name'] == serviceName &&
                    item['category_id'] == categoryId &&
                    (item['nameEn'] as String? ?? '').isEmpty),
    );

    setState(() {
      if (existingIndex >= 0) {
        // --- DESELECT (REMOVE) ---
        _orderedSelection.removeAt(existingIndex);

        // Update visual highlights
        if (_selectedNodes.containsKey(catKey)) {
          _selectedNodes[catKey]!.remove(index);
          // Clean up empty keys
          if (_selectedNodes[catKey]!.isEmpty) {
            _selectedNodes.remove(catKey);
          }
        }
      } else {
        // --- SELECT (ADD) ---
        // Add to ordered list to preserve "First Selected" priority
        _orderedSelection.add({
          'id': serviceId,
          'name': serviceName,
          'nameEn': serviceEn,
          'category_id': categoryId,
          'categoryNameEn': (category['nameEN'] is String)
              ? category['nameEN']
              : "",
        });

        // Update visual highlights
        if (!_selectedNodes.containsKey(catKey)) {
          _selectedNodes[catKey] = [];
        }
        if (!_selectedNodes[catKey]!.contains(index)) {
          _selectedNodes[catKey]!.add(index);
        }
      }
    });

    // 4. Construct Payload and Emit
    _emitSelectionChange();
  }

  void _emitSelectionChange() {
    // Case A: Nothing selected -> Clear context
    if (_orderedSelection.isEmpty) {
      widget.onSelectionChange({
        'id': '',
        'name': '',
        'category_id': '',
        'categoryNameEn': '',
        'serviceLabelsEn': const <String>[],
        'serviceCount': 0,
      });
      return;
    }

    // Case B: Selection Active
    final String contextString = _orderedSelection
        .map((item) => item['name'])
        .join(', ');

    final List<String> serviceLabelsEn = _orderedSelection
        .map((item) => item['nameEn'])
        .where((en) => en != null && en.toString().isNotEmpty)
        .cast<String>()
        .toList();

    final String primaryCatId = _orderedSelection.first['category_id'];

    final String combinedIds = _orderedSelection
        .map((item) => item['id'])
        .join(',');

    final payload = {
      'id': combinedIds,
      'name': contextString,
      'category_id': primaryCatId,
      'categoryNameEn': _orderedSelection.first['categoryNameEn'],
      'serviceLabelsEn': serviceLabelsEn,
      // How many services were picked, beside the labels that survived:
      // a picked service with no EN translation contributes no label, and
      // the chat must refuse the send instead of quietly narrowing the
      // query to the whole category.
      'serviceCount': _orderedSelection.length,
    };

    debugPrint("[SERVICE_TREE] Emitting Multi-Selection: $payload");
    widget.onSelectionChange(payload);
  }

  // ===========================================================================
  // UI BUILDERS
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    // Check for language change and trigger reload if necessary
    final currentLocale = I18nService().currentLocale.languageCode;
    if (_lastLoadedLocale != currentLocale) {
      // Use addPostFrameCallback to avoid state changes during build
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _loadCategories();
      });
    }

    if (_isLoading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: ThemeManager().tokens.brand),
            const SizedBox(height: DsSpacing.md),
            // REMOVED defaultValue
            Text(tr("common.loading"), style: TextStyle(color: tokens.muted)),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(DsSpacing.xl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.error_outline, size: 48, color: tokens.danger),
              const SizedBox(height: DsSpacing.md),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: TextStyle(color: tokens.muted),
              ),
              const SizedBox(height: 16),
              DsButton(
                label: tr("settings.retry"),
                icon: Icons.refresh,
                variant: DsButtonVariant.secondary,
                onPressed: _loadCategories,
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        _buildSearchBar(),
        Expanded(child: _buildTreeList()),
      ],
    );
  }

  Widget _buildSearchBar() {
    final tokens = ThemeManager().tokens;

    return Container(
      padding: const EdgeInsets.all(DsSpacing.md),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.border)),
      ),
      child: TextField(
        controller: _searchController,
        style: TextStyle(color: tokens.fg),
        decoration: InputDecoration(
          // REMOVED defaultValue
          hintText: tr("sidebar.searchPlaceholder"),
          hintStyle: TextStyle(color: tokens.muted),
          prefixIcon: Icon(Icons.search, color: tokens.muted),
          filled: true,
          fillColor: tokens.muted20,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(DsRadii.md),
            borderSide: BorderSide.none,
          ),
          contentPadding: const EdgeInsets.symmetric(
            vertical: 0,
            horizontal: DsSpacing.md,
          ),
          isDense: true,
        ),
        onChanged: _onSearchChanged,
      ),
    );
  }

  Widget _buildTreeList() {
    if (_nodes.isEmpty) {
      // REMOVED defaultValue
      return Center(child: Text(tr("sidebar.noServices")));
    }

    return ListView.builder(
      padding: EdgeInsets.zero,
      itemCount: _nodes.length,
      itemBuilder: (context, i) {
        final category = _nodes[i];
        return _buildCategoryItem(category, i);
      },
    );
  }

  Widget _buildCategoryItem(Map<String, dynamic> category, int index) {
    // Safe Property Access
    final String catLabel =
        category['label'] ?? category['name'] ?? "Unknown Category";
    final String catKey =
        (category['catKey'] ?? category['key'] ?? category['id'] ?? index)
            .toString();
    final List children = category['children'] ?? [];

    // Filter Children based on Search Query
    // The filtered list keeps each child's ORIGINAL index: the selection
    // (_selectedNodes) is tracked by that index, and a list whose
    // composition changes with the search would point the highlight and
    // the deselection at the wrong rows.
    final filteredChildren = children.asMap().entries.where((entry) {
      final child = entry.value;
      // An entity with no display name in this locale has nothing to
      // offer: the web hides it, and offering it here would let the user
      // pick a scope that is guaranteed to fail the send.
      if (child is Map &&
          (child['name'] == null || child['name'].toString().isEmpty)) {
        return false;
      }
      if (_searchQuery.isEmpty) return true;

      String name;
      if (child is Map) {
        name = (child['label'] ?? child['name'] ?? "").toString();
      } else {
        name = child.toString();
      }

      return name.toLowerCase().contains(_searchQuery);
    }).toList();

    // Hide Category if no matches found
    if (_searchQuery.isNotEmpty && filteredChildren.isEmpty) {
      return const SizedBox.shrink();
    }

    // Determine if category should be expanded
    final bool hasSelection =
        _selectedNodes.containsKey(catKey) &&
        _selectedNodes[catKey]!.isNotEmpty;
    final bool shouldExpand = _searchQuery.isNotEmpty || hasSelection;

    final tokens = ThemeManager().tokens;

    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        key: Key("cat_$catKey"),
        initiallyExpanded: shouldExpand,

        // Header Styling
        title: Text(
          catLabel,
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: ThemeManager().tokens.textBase,
            color: tokens.fg,
          ),
        ),
        leading: Icon(Icons.folder_open, color: tokens.brand, size: 20),
        childrenPadding: EdgeInsets.zero,

        // Children Generation — the FILTERED list, each child carrying
        // its ORIGINAL index: an entity with no display name in this
        // locale is not offered (the web hides it too), and the selection
        // keeps pointing at the row it was made on whatever the filter
        // hides.
        children: filteredChildren.map((entry) {
          return _buildServiceItem(category, entry.value, entry.key, catKey);
        }).toList(),
      ),
    );
  }

  Widget _buildServiceItem(
    Map<String, dynamic> category,
    dynamic serviceItem,
    int index,
    String catKey,
  ) {
    // Normalize Data (String vs Map)
    String serviceName;
    if (serviceItem is Map) {
      serviceName =
          serviceItem['label'] ?? serviceItem['name'] ?? "Unknown Service";
    } else {
      serviceName = serviceItem.toString();
    }

    // Final Search Check (Double check for visual filtering)
    if (_searchQuery.isNotEmpty &&
        !serviceName.toLowerCase().contains(_searchQuery)) {
      return const SizedBox.shrink();
    }

    // Check Selection Status
    final bool isSelected = _selectedNodes[catKey]?.contains(index) ?? false;
    final bool isSearchMatch = _searchQuery.isNotEmpty;
    final tokens = ThemeManager().tokens;

    // Render Tile
    return Container(
      // FIX: Added margin for better touch area and visual separation when selected
      margin: const EdgeInsets.symmetric(
        vertical: DsSpacing.xs,
        horizontal: DsSpacing.sm,
      ),
      decoration: BoxDecoration(
        // FIX: Solid Primary color when selected (Standard Button Color)
        color: isSelected ? tokens.brand : Colors.transparent,
        borderRadius: BorderRadius.circular(DsRadii.md),
      ),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.only(left: 48, right: DsSpacing.md),
        visualDensity: const VisualDensity(vertical: -2),

        title: Text(
          serviceName,
          style: TextStyle(
            fontSize: ThemeManager().tokens.textSm,
            color: isSelected ? tokens.accentFg : tokens.fg,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),

        subtitle: isSearchMatch
            ? Text(
                tr("sidebar.matchFound"),
                style: TextStyle(
                  fontSize: ThemeManager().tokens.textXs,
                  color: isSelected ? tokens.fg70 : tokens.muted,
                ),
              )
            : null,

        trailing: isSelected
            ? Icon(Icons.check_circle, size: 16, color: tokens.accentFg)
            : null,

        // Tap Handler - Passes the raw serviceItem AND catKey to logic
        onTap: () =>
            _toggleChildSelection(category, serviceItem, index, catKey),
      ),
    );
  }
}
