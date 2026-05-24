// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../features/today/presentation/screens/today_hub.dart';
import '../features/insights/presentation/screens/insights_screen.dart';
import '../features/progress/presentation/screens/progress_screen.dart';
import '../features/me/presentation/screens/me_screen.dart';
import '../features/caregiver/presentation/screens/caregiver_screen.dart';
import 'providers/tab_provider.dart';

class MainNavigation extends ConsumerStatefulWidget {
  final int initialIndex;
  const MainNavigation({super.key, this.initialIndex = 0});

  @override
  ConsumerState<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends ConsumerState<MainNavigation> {
  late int _selectedIndex;

  // RepaintBoundary around TodayHub isolates the BackdropFilter compositing
  // layer used by AminaChatBar's frosted-glass effect.  Without it, the
  // BackdropFilter's _ImageFilterRenderObject propagates compositing bits up
  // through the IndexedStack, causing "RenderBox was not laid out" exceptions
  // in sibling screens (ProgressScreen, etc.) on the first frame.
  static const List<Widget> _screens = [
    RepaintBoundary(child: TodayHub()),  // 0 — sealed compositing boundary
    InsightsScreen(),                    // 1
    ProgressScreen(),                    // 2
    CaregiverScreen(),                   // 3
    MeScreen(),                          // 4
  ];

  static const List<BottomNavigationBarItem> _navItems = [
    BottomNavigationBarItem(
      icon:       Icon(Icons.wb_sunny_outlined),
      activeIcon: Icon(Icons.wb_sunny),
      label:      'Today',
    ),
    BottomNavigationBarItem(
      icon:       Icon(Icons.auto_graph_outlined),
      activeIcon: Icon(Icons.auto_graph),
      label:      'Insights',
    ),
    BottomNavigationBarItem(
      icon:       Icon(Icons.emoji_events_outlined),
      activeIcon: Icon(Icons.emoji_events),
      label:      'Progress',
    ),
    BottomNavigationBarItem(
      icon:       Icon(Icons.volunteer_activism_outlined),
      activeIcon: Icon(Icons.volunteer_activism),
      label:      'Caregiver',
    ),
    BottomNavigationBarItem(
      icon:       Icon(Icons.person_outline),
      activeIcon: Icon(Icons.person),
      label:      'Me',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.initialIndex;
    // Sync the shared provider so external writers start from the right index.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(selectedTabProvider.notifier).state = _selectedIndex;
    });
  }

  void _onItemTapped(int index) {
    setState(() => _selectedIndex = index);
    ref.read(selectedTabProvider.notifier).state = index;
  }

  @override
  Widget build(BuildContext context) {
    // React to external tab-switch requests (e.g. profile icon in TodayHub).
    ref.listen<int>(selectedTabProvider, (_, newIndex) {
      if (newIndex != _selectedIndex) {
        setState(() => _selectedIndex = newIndex);
      }
    });

    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        type:                BottomNavigationBarType.fixed,
        currentIndex:        _selectedIndex,
        selectedItemColor:   const Color(0xFF3D9970),
        unselectedItemColor: Colors.grey,
        onTap:               _onItemTapped,
        items:               _navItems,
      ),
    );
  }
}
