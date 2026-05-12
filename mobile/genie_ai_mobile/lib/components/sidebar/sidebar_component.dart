import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/components/sidebar/service_tree_panel.dart';
import 'package:genie_ai_mobile/components/sidebar/chat_folders_panel.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N SERVICE

class SidebarComponent extends StatefulWidget {
  final Map<String, dynamic> user;

  final Function(Map<String, dynamic>)? onServiceSelected;
  final Function(String)? onConversationSelected;

  const SidebarComponent({
    super.key,
    required this.user,
    this.onServiceSelected,
    this.onConversationSelected,
  });

  @override
  State<SidebarComponent> createState() => _SidebarComponentState();
}

class _SidebarComponentState extends State<SidebarComponent>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _activeTab = "services";
  String _activeSubTab = "all";
  String _currentUserId = "";

  @override
  void initState() {
    super.initState();
    debugPrint("[SIDEBAR] Initializing Sidebar component...");

    final userData = widget.user['user'] ?? widget.user;
    _currentUserId = (userData['_key'] ?? userData['id'] ?? "").toString();

    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _activeTab = _tabController.index == 0 ? "services" : "history";
        });
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Widget _buildPrimaryTabs(ThemeData theme, Map<String, dynamic> colors) {
    final bool isDark = ThemeManager().isDarkMode;

    return Container(
      decoration: BoxDecoration(
        color: colors['surface'], // Dynamic Surface
        border: Border(
          bottom: BorderSide(
            color: colors['border'], // Dynamic Border
            width: 1,
          ),
        ),
      ),
      child: TabBar(
        controller: _tabController,
        labelColor: theme.primaryColor,
        unselectedLabelColor: isDark ? Colors.grey[400] : Colors.grey[600],
        indicatorColor: theme.primaryColor,
        indicatorSize: TabBarIndicatorSize.tab,
        labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        tabs: [
          Tab(
            icon: const Icon(Icons.category_outlined, size: 20),
            text: tr(
                "sidebar.governmentServices"), // "Wissensbereiche" / "Services"
            iconMargin: const EdgeInsets.only(bottom: 4),
          ),
          Tab(
            icon: const Icon(Icons.history, size: 20),
            text: tr("sidebar.chatHistory"), // "Chatverlauf" / "History"
            iconMargin: const EdgeInsets.only(bottom: 4),
          ),
        ],
      ),
    );
  }

  Widget _buildSubTabNavigation(ThemeData theme, Map<String, dynamic> colors) {
    final bool isDark = ThemeManager().isDarkMode;

    final List<Map<String, dynamic>> subTabs = [
      {
        'key': 'all',
        'label': tr('sidebar.tab.all'),
        'icon': Icons.chat_bubble_outline
      },
      {
        'key': 'folders',
        'label': tr('sidebar.tab.folders'),
        'icon': Icons.folder_outlined
      },
      {
        'key': 'starred',
        'label': tr('sidebar.tab.starred'),
        'icon': Icons.star_outline
      },
      {
        'key': 'archived',
        'label': tr('sidebar.tab.archived'),
        'icon': Icons.archive_outlined
      },
    ];

    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: colors['surface'], // Dynamic Surface
        border: Border(
          bottom: BorderSide(
            color: colors['border'], // Dynamic Border
            width: 1,
          ),
        ),
      ),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemCount: subTabs.length,
        itemBuilder: (context, index) {
          final tab = subTabs[index];
          final bool isActive = _activeSubTab == tab['key'];

          return InkWell(
            onTap: () {
              setState(() {
                _activeSubTab = tab['key'] as String;
              });
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: isActive ? theme.primaryColor : Colors.transparent,
                    width: 3,
                  ),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    tab['icon'] as IconData,
                    size: 16,
                    color: isActive
                        ? theme.primaryColor
                        : (isDark ? Colors.white60 : Colors.black54),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    tab['label'] as String,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: isActive ? FontWeight.bold : FontWeight.w600,
                      color: isActive
                          ? theme.primaryColor
                          : (isDark ? Colors.white70 : Colors.black54),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSidebarContent(BuildContext context, ThemeData theme) {
    final colors = ThemeManager().getColors();
    final bool isDark = ThemeManager().isDarkMode;

    // FIX: Replaced Container with Material to provide a valid render surface
    // for InkWells and avoid the "render box never laid out" hit test error.
    return Material(
      color: colors['background'], // Dynamic Background
      child: Column(
        children: [
          // Primary tabs
          _buildPrimaryTabs(theme, colors),

          // Main expandable content
          Expanded(
            child: Column(
              children: [
                if (_activeTab == "history")
                  _buildSubTabNavigation(theme, colors),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      ServiceTreePanel(
                        onSelectionChange: (selection) {
                          debugPrint(
                              "[SIDEBAR] Service selection changed: $selection");
                          widget.onServiceSelected?.call(selection);
                        },
                      ),
                      ChatFoldersPanel(
                        activeTab: _activeSubTab,
                        userId: _currentUserId,
                        onOpenChat: (convId) {
                          debugPrint("[SIDEBAR] Opening conversation: $convId");
                          widget.onConversationSelected?.call(convId);
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Weather footer
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: colors['border'])),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.wb_sunny_outlined,
                  size: 24,
                  color: isDark ? Colors.amber[200] : Colors.amber[600],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Weather desc might come from API later, hardcoded for now or use tr if generic
                      Text(
                        "24°C - ${tr('sidebar.weatherConditions.partlycloudy') != 'sidebar.weatherConditions.partlycloudy' ? tr('sidebar.weatherConditions.partlycloudy') : 'Mostly Sunny'}",
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: colors['text'], // Dynamic Text
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        // Handle missing key gracefully based on user feedback
                        tr("sidebar.weatherLocation") ==
                                'sidebar.weatherLocation'
                            ? "Current Location"
                            : tr("sidebar.weatherLocation"),
                        style: TextStyle(
                          fontSize: 11,
                          color: isDark ? Colors.grey[400] : Colors.grey[600],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bool isWideScreen = MediaQuery.of(context).size.width > 1200;

    // Persistent sidebar on wide screens
    if (isWideScreen) {
      return SizedBox(
        width: 420, // UPDATED: Increased width to 420 to fit translated tabs
        child: _buildSidebarContent(context, theme),
      );
    }

    // FIX: FULL WIDTH DRAWER FOR MOBILE
    // Use full screen width instead of a percentage or capped width
    final double drawerWidth = MediaQuery.of(context).size.width;

    // Mobile drawer: constrained to safe area below AppBar and above bottom input
    // We wrap the Drawer in a SizedBox to override the default narrow width.
    return SizedBox(
      width: drawerWidth,
      child: Drawer(
        elevation: 0,
        backgroundColor:
            Colors.transparent, // Important: no background on drawer itself
        child: SafeArea(
          top: false, // We manually handle top (AppBar height)
          bottom: true, // Respect bottom safe area (home indicator)
          child: Column(
            children: [
              // ADDED: GestureDetector to capture taps on the transparent header area
              // This allows the user to close the drawer by tapping the "visible" navbar
              GestureDetector(
                onTap: () {
                  // Standard way to close a Drawer
                  Navigator.of(context).pop();
                },
                behavior: HitTestBehavior
                    .translucent, // Catches taps even on transparent areas
                child: SizedBox(
                  // Space equal to AppBar height
                  height: kToolbarHeight + MediaQuery.of(context).padding.top,
                  width: double.infinity,
                ),
              ),
              // The actual sidebar content
              Expanded(
                child: _buildSidebarContent(context, theme),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
