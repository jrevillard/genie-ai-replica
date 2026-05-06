/**
 * Suggested questions surfaced on the chat-landing UI.
 *
 * Curated list of NCD-aligned starter questions, ordered by importance
 * (lower `order` = shown first). English only — no localization for now.
 * To edit copy or reorder, change this list and redeploy the backend.
 *
 * Shape consumed by both /api/suggested-questions and
 * /api/public/suggested-questions.
 */
const SUGGESTED_QUESTIONS = [
  {
    order: 1,
    category: 'Hypertension',
    content: 'How do I know if my blood pressure is too high?',
  },
  {
    order: 2,
    category: 'Tobacco Use & Cessation',
    content: "I want to quit smoking but I don't know where to start.",
  },
  {
    order: 3,
    category: 'Healthy Lifestyle',
    content: 'How much salt is too much?',
  },
  {
    order: 4,
    category: 'Cardiovascular & Stroke Risk',
    content: 'What are the warning signs of a stroke?',
  },
  {
    order: 5,
    category: 'Hypertension',
    content: 'Is it true that hypertension can be cured with herbs?',
  },
  {
    order: 6,
    category: 'Healthy Lifestyle',
    content: "I don't have time to exercise. What can I do?",
  },
];

module.exports = { SUGGESTED_QUESTIONS };
