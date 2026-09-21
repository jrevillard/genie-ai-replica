import 'package:flutter/material.dart';

import '../../utils/theme_manager.dart';
import '../../services/i18n_service.dart';
import 'market_price_summary_card.dart';

/// Dedicated Market Prices screen (mobile real-estate): the eight
/// category summary cards, flipped to from the top nav bar toggle.
/// Each card self-loads its data and opens the multi-series chart
/// dialog on tap.
class MarketPricesPage extends StatelessWidget {
  const MarketPricesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tr('market.sectionTitle'),
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: tokens.fg,
              ),
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 2,
              childAspectRatio: 1.0,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              children: const [
                MarketPriceSummaryCard(category: 'maize'),
                MarketPriceSummaryCard(category: 'vegetables'),
                MarketPriceSummaryCard(category: 'livestock'),
                MarketPriceSummaryCard(category: 'aquaculture'),
                MarketPriceSummaryCard(category: 'apiary'),
                MarketPriceSummaryCard(category: 'fertilizer'),
                MarketPriceSummaryCard(category: 'cropProtection'),
                MarketPriceSummaryCard(category: 'harvestStorage'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
