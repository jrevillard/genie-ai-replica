import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/components/amina_header.dart';
import '../providers/insights_provider.dart';
import '../widgets/featured_post.dart';
import '../widgets/simple_post.dart';
import '../widgets/story_thumbnail_row.dart';
import '../../../../core/theme/app_theme.dart';

// Alert colours — data-identity (emergency severity), not theme-adaptive.
const _kCritical   = Color(0xFFDC2626);
const _kCriticalBg = Color(0xFFFEF2F2);

// ─── News post data model ─────────────────────────────────────────────────────

class _NewsPost {
  final String   id;
  final String   title;
  final String   description;
  final String?  imageUrl;
  final String   publisher;
  final String   filterTag;
  final String   category;
  final Color    categoryColor;
  final IconData categoryIcon;
  final bool     isUrgent;
  final String   timeAgo;
  final int      baseLikes;

  const _NewsPost({
    required this.id,
    required this.title,
    required this.description,
    this.imageUrl,
    required this.publisher,
    required this.filterTag,
    required this.category,
    required this.categoryColor,
    required this.categoryIcon,
    this.isUrgent  = false,
    required this.timeAgo,
    this.baseLikes = 0,
  });
}

const List<_NewsPost> _kPosts = [
  _NewsPost(
    id:            'post_1',
    title:         'Dengue Alert: Protect Your Household Now',
    description:   'Cases of dengue fever are rising in your district. Remove standing water from containers, use repellents, and wear long sleeves. Report symptoms early.',
    imageUrl:      'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?q=80&w=1080',
    publisher:     'Ministry of Health',
    filterTag:     'Ministry',
    category:      'ALERT',
    categoryColor: Color(0xFFDC2626),
    categoryIcon:  Icons.warning_amber_rounded,
    isUrgent:      true,
    timeAgo:       '2 hours ago',
    baseLikes:     142,
  ),
  _NewsPost(
    id:            'post_2',
    title:         'Free Health Screenings in Your Area',
    description:   'City General Hospital visits your neighbourhood this Friday. Free diabetes and blood-pressure checks available — no appointment needed.',
    imageUrl:      'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=1080',
    publisher:     'City General Hospital',
    filterTag:     'Hospital',
    category:      'EVENT',
    categoryColor: Color(0xFF059669),
    categoryIcon:  Icons.event_rounded,
    timeAgo:       '5 hours ago',
    baseLikes:     87,
  ),
  _NewsPost(
    id:            'post_3',
    title:         'Managing Diabetes: 5 Daily Habits That Work',
    description:   'Simple, evidence-based habits that help control blood sugar levels and reduce long-term complications.',
    publisher:     'Ministry of Health',
    filterTag:     'Ministry',
    category:      'EDUCATION',
    categoryColor: Color(0xFF1D4ED8),
    categoryIcon:  Icons.school_rounded,
    timeAgo:       'Yesterday',
    baseLikes:     213,
  ),
  _NewsPost(
    id:            'post_4',
    title:         'Know Your Heart Risk — New Guidelines Released',
    description:   'Updated cardiovascular risk assessment guidelines for adults over 50, covering diet, exercise, and early screening.',
    publisher:     'Heart Health Foundation',
    filterTag:     'Advisory',
    category:      'ADVISORY',
    categoryColor: Color(0xFFD97706),
    categoryIcon:  Icons.health_and_safety_rounded,
    timeAgo:       '2 days ago',
    baseLikes:     56,
  ),
];

// ─── Filter chip options ──────────────────────────────────────────────────────

class _FilterOption {
  final String  label;
  final String? tag;
  const _FilterOption(this.label, [this.tag]);
}

const List<_FilterOption> _kFilters = [
  _FilterOption('All'),
  _FilterOption('Ministry', 'Ministry'),
  _FilterOption('Hospital', 'Hospital'),
  _FilterOption('Advisory', 'Advisory'),
  _FilterOption('Saved'),
];

// ─── InsightsScreen ───────────────────────────────────────────────────────────

class InsightsScreen extends ConsumerStatefulWidget {
  const InsightsScreen({super.key});

  @override
  ConsumerState<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends ConsumerState<InsightsScreen> {
  int _selectedFilter = 0;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _searchCtrl.addListener(() {
      ref.read(insightsProvider.notifier).setSearch(_searchCtrl.text);
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<_NewsPost> _computePosts(InsightsState state) {
    final isSavedFilter = _kFilters[_selectedFilter].label == 'Saved';
    final tag           = _kFilters[_selectedFilter].tag;

    var posts = _kPosts.toList();

    if (isSavedFilter) {
      posts = posts.where((p) => state.isSaved(p.id)).toList();
    } else if (tag != null) {
      posts = posts.where((p) => p.filterTag == tag).toList();
    }

    final q = state.searchQuery;
    if (q.isNotEmpty) {
      posts = posts.where((p) =>
        p.title.toLowerCase().contains(q)       ||
        p.description.toLowerCase().contains(q) ||
        p.publisher.toLowerCase().contains(q)   ||
        p.category.toLowerCase().contains(q)
      ).toList();
    }

    return posts;
  }

  @override
  Widget build(BuildContext context) {
    final state    = ref.watch(insightsProvider);
    final notifier = ref.read(insightsProvider.notifier);
    final posts    = _computePosts(state);
    final cs       = Theme.of(context).colorScheme;
    final amina    = Theme.of(context).extension<AminaColors>()!;

    return Scaffold(
      backgroundColor: amina.scaffoldBg,
      appBar: const AminaHeader(title: 'Health Insights'),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [

            // ── 1. Critical Alert Banner ───────────────────────────────────
            const _CriticalAlertBanner(),

            // ── 2. Interactive Health Stories ──────────────────────────────
            const SizedBox(height: 28),
            const StoryThumbnailRow(),

            // ── 3. Official Broadcasts ─────────────────────────────────────
            const SizedBox(height: 32),

            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
              child: Row(
                children: [
                  Text(
                    'Official Broadcasts',
                    style: TextStyle(
                      fontSize:   20,
                      fontWeight: FontWeight.bold,
                      color:      cs.onSurface,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color:        cs.primaryContainer,
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.verified_rounded, color: cs.primary, size: 12),
                        const SizedBox(width: 3),
                        Text(
                          'Verified',
                          style: TextStyle(
                            color:      cs.primary,
                            fontSize:   10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Saved count badge
                  if (state.savedIds.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    GestureDetector(
                      onTap: () => setState(() => _selectedFilter = _kFilters.length - 1),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color:        const Color(0xFFF5F3FF),
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.bookmark_rounded,
                                color: Color(0xFF7C3AED), size: 11),
                            const SizedBox(width: 3),
                            Text(
                              '${state.savedIds.length} saved',
                              style: const TextStyle(
                                color:      Color(0xFF7C3AED),
                                fontSize:   10,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),

            const SizedBox(height: 14),

            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: _SearchBar(controller: _searchCtrl),
            ),

            const SizedBox(height: 10),

            _PostFilterRow(
              selectedIndex: _selectedFilter,
              onChanged:     (i) => setState(() => _selectedFilter = i),
            ),

            const SizedBox(height: 18),

            if (posts.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 48),
                child: Center(
                  child: Column(
                    children: [
                      Icon(
                        _selectedFilter == _kFilters.length - 1
                            ? Icons.bookmark_border_rounded
                            : Icons.search_off_rounded,
                        color: cs.onSurfaceVariant.withValues(alpha: 0.35),
                        size:  48,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _selectedFilter == _kFilters.length - 1
                            ? 'No saved posts yet.\nTap 🔖 on any post to save it.'
                            : 'No broadcasts match your search.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color:    cs.onSurfaceVariant.withValues(alpha: 0.7),
                          fontSize: 14,
                          height:   1.5,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: posts.first.imageUrl != null
                    ? FeaturedPost(
                        id:            posts.first.id,
                        title:         posts.first.title,
                        description:   posts.first.description,
                        imageUrl:      posts.first.imageUrl!,
                        publisher:     posts.first.publisher,
                        category:      posts.first.category,
                        categoryColor: posts.first.categoryColor,
                        isUrgent:      posts.first.isUrgent,
                        timeAgo:       posts.first.timeAgo,
                        likeCount:     posts.first.baseLikes + (state.isLiked(posts.first.id) ? 1 : 0),
                        isLiked:       state.isLiked(posts.first.id),
                        isSaved:       state.isSaved(posts.first.id),
                        onLike:        () => notifier.toggleLike(posts.first.id),
                        onSave:        () => notifier.toggleSave(posts.first.id),
                      )
                    : SimplePost(
                        id:            posts.first.id,
                        title:         posts.first.title,
                        description:   posts.first.description,
                        publisher:     posts.first.publisher,
                        category:      posts.first.category,
                        categoryColor: posts.first.categoryColor,
                        categoryIcon:  posts.first.categoryIcon,
                        isUrgent:      posts.first.isUrgent,
                        timeAgo:       posts.first.timeAgo,
                        likeCount:     posts.first.baseLikes + (state.isLiked(posts.first.id) ? 1 : 0),
                        isLiked:       state.isLiked(posts.first.id),
                        isSaved:       state.isSaved(posts.first.id),
                        onLike:        () => notifier.toggleLike(posts.first.id),
                        onSave:        () => notifier.toggleSave(posts.first.id),
                      ),
              ),
              for (final post in posts.skip(1)) ...[
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: SimplePost(
                    id:            post.id,
                    title:         post.title,
                    description:   post.description,
                    publisher:     post.publisher,
                    category:      post.category,
                    categoryColor: post.categoryColor,
                    categoryIcon:  post.categoryIcon,
                    isUrgent:      post.isUrgent,
                    timeAgo:       post.timeAgo,
                    likeCount:     post.baseLikes + (state.isLiked(post.id) ? 1 : 0),
                    isLiked:       state.isLiked(post.id),
                    isSaved:       state.isSaved(post.id),
                    onLike:        () => notifier.toggleLike(post.id),
                    onSave:        () => notifier.toggleSave(post.id),
                  ),
                ),
              ],
            ],

            const SizedBox(height: 100),
          ],
        ),
      ),
    );
  }
}

// ─── Critical Alert Banner ────────────────────────────────────────────────────

/// Self-contained dismissible banner.  Collapses smoothly via [AnimatedSize].
class _CriticalAlertBanner extends StatefulWidget {
  const _CriticalAlertBanner();

  @override
  State<_CriticalAlertBanner> createState() => _CriticalAlertBannerState();
}

class _CriticalAlertBannerState extends State<_CriticalAlertBanner> {
  bool _dismissed = false;

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: const Duration(milliseconds: 300),
      curve:    Curves.easeInOut,
      child: _dismissed
          ? const SizedBox.shrink()
          : Container(
              margin:  const EdgeInsets.fromLTRB(16, 12, 16, 0),
              padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
              decoration: BoxDecoration(
                color:        _kCriticalBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                    color: _kCritical.withValues(alpha: 0.30)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 1),
                    child: Icon(Icons.warning_amber_rounded,
                        color: _kCritical, size: 20),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'HEALTH ALERT — Ministry of Health',
                          style: TextStyle(
                            fontSize:      11,
                            fontWeight:    FontWeight.w800,
                            color:         _kCritical,
                            letterSpacing: 0.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        const Text(
                          'Dengue fever cases are rising in your district. '
                          'Eliminate standing water and use mosquito repellent.',
                          style: TextStyle(
                            fontSize: 13,
                            color:    Color(0xFF991B1B),
                            height:   1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Dismiss button
                  GestureDetector(
                    onTap: () => setState(() => _dismissed = true),
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: Icon(
                        Icons.close_rounded,
                        size:  18,
                        color: _kCritical.withValues(alpha: 0.65),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

// ─── Post filter chips ────────────────────────────────────────────────────────

class _PostFilterRow extends StatelessWidget {
  final int             selectedIndex;
  final ValueChanged<int> onChanged;

  const _PostFilterRow({
    required this.selectedIndex,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection:  Axis.horizontal,
        padding:          const EdgeInsets.symmetric(horizontal: 20),
        itemCount:        _kFilters.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final selected = i == selectedIndex;
          return GestureDetector(
            onTap: () => onChanged(i),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color:        selected ? cs.onSurface : cs.surface,
                borderRadius: BorderRadius.circular(30),
                border:       Border.all(
                  color: selected ? cs.onSurface : amina.cardBorder,
                ),
              ),
              child: Text(
                _kFilters[i].label,
                style: TextStyle(
                  fontSize:   13,
                  fontWeight: selected
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: selected ? cs.surface : cs.onSurfaceVariant,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ─── Search bar ───────────────────────────────────────────────────────────────

class _SearchBar extends StatefulWidget {
  final TextEditingController controller;
  const _SearchBar({required this.controller});

  @override
  State<_SearchBar> createState() => _SearchBarState();
}

class _SearchBarState extends State<_SearchBar> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(() => setState(() {}));
  }

  @override
  Widget build(BuildContext context) {
    final hasText = widget.controller.text.isNotEmpty;
    final cs      = Theme.of(context).colorScheme;
    final amina   = Theme.of(context).extension<AminaColors>()!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 15),
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(30),
        border:       Border.all(color: hasText ? cs.primary.withValues(alpha: 0.50) : amina.cardBorder),
        boxShadow: [
          BoxShadow(
            color:      Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
          ),
        ],
      ),
      child: TextField(
        controller: widget.controller,
        style: TextStyle(color: cs.onSurface),
        decoration: InputDecoration(
          hintText:    'Search official health broadcasts…',
          border:      InputBorder.none,
          filled:      true,
          fillColor:   Colors.transparent,
          icon:        Icon(Icons.search_rounded,
              color: hasText ? cs.primary : cs.onSurfaceVariant),
          suffixIcon: hasText
              ? GestureDetector(
                  onTap: () => widget.controller.clear(),
                  child: Icon(Icons.close_rounded, color: cs.onSurfaceVariant, size: 18),
                )
              : null,
        ),
      ),
    );
  }
}
