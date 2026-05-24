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

// Pure Dart — no Flutter imports.

class TipEntry {
  final String icon;
  final String text;

  const TipEntry({required this.icon, required this.text});
}

class SeasonSummary {
  final String id;
  final String name;

  const SeasonSummary({required this.id, required this.name});
}

class SeasonalRhythm {
  final SeasonSummary  season;
  final String         date;
  final TipEntry       featuredTip;
  final List<TipEntry> allTips;
  final bool           isRamadan;
  final List<TipEntry> ramadanTips;
  final String         month;

  const SeasonalRhythm({
    required this.season,
    required this.date,
    required this.featuredTip,
    required this.allTips,
    required this.isRamadan,
    required this.ramadanTips,
    required this.month,
  });
}
