import 'package:flutter/material.dart';
import 'dart:async';
import 'package:genie_ai_mobile/services/service_tree_proxy.dart';

class ServiceTreePanel extends StatefulWidget {
  final String locale;
  final Function(Map<String, dynamic> selection) onSelectionChange;

  const ServiceTreePanel({
    super.key,
    this.locale = 'en',
    required this.onSelectionChange,
  });

  @override
  State<ServiceTreePanel> createState() => _ServiceTreePanelState();
}

class _ServiceTreePanelState extends State<ServiceTreePanel> {
  // Service Proxy
  final ServiceTreeProxy _serviceTreeProxy = ServiceTreeProxy();

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
  Map<String, List<int>> _selectedNodes = {};

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

  @override
  void initState() {
    super.initState();
    debugPrint("[SERVICE_TREE] Component initialized. Loading categories...");
    _loadCategories();
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
    try {
      // Fetch categories using the correct proxy method
      final categories = await _serviceTreeProxy.getAllCategories();

      if (mounted) {
        setState(() {
          _nodes = categories;
          _isLoading = false;
        });
        debugPrint(
            "[SERVICE_TREE] Successfully loaded ${_nodes.length} categories.");
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage =
              "Failed to load services. Please check your connection.";
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

  void _toggleChildSelection(
      Map<String, dynamic> category, dynamic serviceItem, int index) {
    // 1. Safe Key Extraction for Category
    // API might return 'key' or 'id', or we might need to fallback
    final String catKey = (category['key'] ?? category['id'] ?? "").toString();
    final String categoryId =
        (category['id'] ?? category['key'] ?? "").toString();

    // 2. Normalize Service Data (Handling the String vs Map crash)
    // The API sometimes returns strings like "Mountains" directly in the children list.
    String serviceId;
    String serviceName;

    if (serviceItem is Map) {
      serviceId = (serviceItem['id'] ?? serviceItem['key'] ?? "").toString();
      serviceName = serviceItem['label'] ?? serviceItem['name'] ?? "Unknown";
    } else {
      // Handle simple string case
      serviceId = serviceItem.toString();
      serviceName = serviceItem.toString();
    }

    // 3. Update Selection State
    // Check if this specific item is already selected by ID/Name
    final existingIndex = _orderedSelection.indexWhere((item) =>
        (item['id'] == serviceId && serviceId.isNotEmpty) ||
        item['name'] == serviceName);

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
        _orderedSelection.add(
            {'id': serviceId, 'name': serviceName, 'category_id': categoryId});

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
      widget.onSelectionChange({'id': '', 'name': '', 'category_id': ''});
      return;
    }

    // Case B: Selection Active

    // 1. Context Label: Join all names (e.g., "Passport, Visa, Travel")
    final String contextString =
        _orderedSelection.map((item) => item['name']).join(', ');

    // 2. Primary Category: ALWAYS use the category of the FIRST selected item.
    // This tells the Chatbot which knowledge base to prioritize.
    final String primaryCatId = _orderedSelection.first['category_id'];

    // 3. Combined IDs: Comma-separated list of IDs (if available)
    final String combinedIds =
        _orderedSelection.map((item) => item['id']).join(',');

    final payload = {
      'id': combinedIds,
      'name': contextString,
      'category_id': primaryCatId
    };

    debugPrint("[SERVICE_TREE] Emitting Multi-Selection: $payload");
    widget.onSelectionChange(payload);
  }

  // ===========================================================================
  // UI BUILDERS
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    // 1. Loading State
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text("Loading services...", style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
    }

    // 2. Error State
    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline,
                  size: 48, color: Colors.redAccent),
              const SizedBox(height: 16),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _loadCategories,
                icon: const Icon(Icons.refresh),
                label: const Text("Retry"),
              )
            ],
          ),
        ),
      );
    }

    // 3. Content State
    return Column(
      children: [
        _buildSearchBar(),
        Expanded(child: _buildTreeList()),
      ],
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: const EdgeInsets.all(12.0),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.black12)),
      ),
      child: TextField(
        controller: _searchController,
        decoration: InputDecoration(
          hintText: "Search services...",
          prefixIcon: const Icon(Icons.search, color: Colors.grey),
          filled: true,
          fillColor: Theme.of(context).brightness == Brightness.dark
              ? Colors.white10
              : Colors.grey[100],
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
          contentPadding:
              const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
          isDense: true,
        ),
        onChanged: _onSearchChanged,
      ),
    );
  }

  Widget _buildTreeList() {
    if (_nodes.isEmpty) {
      return const Center(child: Text("No services available"));
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
        (category['key'] ?? category['id'] ?? index).toString();
    final List children = category['children'] ?? [];

    // Filter Children based on Search Query
    final filteredChildren = children.where((child) {
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
    final bool hasSelection = _selectedNodes.containsKey(catKey) &&
        _selectedNodes[catKey]!.isNotEmpty;
    final bool shouldExpand = _searchQuery.isNotEmpty || hasSelection;

    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        key: Key("cat_$catKey"),
        initiallyExpanded: shouldExpand,

        // Header Styling
        title: Text(
          catLabel,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
        leading: Icon(
          Icons.folder_open,
          color: Theme.of(context).primaryColor,
          size: 20,
        ),
        childrenPadding: EdgeInsets.zero,

        // Children Generation
        children: children.asMap().entries.map((entry) {
          final int childIndex = entry.key;
          final dynamic child = entry.value; // dynamic to handle String or Map
          return _buildServiceItem(category, child, childIndex, catKey);
        }).toList(),
      ),
    );
  }

  Widget _buildServiceItem(Map<String, dynamic> category, dynamic serviceItem,
      int index, String catKey) {
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
    final theme = Theme.of(context);

    // Render Tile
    return Container(
      decoration: BoxDecoration(
        color: isSelected
            ? theme.primaryColor.withOpacity(0.1)
            : Colors.transparent,
        border: isSelected
            ? Border(left: BorderSide(color: theme.primaryColor, width: 3))
            : const Border(
                left: BorderSide(color: Colors.transparent, width: 3)),
      ),
      child: ListTile(
        dense: true,
        contentPadding: const EdgeInsets.only(left: 48, right: 16),
        visualDensity: const VisualDensity(vertical: -2),

        // Label
        title: Text(
          serviceName,
          style: TextStyle(
            fontSize: 13,
            color: isSelected
                ? theme.primaryColor
                : theme.textTheme.bodyMedium?.color,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),

        // Subtitle for Search Matches
        subtitle: isSearchMatch
            ? const Text("Match found",
                style: TextStyle(fontSize: 10, color: Colors.grey))
            : null,

        // Checkmark
        trailing: isSelected
            ? Icon(Icons.check_circle, size: 16, color: theme.primaryColor)
            : null,

        // Tap Handler - Passes the raw serviceItem to logic
        onTap: () => _toggleChildSelection(category, serviceItem, index),
      ),
    );
  }
}
