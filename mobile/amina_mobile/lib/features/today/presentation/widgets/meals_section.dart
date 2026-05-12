import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';

// ─── Meal data ────────────────────────────────────────────────────────────────

class _MealData {
  final String       imageUrl;
  final String       title;
  final List<String> tags;
  final int          calories;

  const _MealData({
    required this.imageUrl,
    required this.title,
    required this.tags,
    required this.calories,
  });
}

const _kMeals = [
  _MealData(
    imageUrl: 'https://images.unsplash.com/photo-1601314212732-047d4bdffd22?q=80&w=640',
    title:    'Diabetic Friendly Bowl',
    tags:     ['Low GI', 'High Fibre'],
    calories: 320,
  ),
  _MealData(
    imageUrl: 'https://images.unsplash.com/photo-1547592180-85f173990554?q=80&w=640',
    title:    'Heart-Healthy Salad',
    tags:     ['Low Sodium', 'Omega-3'],
    calories: 280,
  ),
  _MealData(
    imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=640',
    title:    'Protein Power Plate',
    tags:     ['High Protein', 'Low Fat'],
    calories: 410,
  ),
];

// ─── MealsSection ─────────────────────────────────────────────────────────────

/// Horizontal-scrolling meal card strip for TodayHub.
///
/// Each card shows a full-bleed network image, a title, dietary-tag chips
/// and a calorie count.  Cards are 185 × 210 px and support a bounce physics
/// feel consistent with the DailyHealthCarousel above it.
class MealsSection extends StatelessWidget {
  const MealsSection({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Section header ─────────────────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Recommended Today',
                style: TextStyle(
                  fontSize:      19,
                  fontWeight:    FontWeight.w700,
                  color:         cs.onSurface,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Meals tailored to your condition',
                style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),

        // ── Card row ───────────────────────────────────────────────────────
        SizedBox(
          height: 215,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding:         const EdgeInsets.only(left: 20),
            physics:         const BouncingScrollPhysics(),
            itemCount:       _kMeals.length,
            separatorBuilder: (_, __) => const SizedBox(width: 14),
            itemBuilder: (context, i) => _MealCard(data: _kMeals[i]),
          ),
        ),
      ],
    );
  }
}

// ─── Meal card ────────────────────────────────────────────────────────────────

class _MealCard extends StatelessWidget {
  final _MealData data;
  const _MealCard({required this.data});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Container(
      width:        185,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color:        cs.surface,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: amina.sageGlow, blurRadius: 12, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Photo ────────────────────────────────────────────────────────
          Expanded(
            child: Image.network(
              data.imageUrl,
              fit:   BoxFit.cover,
              width: double.infinity,
              errorBuilder: (_, __, ___) => Container(
                color: amina.inputFill,
                child: Icon(
                  Icons.restaurant_rounded,
                  color: cs.onSurfaceVariant,
                  size:  36,
                ),
              ),
            ),
          ),

          // ── Info ──────────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Title
                Text(
                  data.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize:   13,
                    fontWeight: FontWeight.w700,
                    color:      cs.onSurface,
                    height:     1.3,
                  ),
                ),
                const SizedBox(height: 6),

                // Tag chips
                Wrap(
                  spacing:    5,
                  runSpacing: 4,
                  children: data.tags
                      .map(
                        (tag) => Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical:   3,
                          ),
                          decoration: BoxDecoration(
                            color:        cs.primaryContainer,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            tag,
                            style: TextStyle(
                              fontSize:   10,
                              fontWeight: FontWeight.w600,
                              color:      cs.primary,
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),

                const SizedBox(height: 6),

                // Calorie count
                Text(
                  '${data.calories} kcal',
                  style: TextStyle(
                    fontSize:   11.5,
                    color:      cs.onSurfaceVariant,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
