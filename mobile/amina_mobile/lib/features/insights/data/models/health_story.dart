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

// ─── Interaction types ────────────────────────────────────────────────────────

enum StoryInteraction {
  /// Plain text + emoji card — no interactive element.
  none,

  /// A two-option poll the user can vote on.
  poll,

  /// A call-to-action button (e.g. "Book a Free Screening").
  cta,
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

class PollData {
  final String       question;
  final List<String> options; // exactly 2 options

  const PollData({required this.question, required this.options});
}

// ─── Call-to-Action ───────────────────────────────────────────────────────────

class CtaData {
  final String label;    // Button headline
  final String subtitle; // Publisher attribution line

  const CtaData({required this.label, required this.subtitle});
}

// ─── Story Slide ──────────────────────────────────────────────────────────────

/// A single card inside a [HealthStory].
///
/// Each slide occupies the full viewer screen and can optionally carry a
/// [poll] or [cta] interactive element at the bottom.
class StorySlide {
  final String            title;
  final String            body;
  final LinearGradient    gradient;
  final String            iconEmoji;
  final StoryInteraction  interaction;
  final PollData?         poll;
  final CtaData?          cta;

  const StorySlide({
    required this.title,
    required this.body,
    required this.gradient,
    required this.iconEmoji,
    this.interaction = StoryInteraction.none,
    this.poll,
    this.cta,
  });
}

// ─── Health Story ─────────────────────────────────────────────────────────────

/// A publisher's story — one or more [slides] shown sequentially.
class HealthStory {
  final String         id;
  final String         publisher;
  final String         publisherTag;      // e.g. "Official Announcement"
  final String         thumbnailEmoji;
  final LinearGradient thumbnailGradient;
  final Color          accentColor;
  final List<StorySlide> slides;

  const HealthStory({
    required this.id,
    required this.publisher,
    required this.publisherTag,
    required this.thumbnailEmoji,
    required this.thumbnailGradient,
    required this.accentColor,
    required this.slides,
  });
}

// ─── Mock story data ──────────────────────────────────────────────────────────

const kMockStories = <HealthStory>[

  // ── 1. Ministry of Health — Flu Vaccine Season ──────────────────────────────
  HealthStory(
    id:               'moh_flu_2024',
    publisher:        'Ministry of Health',
    publisherTag:     'Official Announcement',
    thumbnailEmoji:   '🏛️',
    thumbnailGradient: LinearGradient(
      begin:  Alignment.topLeft,
      end:    Alignment.bottomRight,
      colors: [Color(0xFF1E40AF), Color(0xFF1E3A5F)],
    ),
    accentColor: Color(0xFF3B82F6),
    slides: [
      StorySlide(
        iconEmoji: '💉',
        title:     'Flu Vaccine Season Has Started',
        body:
            'The Ministry of Health urges all citizens — especially those '
            'over 60 — to get their annual flu vaccine. It is free at all '
            'public clinics this season.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF1E3A5F), Color(0xFF1E40AF), Color(0xFF1D4ED8)],
        ),
      ),
      StorySlide(
        iconEmoji:   '🏥',
        title:       'Find Your Nearest Clinic',
        body:
            'Over 500 public health centres are offering free flu vaccines '
            'this season. No appointment needed — walk in any weekday '
            'between 8 AM and 4 PM.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF1D4ED8), Color(0xFF1E40AF), Color(0xFF172554)],
        ),
        interaction: StoryInteraction.cta,
        cta: CtaData(
          label:    'Find a Clinic Near Me',
          subtitle: 'Powered by Ministry of Health',
        ),
      ),
    ],
  ),

  // ── 2. City General Hospital — Free Diabetes Screening ──────────────────────
  HealthStory(
    id:               'cgh_diabetes_screening',
    publisher:        'City General Hospital',
    publisherTag:     'Community Health Event',
    thumbnailEmoji:   '🏥',
    thumbnailGradient: LinearGradient(
      begin:  Alignment.topLeft,
      end:    Alignment.bottomRight,
      colors: [Color(0xFF047857), Color(0xFF065F46)],
    ),
    accentColor: Color(0xFF10B981),
    slides: [
      StorySlide(
        iconEmoji:   '💉',
        title:       'Free Diabetes Screening This Friday',
        body:
            'City General Hospital offers free blood glucose checks every '
            'Friday morning from 9 AM to 12 PM. Early detection saves lives.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF064E3B), Color(0xFF047857), Color(0xFF059669)],
        ),
        interaction: StoryInteraction.poll,
        poll: PollData(
          question: 'Have you had your blood glucose checked this year?',
          options:  ['Yes, recently', 'Not yet'],
        ),
      ),
      StorySlide(
        iconEmoji:   '📊',
        title:       'Why Screening Matters',
        body:
            'Nearly 40 % of people with type 2 diabetes are undiagnosed. '
            'A simple 5-minute test can give you clarity and peace of mind.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF059669), Color(0xFF047857), Color(0xFF064E3B)],
        ),
        interaction: StoryInteraction.cta,
        cta: CtaData(
          label:    'Book a Free Screening',
          subtitle: 'City General Hospital · Friday mornings',
        ),
      ),
    ],
  ),

  // ── 3. Health Tip of the Day — Stay Hydrated ────────────────────────────────
  HealthStory(
    id:               'tip_hydration',
    publisher:        'Health Tip of the Day',
    publisherTag:     'Daily Wellness',
    thumbnailEmoji:   '💧',
    thumbnailGradient: LinearGradient(
      begin:  Alignment.topLeft,
      end:    Alignment.bottomRight,
      colors: [Color(0xFF0EA5E9), Color(0xFF0369A1)],
    ),
    accentColor: Color(0xFF0EA5E9),
    slides: [
      StorySlide(
        iconEmoji:   '💧',
        title:       'Drink 8 Glasses of Water Today',
        body:
            'Proper hydration helps regulate blood pressure, supports kidney '
            'function, and improves energy levels — especially important '
            'for people managing diabetes.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF0369A1), Color(0xFF0EA5E9), Color(0xFF38BDF8)],
        ),
        interaction: StoryInteraction.poll,
        poll: PollData(
          question: 'Did you drink enough water today?',
          options:  ['Yes, I have! 💪', 'Not yet, I\'ll try'],
        ),
      ),
      StorySlide(
        iconEmoji: '✅',
        title:     'Tips to Stay Hydrated',
        body:
            '• Keep a water bottle visible\n'
            '• Drink a glass before each meal\n'
            '• Set reminders on your phone\n'
            '• Eat water-rich foods like cucumber and melon',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF38BDF8), Color(0xFF0EA5E9), Color(0xFF0369A1)],
        ),
      ),
    ],
  ),

  // ── 4. Heart Health Foundation — Know Your Numbers ──────────────────────────
  HealthStory(
    id:               'heart_know_numbers',
    publisher:        'Heart Health Foundation',
    publisherTag:     'Cardiovascular Awareness',
    thumbnailEmoji:   '❤️',
    thumbnailGradient: LinearGradient(
      begin:  Alignment.topLeft,
      end:    Alignment.bottomRight,
      colors: [Color(0xFFBE123C), Color(0xFF9F1239)],
    ),
    accentColor: Color(0xFFF43F5E),
    slides: [
      StorySlide(
        iconEmoji: '💓',
        title:     'Know Your Blood Pressure Numbers',
        body:
            'A normal blood pressure reading is below 120/80 mmHg. If yours '
            'is consistently higher, speak with your doctor about next steps.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF881337), Color(0xFFBE123C), Color(0xFFE11D48)],
        ),
      ),
      StorySlide(
        iconEmoji:   '❤️',
        title:       'Three Simple Heart-Healthy Habits',
        body:
            '1. Walk 30 minutes daily\n'
            '2. Reduce salt in your meals\n'
            '3. Check your BP every week\n\n'
            'Small changes, big results.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFFE11D48), Color(0xFFBE123C), Color(0xFF881337)],
        ),
        interaction: StoryInteraction.cta,
        cta: CtaData(
          label:    'Track My Blood Pressure',
          subtitle: 'Log it in Amina Care',
        ),
      ),
    ],
  ),

  // ── 5. Mental Wellness Program ───────────────────────────────────────────────
  HealthStory(
    id:               'mental_wellness',
    publisher:        'Mental Wellness Program',
    publisherTag:     'Mental Health Month',
    thumbnailEmoji:   '🧠',
    thumbnailGradient: LinearGradient(
      begin:  Alignment.topLeft,
      end:    Alignment.bottomRight,
      colors: [Color(0xFF7C3AED), Color(0xFF5B21B6)],
    ),
    accentColor: Color(0xFF8B5CF6),
    slides: [
      StorySlide(
        iconEmoji:   '🧠',
        title:       'Your Mental Health Matters',
        body:
            'Living with a chronic illness can feel overwhelming. It is okay '
            'to ask for help. Our network of free counselling services is '
            'available to all patients.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF4C1D95), Color(0xFF7C3AED), Color(0xFF8B5CF6)],
        ),
        interaction: StoryInteraction.poll,
        poll: PollData(
          question: 'How are you feeling today?',
          options:  ['I\'m doing well 😊', 'I could use support'],
        ),
      ),
      StorySlide(
        iconEmoji:   '🤝',
        title:       'You Are Not Alone',
        body:
            'Over 1 in 3 people with chronic conditions experience depression '
            'or anxiety. Speaking up is a sign of strength, not weakness.',
        gradient: LinearGradient(
          begin:  Alignment.topCenter,
          end:    Alignment.bottomCenter,
          colors: [Color(0xFF8B5CF6), Color(0xFF7C3AED), Color(0xFF4C1D95)],
        ),
        interaction: StoryInteraction.cta,
        cta: CtaData(
          label:    'Find a Counsellor',
          subtitle: 'Free · Confidential · Available now',
        ),
      ),
    ],
  ),
];
