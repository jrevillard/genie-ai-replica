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
  { _key: 'cat1', nameEN: 'Business & Economy', nameFR: 'Affaires & Économie', nameSW: 'Biashara & Uchumi' },
  { _key: 'cat2', nameEN: 'Transportation', nameFR: 'Transport', nameSW: 'Usafiri' },
  { _key: 'cat3', nameEN: 'Taxes & Revenue', nameFR: 'Impôts & Recettes', nameSW: 'Kodi & Mapato' },
  { _key: 'cat4', nameEN: 'Immigration & Citizenship', nameFR: 'Immigration & Citoyenneté', nameSW: 'Uhamiaji & Uraia' },
  { _key: 'cat5', nameEN: 'Education & Learning', nameFR: 'Éducation & Apprentissage', nameSW: 'Elimu & Mafunzo' },
  { _key: 'cat6', nameEN: 'Housing & Properties', nameFR: 'Logement & Propriétés', nameSW: 'Makazi & Mali' },
  { _key: 'cat7', nameEN: 'Health & Healthcare', nameFR: 'Santé & Soins Médicaux', nameSW: 'Afya & Huduma za Afya' },
  { _key: 'cat8', nameEN: 'Justice & Legal', nameFR: 'Justice & Juridique', nameSW: 'Haki & Sheria' }
];

// Common questions for each category (for simulating queries)
const CATEGORY_QUESTIONS = {
  'cat1': [
    'How do I register a new business?',
    'What permits do I need for a small business?',
    'How can I apply for a business loan?',
    'What are the requirements for business tax filing?',
    'How to renew a business license?'
  ],
  'cat2': [
    'How do I renew my driver\'s license?',
    'What documents do I need for vehicle registration?',
    'How can I pay a traffic ticket?',
    'How to apply for a commercial driving permit?',
    'What are the vehicle inspection requirements?'
  ],
  'cat3': [
    'When are income taxes due?',
    'How do I file my tax return?',
    'Can I get an extension for tax filing?',
    'How to check my tax refund status?',
    'What tax deductions are available for small businesses?'
  ],
  'cat4': [
    'How do I apply for a passport?',
    'What documents do I need for citizenship application?',
    'How long does visa processing take?',
    'What are the requirements for permanent residency?',
    'How can I renew my work permit?'
  ],
  'cat5': [
    'How do I enroll my child in public school?',
    'What financial aid is available for college?',
    'How can I apply for a student loan?',
    'What continuing education programs are offered?',
    'How do I transfer school credits?'
  ],
  'cat6': [
    'How do I apply for public housing?',
    'What permits do I need for home renovation?',
    'How can I file a complaint against a landlord?',
    'What are the property tax rates?',
    'How do I contest a property assessment?'
  ],
  'cat7': [
    'How do I sign up for health insurance?',
    'What vaccinations are required for school?',
    'How can I find a local healthcare provider?',
    'What mental health services are available?',
    'How do I access my medical records?'
  ],
  'cat8': [
    'How do I file a small claims case?',
    'What is the process for jury duty?',
    'How can I obtain court records?',
    'What legal aid services are available?',
    'How do I get a document notarized?'
  ]
};

// Generate a random date within a range
const randomDate = (start, end) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

// Generate a random integer between min and max (inclusive)
const randomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Generate random users
const generateUsers = (count) => {
  const users = [];
  
  for (let i = 0; i < count; i++) {
    users.push({
      email: `user${i+1}@example.com`,
      createdAt: randomDate(new Date(2023, 0, 1), new Date()).toISOString()
    });
  }
  
  return users;
};

// Generate random sessions
const generateSessions = (userCount, sessionCount) => {
  const sessions = [];
  
  for (let i = 0; i < sessionCount; i++) {
    const userIndex = randomInt(1, userCount);
    
    sessions.push({
      userId: `user${userIndex}`,
      startTime: randomDate(new Date(2023, 0, 1), new Date()).toISOString(),
      endTime: null, // Some sessions might still be active
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
  }
  
  return sessions;
};

// Generate random queries
const generateQueries = (userCount, sessionCount, queryCount) => {
  const queries = [];
  
  for (let i = 0; i < queryCount; i++) {
    const userId = `user${randomInt(1, userCount)}`;
    const sessionId = `session${randomInt(1, sessionCount)}`;
    
    // Random category selection
    const categoryIndex = randomInt(0, SERVICE_CATEGORIES.length - 1);
    const category = SERVICE_CATEGORIES[categoryIndex];
    
    // Random question from that category
    const questions = CATEGORY_QUESTIONS[category._key];
    const questionIndex = randomInt(0, questions.length - 1);
    const questionText = questions[questionIndex];
    
    // Random response time between 0.5 and 5 seconds
    const responseTime = Math.random() * 4.5 + 0.5;
    
    // Most queries are answered (90%)
    const isAnswered = Math.random() < 0.9;
    
    // Use UUID for document key instead of "query123" format
    queries.push({
      userId,
      sessionId,
      text: questionText,
      categoryId: category._key,
      serviceId: null, // Not used in this simulation
      timestamp: randomDate(new Date(2023, 0, 1), new Date()).toISOString(),
      responseTime,
      isAnswered
    });
  }
  
  return queries;
};

// Generate query analytics
const generateQueryAnalytics = (queries) => {
  const analytics = [];
  
  for (const query of queries) {
    analytics.push({
      type: 'query',
      timestamp: query.timestamp,
      data: {
        text: query.text,
        categoryId: query.categoryId,
        serviceId: query.serviceId,
        responseTime: query.responseTime,
        isAnswered: query.isAnswered
      }
    });
  }
  
  return analytics;
};

// Generate analytics records for feedback
const generateFeedbackAnalytics = (queries, feedbackCount) => {
  const analytics = [];
  
  // Only generate feedback for a subset of queries
  const queriesWithFeedback = queries.slice(0, feedbackCount);
  
  for (const query of queriesWithFeedback) {
    // Rating between 1 and 5, with a bias towards higher ratings
    const rating = Math.min(5, Math.floor(Math.random() * 5) + 1 + (Math.random() < 0.6 ? 1 : 0));
    
    // Feedback timestamp is slightly after the query timestamp
    const queryDate = new Date(query.timestamp);
    const feedbackDate = new Date(queryDate.getTime() + randomInt(10, 300) * 1000); // 10-300 seconds later
    
    analytics.push({
      type: 'feedback',
      timestamp: feedbackDate.toISOString(),
      data: {
        rating,
        comment: rating >= 4 ? 'Very helpful, thank you!' : 
                 rating >= 3 ? 'It was okay.' :
                 'Did not answer my question completely.'
      }
    });
  }
  
  return analytics;
};

// Main function to generate and save test data
const generateTestData = async () => {
  try {
    console.log('Connecting to ArangoDB...');
    const db = initDB();
    
    // Create or get collections
    console.log('Setting up collections...');
    
    // Helper function to ensure collection exists
    const ensureCollection = async (name) => {
      const collections = await db.listCollections();
      const collectionNames = collections.map(c => c.name);
      
      if (!collectionNames.includes(name)) {
        console.log(`Creating ${name} collection...`);
        await db.createCollection(name);
        console.log(`Created ${name} collection successfully`);
      } else {
        console.log(`Collection ${name} already exists`);
      }
      
      return db.collection(name);
    };
    
    // Ensure all required collections exist
    const serviceCategories = await ensureCollection('serviceCategories');
    const users = await ensureCollection('users');
    const sessions = await ensureCollection('sessions');
    const queries = await ensureCollection('queries');
    const analytics = await ensureCollection('analytics');
    const events = await ensureCollection('events');
    
    // Generate test data
    console.log('Generating test data...');
    const userCount = 50;
    const sessionCount = 200;
    const queryCount = 1000;
    const feedbackCount = 500; // Number of queries that received feedback
    
    // Skip inserting service categories as they already exist
    console.log('Service categories already exist, skipping creation...');
    
    // Generate and insert users
    console.log('Inserting users...');
    const userData = generateUsers(userCount);
    for (const user of userData) {
      try {
        await users.save(user);
      } catch (err) {
        // Ignore duplicate key errors
        if (err.errorNum !== 1210) {
          console.error(`Error saving user ${user._key}:`, err);
        }
      }
    }
    
    // Generate and insert sessions
    console.log('Inserting sessions...');
    const sessionData = generateSessions(userCount, sessionCount);
    for (const session of sessionData) {
      try {
        await sessions.save(session);
      } catch (err) {
        // Ignore duplicate key errors
        if (err.errorNum !== 1210) {
          console.error(`Error saving session ${session._key}:`, err);
        }
      }
    }
    
    // Generate and insert queries
    console.log('Inserting queries...');
    const queryData = generateQueries(userCount, sessionCount, queryCount);
    for (const query of queryData) {
      try {
        await queries.save(query);
      } catch (err) {
        // Ignore duplicate key errors
        if (err.errorNum !== 1210) {
          console.error(`Error saving query ${query._key}:`, err);
        }
      }
    }
    
    // Generate and insert analytics records
    console.log('Inserting analytics records...');
    
    // Query analytics
    const queryAnalytics = generateQueryAnalytics(queryData);
    for (const record of queryAnalytics) {
      try {
        await analytics.save(record);
      } catch (err) {
        console.error('Error saving query analytics:', err);
      }
    }
    
    // Feedback analytics
    const feedbackAnalytics = generateFeedbackAnalytics(queryData, feedbackCount);
    for (const record of feedbackAnalytics) {
      try {
        await analytics.save(record);
      } catch (err) {
        console.error('Error saving feedback analytics:', err);
      }
    }
    
    console.log('Test data generation complete!');
    console.log(`
Summary:
- Service Categories: Using existing data
- Users: ${userCount}
- Sessions: ${sessionCount}
- Queries: ${queryCount}
- Query Analytics: ${queryAnalytics.length}
- Feedback Analytics: ${feedbackAnalytics.length}
    `);
    
  } catch (error) {
    console.error('Error generating test data:', error);
  }
};

// Run the script
generateTestData().catch(console.error);