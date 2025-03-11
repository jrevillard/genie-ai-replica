// scripts/generateTestData.js
require('dotenv').config();
const { Database } = require('arangojs');
const { v4: uuidv4 } = require('uuid');

// Initialize ArangoDB connection
const initDB = () => {
  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || 'node-services',
    auth: {
      username: process.env.ARANGO_USERNAME || 'root',
      password: process.env.ARANGO_PASSWORD || 'test'
    }
  });

  return db;
};

// Service categories for simulation
const SERVICE_CATEGORIES = [
  { _key: 'cat1', nameEN: 'Business & Economy' },
  { _key: 'cat2', nameEN: 'Transportation' },
  { _key: 'cat3', nameEN: 'Taxes & Revenue' },
  { _key: 'cat4', nameEN: 'Immigration & Citizenship' },
  { _key: 'cat5', nameEN: 'Education & Learning' },
  { _key: 'cat6', nameEN: 'Housing & Properties' },
  { _key: 'cat7', nameEN: 'Health & Healthcare' },
  { _key: 'cat8', nameEN: 'Justice & Legal' }
];

// Common questions for each category
const CATEGORY_QUESTIONS = {
  'cat1': ['How do I register a new business?', 'What permits do I need?', 'How to apply for a business loan?'],
  'cat2': ['How to renew my driver’s license?', 'Documents for vehicle registration?', 'How to pay a traffic ticket?'],
  'cat3': ['When are income taxes due?', 'How to file my tax return?', 'Can I get an extension?'],
  'cat4': ['How to apply for a passport?', 'Documents for citizenship?', 'How long does visa processing take?'],
  'cat5': ['How to enroll a child in school?', 'Financial aid for college?', 'How to apply for a student loan?'],
  'cat6': ['How to apply for public housing?', 'Permits for home renovation?', 'How to file a landlord complaint?'],
  'cat7': ['How to sign up for health insurance?', 'Required vaccinations?', 'How to find a local doctor?'],
  'cat8': ['How to file a small claims case?', 'Jury duty process?', 'How to obtain court records?']
};

// Generate a random date within a range
const randomDate = (start, end) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

// Generate a random integer between min and max (inclusive)
const randomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Generate 1 million users
const generateUsers = (count) => {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push({
      _key: `user${i+1}`,
      email: `user${i+1}@example.com`,
      createdAt: randomDate(new Date(2023, 0, 1), new Date()).toISOString()
    });
  }
  return users;
};

// Generate multiple sessions per user
const generateSessions = (userCount, avgSessionsPerUser = 5) => {
  const sessions = [];
  for (let i = 1; i <= userCount; i++) {
    for (let j = 0; j < avgSessionsPerUser; j++) {
      sessions.push({
        _key: `session${uuidv4()}`,
        userId: `user${i}`,
        startTime: randomDate(new Date(2023, 0, 1), new Date()).toISOString(),
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      });
    }
  }
  return sessions;
};

// Generate multiple queries per user
const generateQueries = (userCount, avgQueriesPerUser = 10) => {
  const queries = [];
  for (let i = 1; i <= userCount; i++) {
    for (let j = 0; j < avgQueriesPerUser; j++) {
      const sessionId = `session${uuidv4()}`;
      const categoryIndex = randomInt(0, SERVICE_CATEGORIES.length - 1);
      const category = SERVICE_CATEGORIES[categoryIndex];
      const questionIndex = randomInt(0, CATEGORY_QUESTIONS[category._key].length - 1);
      const questionText = CATEGORY_QUESTIONS[category._key][questionIndex];
      const responseTime = Math.random() * 4.5 + 0.5;
      const isAnswered = Math.random() < 0.9;

      queries.push({
        _key: `query${uuidv4()}`,
        userId: `user${i}`,
        sessionId,
        text: questionText,
        categoryId: category._key,
        timestamp: randomDate(new Date(2023, 0, 1), new Date()).toISOString(),
        responseTime,
        isAnswered
      });
    }
  }
  return queries;
};

// Generate analytics records for queries
const generateQueryAnalytics = (queries) => {
  return queries.map(query => ({
    _key: `analytics${uuidv4()}`,
    type: 'query',
    timestamp: query.timestamp,
    data: {
      text: query.text,
      categoryId: query.categoryId,
      responseTime: query.responseTime,
      isAnswered: query.isAnswered
    }
  }));
};

// Generate analytics records for feedback
const generateFeedbackAnalytics = (queries, feedbackCount) => {
  return queries.slice(0, feedbackCount).map(query => {
    const rating = Math.min(5, Math.floor(Math.random() * 5) + 1 + (Math.random() < 0.6 ? 1 : 0));
    const queryDate = new Date(query.timestamp);
    const feedbackDate = new Date(queryDate.getTime() + randomInt(10, 300) * 1000);

    return {
      _key: `feedback${uuidv4()}`,
      type: 'feedback',
      timestamp: feedbackDate.toISOString(),
      data: {
        rating,
        comment: rating >= 4 ? 'Very helpful, thank you!' :
                 rating >= 3 ? 'It was okay.' :
                 'Did not answer my question completely.'
      }
    };
  });
};

// Main function to generate and save test data
const generateTestData = async () => {
  try {
    console.log('Connecting to ArangoDB...');
    const db = initDB();

    console.log('Setting up collections...');
    const ensureCollection = async (name) => {
      const collections = await db.listCollections();
      if (!collections.some(c => c.name === name)) {
        await db.createCollection(name);
      }
      return db.collection(name);
    };

    const usersCol = await ensureCollection('users');
    const sessionsCol = await ensureCollection('sessions');
    const queriesCol = await ensureCollection('queries');
    const analyticsCol = await ensureCollection('analytics');

    console.log('Generating test data...');
    const userCount = 1_000_000;
    const sessionData = generateSessions(userCount, 5);
    const queryData = generateQueries(userCount, 10);
    const queryAnalytics = generateQueryAnalytics(queryData);
    const feedbackAnalytics = generateFeedbackAnalytics(queryData, queryData.length * 0.5);

    console.log('Inserting data...');
    await usersCol.import(generateUsers(userCount));
    await sessionsCol.import(sessionData);
    await queriesCol.import(queryData);
    await analyticsCol.import([...queryAnalytics, ...feedbackAnalytics]);

    console.log('Test data generation complete!');

  } catch (error) {
    console.error('Error generating test data:', error);
  }
};

// Run the script
generateTestData().catch(console.error);
