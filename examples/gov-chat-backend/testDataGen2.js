// Required modules
require('dotenv').config();
const { Database } = require('arangojs');
const fs = require('fs');

// Setup logging
const logStream = fs.createWriteStream('test-data-generation.log', { flags: 'a' });
const debug = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}`;
  console.log(logMessage);
  logStream.write(logMessage + '\n');
};

// Enhanced compatible timestamp function that ensures ArangoDB compatibility
const createCompatibleTimestamp = (date) => {
  // Ensure we're working with a proper Date object
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  
  // Format the date in a way that ArangoDB's DATE_NOW() can directly compare
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  
  // Use explicit formatting instead of toISOString to ensure consistency
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}Z`;
};

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

// Special debug function to work around DATE_NOW() issues
const debugDateFormats = async (db) => {
  debug('Testing DATE_NOW() compatibility with sample timestamps...');
  
  try {
    // Create a simple query that tests various date functions
    const query = `
      LET now = DATE_NOW()
      LET nowISO = DATE_ISO8601(DATE_NOW())
      LET testDate = DATE_ISO8601("${createCompatibleTimestamp(new Date())}")
      
      LET sampleTimestamps = (
        FOR q IN queries
          SORT RAND()
          LIMIT 5
          RETURN q.timestamp
      )
      
      RETURN {
        now: now,
        nowISO: nowISO,
        testDate: testDate,
        sampleTimestamps: sampleTimestamps,
        dateTypeNow: TYPENAME(now),
        dateTypeISO: TYPENAME(nowISO),
        dateTypeTest: TYPENAME(testDate)
      }
    `;
    
    const cursor = await db.query(query);
    if (await cursor.hasNext()) {
      const result = await cursor.next();
      debug('DATE_NOW() debug results:');
      debug(JSON.stringify(result, null, 2));
    } else {
      debug('No results from DATE_NOW() debug query - database may be empty');
    }
  } catch (err) {
    debug(`Error in debug date query: ${err.message}`);
  }
};

// Modified service categories with purely numeric keys for maximum compatibility
const SERVICE_CATEGORIES = [
  { _key: '1', nameEN: 'Business & Economy', nameFR: 'Affaires & Économie', nameSW: 'Biashara & Uchumi', order: 1 },
  { _key: '2', nameEN: 'Transportation', nameFR: 'Transport', nameSW: 'Usafiri', order: 2 },
  { _key: '3', nameEN: 'Taxes & Revenue', nameFR: 'Impôts & Recettes', nameSW: 'Kodi & Mapato', order: 3 },
  { _key: '4', nameEN: 'Immigration & Citizenship', nameFR: 'Immigration & Citoyenneté', nameSW: 'Uhamiaji & Uraia', order: 4 },
  { _key: '5', nameEN: 'Education & Learning', nameFR: 'Éducation & Apprentissage', nameSW: 'Elimu & Mafunzo', order: 5 },
  { _key: '6', nameEN: 'Housing & Properties', nameFR: 'Logement & Propriétés', nameSW: 'Makazi & Mali', order: 6 },
  { _key: '7', nameEN: 'Health & Healthcare', nameFR: 'Santé & Soins Médicaux', nameSW: 'Afya & Huduma za Afya', order: 7 },
  { _key: '8', nameEN: 'Justice & Legal', nameFR: 'Justice & Juridique', nameSW: 'Haki & Sheria', order: 8 }
];

// Top queries mapping to the new numeric category keys
const TOP_QUERIES = [
  { text: 'How do I apply for a business license?', categoryKey: '1', count: 2347, avgTime: 2.3 },
  { text: 'Where can I find tax forms?', categoryKey: '3', count: 1982, avgTime: 1.8 },
  { text: 'How to renew my driver\'s license?', categoryKey: '2', count: 1645, avgTime: 2.1 },
  { text: 'What documents do I need for passport application?', categoryKey: '4', count: 1423, avgTime: 3.4 },
  { text: 'When are property taxes due?', categoryKey: '3', count: 1289, avgTime: 1.9 }
];

// Common questions for each category
const CATEGORY_QUESTIONS = {
  '1': [
    'How do I register a new business?',
    'What permits do I need for a small business?',
    'How can I apply for a business loan?',
    'What are the requirements for business tax filing?',
    'How to renew a business license?',
    'What is the process for obtaining a commercial license?',
    'How do I register for a business tax ID?',
    'What are the business regulation requirements?',
    'How can I export my products internationally?',
    'What government grants are available for small businesses?'
  ],
  '2': [
    'How do I renew my driver\'s license?',
    'What documents do I need for vehicle registration?',
    'How can I pay a traffic ticket?',
    'How to apply for a commercial driving permit?',
    'What are the vehicle inspection requirements?',
    'What is the process for getting a vehicle title transfer?',
    'How do I get a license plate replacement?',
    'What are the requirements for an international driving permit?',
    'How do I register an imported vehicle?',
    'What are the restrictions for learner drivers?'
  ],
  '3': [
    'When are income taxes due?',
    'How do I file my tax return?',
    'Can I get an extension for tax filing?',
    'How to check my tax refund status?',
    'What tax deductions are available for small businesses?',
    'How do I pay property taxes online?',
    'What is the deadline for business tax filing?',
    'How do I apply for a tax exemption?',
    'What tax credits am I eligible for?',
    'How do I report foreign income on my tax return?'
  ],
  '4': [
    'How do I apply for a passport?',
    'What documents do I need for citizenship application?',
    'How long does visa processing take?',
    'What are the requirements for permanent residency?',
    'How can I renew my work permit?',
    'What is the process for family reunification visas?',
    'How do I check my immigration application status?',
    'What are the fees for citizenship applications?',
    'How do I extend my visitor visa?',
    'What are the requirements for a student visa?'
  ],
  '5': [
    'How do I enroll my child in public school?',
    'What financial aid is available for college?',
    'How can I apply for a student loan?',
    'What continuing education programs are offered?',
    'How do I transfer school credits?',
    'What are the requirements for homeschooling?',
    'How do I apply for a scholarship?',
    'What standardized tests are required for college admission?',
    'How do I get my foreign degree recognized?',
    'What vocational training programs are available?'
  ],
  '6': [
    'How do I apply for public housing?',
    'What permits do I need for home renovation?',
    'How can I file a complaint against a landlord?',
    'What are the property tax rates?',
    'How do I contest a property assessment?',
    'What are the first-time homebuyer programs?',
    'How do I apply for a housing subsidy?',
    'What are my rights as a tenant?',
    'How do I register a property deed?',
    'What are the zoning regulations in my area?'
  ],
  '7': [
    'How do I sign up for health insurance?',
    'What vaccinations are required for school?',
    'How can I find a local healthcare provider?',
    'What mental health services are available?',
    'How do I access my medical records?',
    'What is the process for medical license renewal?',
    'How do I apply for disability benefits?',
    'What preventive healthcare services are covered?',
    'How do I find low-cost healthcare options?',
    'What are the healthcare options for seniors?'
  ],
  '8': [
    'How do I file a small claims case?',
    'What is the process for jury duty?',
    'How can I obtain court records?',
    'What legal aid services are available?',
    'How do I get a document notarized?',
    'How do I file for child custody?',
    'What are the requirements for a marriage license?',
    'How do I file a restraining order?',
    'What are the steps to contest a will?',
    'How do I change my legal name?'
  ]
};

// Generate a random integer between min and max (inclusive)
const randomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Generate a random date within a range
const randomDate = (start, end) => {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
};

// Generate a key that is purely numeric to maximize compatibility
let keyCounter = 0;
const generateKey = () => {
  keyCounter++;
  return String(keyCounter); // Just a string of digits, e.g., "1", "2", "3"
};

// Get a random query text from a specific category or random if no category
const getRandomQuery = (categoryKey = null) => {
  if (categoryKey && CATEGORY_QUESTIONS[categoryKey]) {
    const categoryQueries = CATEGORY_QUESTIONS[categoryKey];
    return categoryQueries[randomInt(0, categoryQueries.length - 1)];
  } else {
    // Random category, random query
    const randomCategory = SERVICE_CATEGORIES[randomInt(0, SERVICE_CATEGORIES.length - 1)]._key;
    const categoryQueries = CATEGORY_QUESTIONS[randomCategory];
    return categoryQueries[randomInt(0, categoryQueries.length - 1)];
  }
};

// Calculate users per month based on growth from 100 to 1000 over 3 years
const calculateUsersForMonth = (monthIndex, totalMonths) => {
  // Linear growth formula
  const growth = (1000 - 100) / totalMonths;
  const users = Math.floor(100 + (growth * monthIndex));
  return users;
};

// Calculate queries per user (between 5 and 50)
const calculateQueriesPerUser = () => {
  // Normal distribution around mean of 20 queries
  const mean = 20;
  const stdDev = 10;
  let queries = Math.floor(mean + (stdDev * (Math.random() + Math.random() + Math.random() - 1.5)));
  
  // Ensure within bounds 5-50
  return Math.min(50, Math.max(5, queries));
};

// Create sample event data for the events collection
const createSampleEvents = async (db, userCount, startDate, endDate) => {
  const eventTypes = [
    'pageView', 'buttonClick', 'formSubmission', 'download', 
    'login', 'logout', 'search', 'categorySelection'
  ];
  
  const eventCollection = db.collection('events');
  const totalEvents = userCount * 5; // Average 5 events per user
  
  console.log(`Creating ${totalEvents} sample events...`);
  
  for (let i = 0; i < totalEvents; i++) {
    const userKey = randomInt(1, userCount);
    const eventType = eventTypes[randomInt(0, eventTypes.length - 1)];
    const eventDate = randomDate(startDate, endDate);
    
    try {
      await eventCollection.save({
        _key: generateKey(),
        userId: `users/${userKey}`,
        eventType: eventType,
        timestamp: createCompatibleTimestamp(eventDate),
        data: {
          page: ['/home', '/services', '/contact', '/profile', '/dashboard'][randomInt(0, 4)],
          component: ['header', 'footer', 'sidebar', 'main', 'form'][randomInt(0, 4)],
          action: ['click', 'view', 'submit', 'hover', 'select'][randomInt(0, 4)]
        },
        createdAt: createCompatibleTimestamp(eventDate)
      });
      
      if (i % 1000 === 0) {
        console.log(`Created ${i} events so far...`);
      }
    } catch (err) {
      console.error(`Error creating event for user ${userKey}:`, err.message);
    }
  }
  
  console.log(`Created ${totalEvents} events.`);
};

// Create required indexes for improved query performance
const createIndexes = async (db) => {
  console.log('Creating necessary indexes for query performance...');
  
  const indexConfigs = [
    { collection: 'queries', fields: ['timestamp'], name: 'idx_queries_timestamp', type: 'persistent' },
    { collection: 'queries', fields: ['categoryId'], name: 'idx_queries_categoryId', type: 'persistent' },
    { collection: 'queries', fields: ['userId'], name: 'idx_queries_userId', type: 'persistent' },
    { collection: 'queries', fields: ['sessionId'], name: 'idx_queries_sessionId', type: 'persistent' },
    { collection: 'analytics', fields: ['timestamp'], name: 'idx_analytics_timestamp', type: 'persistent' },
    { collection: 'analytics', fields: ['type'], name: 'idx_analytics_type', type: 'persistent' },
    { collection: 'analytics', fields: ['userId'], name: 'idx_analytics_userId', type: 'persistent' },
    { collection: 'sessions', fields: ['startTime'], name: 'idx_sessions_startTime', type: 'persistent' },
    { collection: 'sessions', fields: ['userId'], name: 'idx_sessions_userId', type: 'persistent' }
  ];
  
  for (const config of indexConfigs) {
    try {
      const collection = db.collection(config.collection);
      
      // Check if index already exists
      const indexes = await collection.indexes();
      const exists = indexes.some(idx => 
        idx.type === config.type && 
        JSON.stringify(idx.fields) === JSON.stringify(config.fields)
      );
      
      if (exists) {
        console.log(`Index ${config.name} already exists on ${config.collection}`);
      } else {
        console.log(`Creating index ${config.name} on ${config.collection}...`);
        
        if (config.type === 'persistent') {
          await collection.ensureIndex({
            type: 'persistent',
            fields: config.fields,
            name: config.name
          });
        }
        
        console.log(`Created index ${config.name}`);
      }
    } catch (err) {
      console.error(`Error creating index ${config.name}:`, err.message);
    }
  }
  
  console.log('Index creation complete');
};

// Fix DATE_NOW() compatibility in test queries
const runTestQueriesWithWorkaround = async (db, startDate, endDate) => {
  try {
    debug('Running test queries with DATE_NOW() workaround...');
    
    // Create timestamps that will be directly compatible
    const startISO = createCompatibleTimestamp(startDate);
    const endISO = createCompatibleTimestamp(endDate);
    
    // Use direct ISO string comparison instead of DATE_NOW()
    const query = `
      // Use direct timestamp comparison instead of DATE_NOW()
      FOR q IN queries
        FILTER q.timestamp >= '${startISO}'
        FILTER q.timestamp <= '${endISO}'
        COLLECT WITH COUNT INTO count
        RETURN {
          dateRange: {
            start: '${startDate.toISOString().slice(0, 10)}',
            end: '${endDate.toISOString().slice(0, 10)}'
          },
          count: count
        }
    `;
    
    const cursor = await db.query(query);
    const result = await cursor.next();
    
    debug(`Test query results: ${JSON.stringify(result, null, 2)}`);
    
    return result;
  } catch (err) {
    debug(`Error in test query: ${err.message}`);
    return { error: err.message };
  }
};

// Main function to generate and save test data
const generateTestData = async () => {
  try {
    debug('Starting enhanced test data generation...');
    console.log('Connecting to ArangoDB...');
    const db = initDB();
    
    // Create or get collections
    console.log('Setting up collections...');
    
    // Helper function to ensure collection exists
    const ensureCollection = async (name, type = 'document') => {
      try {
        const collections = await db.listCollections();
        const collectionNames = collections.map(c => c.name);
        
        if (!collectionNames.includes(name)) {
          console.log(`Creating ${name} collection (${type})...`);
          if (type === 'edge') {
            await db.createEdgeCollection(name);
          } else {
            await db.createCollection(name);
          }
          console.log(`Created ${name} collection successfully`);
        } else {
          console.log(`Collection ${name} already exists`);
        }
        
        return db.collection(name);
      } catch (err) {
        console.error(`Error ensuring collection ${name}:`, err.message);
        throw err;
      }
    };
    
    // Ensure all required collections exist
    const serviceCategories = await ensureCollection('serviceCategories');
    const users = await ensureCollection('users');
    const sessions = await ensureCollection('sessions');
    const queries = await ensureCollection('queries');
    const analytics = await ensureCollection('analytics');
    const analyticsMetrics = await ensureCollection('analyticsMetrics');
    const events = await ensureCollection('events');
    
    // Ensure edge collections exist
    const userSessions = await ensureCollection('userSessions', 'edge');
    const sessionQueries = await ensureCollection('sessionQueries', 'edge');
    const queryCategories = await ensureCollection('queryCategories', 'edge');
    
    // Clear all collections first
    console.log('Clearing existing data...');
    await serviceCategories.truncate();
    await users.truncate();
    await sessions.truncate();
    await queries.truncate();
    await analytics.truncate();
    await analyticsMetrics.truncate();
    await events.truncate();
    await userSessions.truncate();
    await sessionQueries.truncate();
    await queryCategories.truncate();
    
    // Create service categories
    console.log('Creating service categories...');
    for (const category of SERVICE_CATEGORIES) {
      try {
        await serviceCategories.save(category);
        console.log(`Created category: ${category.nameEN}`);
      } catch (err) {
        console.error(`Error saving category ${category._key}:`, err.message);
      }
    }
    
    // Create required indexes for better query performance
    await createIndexes(db);
    
    // Create 3 years of data
    const endDate = new Date(); // Today
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 3); // 3 years ago
    
    const totalMonths = 36; // 3 years x 12 months
    
    // Generate months array with user and query distribution
    const months = [];
    for (let i = 0; i < totalMonths; i++) {
      const currentDate = new Date(startDate);
      currentDate.setMonth(startDate.getMonth() + i);
      
      // Calculate number of users for this month (growing from 100 to 1000)
      const activeUsers = calculateUsersForMonth(i, totalMonths);
      
      // Generate month data
      months.push({
        month: i,
        date: currentDate,
        activeUsers: activeUsers,
        // On average, each user makes queries on 3-5 different days per month
        activeDays: Math.min(28, activeUsers * randomInt(3, 5)), 
        totalQueries: 0 // Will be calculated later
      });
    }
    
    // Generate users (more than we need to allow for growth and churn)
    console.log('Creating users...');
    const totalUsers = 2000; // More than max monthly users to simulate churn
    
    for (let i = 0; i < totalUsers; i++) {
      const userKey = generateKey();
      const user = {
        _key: userKey,
        email: `user${userKey}@example.com`,
        createdAt: createCompatibleTimestamp(randomDate(startDate, endDate)),
        updatedAt: createCompatibleTimestamp(new Date()),
        
        // Required nested fields according to schema
        personalIdentification: {
          fullName: `Test User ${userKey}`,
          dob: '1990-01-01',
          gender: ['Male', 'Female', 'Other', 'Unknown'][randomInt(0, 3)],
          nationality: ['USA', 'Canada', 'UK', 'Australia', 'Kenya', 'France', 'Germany', 'Unknown'][randomInt(0, 7)],
          maritalStatus: ['Single', 'Married', 'Divorced', 'Widowed', 'Unknown'][randomInt(0, 4)]
        },
        
        // Required nested field according to schema
        addressResidency: {
          currentAddress: `${randomInt(100, 9999)} ${['Main St', 'Oak Ave', 'Maple Rd', 'First Blvd', 'Park Place'][randomInt(0, 4)]}`
        }
      };
      
      try {
        await users.save(user);
        if (i % 200 === 0) {
          console.log(`Created ${i} users so far...`);
        }
      } catch (err) {
        console.error(`Error saving user ${userKey}:`, err.message);
      }
    }
    
    console.log(`Created ${totalUsers} users`);
    
    // Create sessions, queries for each month
    console.log('Creating sessions and queries for 3 years of data...');
    let totalSessions = 0;
    let totalQueries = 0;
    
    // Make sure to include the current month data
    console.log('Ensuring current month data is included...');
    const currentMonth = new Date();
    currentMonth.setDate(1); // First day of current month
    currentMonth.setHours(0, 0, 0, 0);
    
    let hasCurrentMonth = false;
    for (const monthData of months) {
      if (monthData.date.getFullYear() === currentMonth.getFullYear() && 
          monthData.date.getMonth() === currentMonth.getMonth()) {
        hasCurrentMonth = true;
        break;
      }
    }
    
    if (!hasCurrentMonth) {
      console.log(`Adding current month (${currentMonth.toISOString().slice(0, 7)}) to ensure complete data...`);
      months.push({
        month: months.length,
        date: new Date(currentMonth),
        activeUsers: 1000, // Full user count for current month
        activeDays: Math.min(28, 1000 * randomInt(3, 5)),
        totalQueries: 0
      });
    }
    
    // Process each month
    for (const monthData of months) {
      const currentMonth = monthData.date;
      const monthUsers = monthData.activeUsers;
      
      console.log(`Processing month ${monthData.month + 1} (${currentMonth.toLocaleDateString()}) with ${monthUsers} active users`);
      
      // For current month, only process days up to today
      const isCurrentMonth = currentMonth.getFullYear() === new Date().getFullYear() && 
                             currentMonth.getMonth() === new Date().getMonth();
      
      let daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
      if (isCurrentMonth) {
        daysInMonth = Math.min(daysInMonth, new Date().getDate()); // Only up to today
        console.log(`Current month - processing ${daysInMonth} days (up to today)`);
      }
      
      // Create session days (not every user is active every day)
      for (let day = 1; day <= daysInMonth; day++) {
        // Calculate how many users are active this day
        const dailyActiveUsers = Math.min(monthUsers, Math.floor(monthData.activeDays / daysInMonth * monthUsers * (0.8 + Math.random() * 0.4)));
        
        // Use a different subset of users each day
        const dayUserStartIdx = randomInt(0, totalUsers - dailyActiveUsers);
        
        // Create a session for each active user this day
        for (let userIdx = 0; userIdx < dailyActiveUsers; userIdx++) {
          const userKey = String(dayUserStartIdx + userIdx + 1); // +1 because keys start at 1
          
          // Create a session
          const sessionKey = generateKey();
          const sessionDate = new Date(currentMonth);
          sessionDate.setDate(day);
          sessionDate.setHours(randomInt(8, 20)); // Between 8 AM and 8 PM
          
          const session = {
            _key: sessionKey,
            userId: `users/${userKey}`,
            startTime: createCompatibleTimestamp(sessionDate),
            endTime: createCompatibleTimestamp(new Date(sessionDate.getTime() + randomInt(5, 60) * 60000)), // 5-60 minutes
            device: ['desktop', 'mobile', 'tablet'][randomInt(0, 2)],
            platform: ['Windows', 'macOS', 'iOS', 'Android', 'Linux'][randomInt(0, 4)],
            active: false,
            createdAt: createCompatibleTimestamp(sessionDate)
          };
          
          try {
            await sessions.save(session);
            totalSessions++;
            
            if (totalSessions % 1000 === 0) {
              console.log(`Created ${totalSessions} sessions so far...`);
            }
            
            // Create edge from user to session
            await userSessions.save({
              _key: generateKey(),
              _from: session.userId,
              _to: `sessions/${sessionKey}`,
              createdAt: createCompatibleTimestamp(sessionDate)
            });
            
            // Create queries for this session
            // More recent sessions tend to have more queries
            const recencyBoost = monthData.month / totalMonths; // 0 to 1 based on how recent the month is
            const baseQueriesPerSession = calculateQueriesPerUser() / 30; // Split monthly queries across days
            const queriesPerSession = Math.max(1, Math.floor(baseQueriesPerSession * (1 + recencyBoost)));
            
            for (let j = 0; j < queriesPerSession; j++) {
              // 75% of queries should have a category assigned
              const hasCategoryAssigned = Math.random() < 0.75;
              
              // Select a random category
              const categoryIdx = randomInt(0, SERVICE_CATEGORIES.length - 1);
              const category = SERVICE_CATEGORIES[categoryIdx];
              
              const queryKey = generateKey();
              const queryTimestamp = new Date(sessionDate.getTime() + j * randomInt(30, 300) * 1000); // Spread queries 30-300 seconds apart
              
              const query = {
                _key: queryKey,
                userId: session.userId,
                sessionId: `sessions/${sessionKey}`,
                text: hasCategoryAssigned ? getRandomQuery(category._key) : getRandomQuery(),
                categoryId: hasCategoryAssigned ? `serviceCategories/${category._key}` : null,
                timestamp: createCompatibleTimestamp(queryTimestamp),
                responseTime: parseFloat((Math.random() * 3 + 0.5).toFixed(1)),
                isAnswered: Math.random() > 0.1 // 90% are answered
              };
              
              await queries.save(query);
              totalQueries++;
              
              if (totalQueries % 10000 === 0) {
                console.log(`Created ${totalQueries} queries so far...`);
              }
              
              // Create edge from session to query
              await sessionQueries.save({
                _key: generateKey(),
                _from: `sessions/${sessionKey}`,
                _to: `queries/${queryKey}`,
                createdAt: createCompatibleTimestamp(queryTimestamp)
              });
              
              // Create edge from query to category if category is assigned
              if (hasCategoryAssigned) {
                await queryCategories.save({
                  _key: generateKey(),
                  _from: `queries/${queryKey}`,
                  _to: `serviceCategories/${category._key}`,
                  confidence: 0.7 + Math.random() * 0.3
                });
              }
              
              // Create analytics record
              await analytics.save({
                _key: generateKey(),
                type: 'query',
                timestamp: query.timestamp,
                userId: query.userId,
                queryId: `queries/${queryKey}`,
                data: {
                  text: query.text,
                  categoryId: query.categoryId,
                  responseTime: query.responseTime,
                  isAnswered: query.isAnswered
                }
              });
              
              // 30% of queries get feedback
              if (Math.random() < 0.3) {
                // Rating distribution skews positive (most users only provide feedback when happy)
                let rating;
                const randVal = Math.random();
                if (randVal < 0.6) {
                  rating = randomInt(4, 5); // 60% chance of 4-5 stars
                } else if (randVal < 0.85) {
                  rating = 3; // 25% chance of 3 stars
                } else {
                  rating = randomInt(1, 2); // 15% chance of 1-2 stars
                }
                
                const feedbackTime = new Date(queryTimestamp.getTime() + randomInt(5, 300) * 1000);
                
                await analytics.save({
                  _key: generateKey(),
                  type: 'feedback',
                  timestamp: createCompatibleTimestamp(feedbackTime),
                  userId: query.userId,
                  queryId: `queries/${queryKey}`,
                  data: { 
                    rating,
                    comment: rating >= 4 ? 
                      ['Very helpful!', 'Great response!', 'Exactly what I needed!', 'Thank you!'][randomInt(0, 3)] : 
                      rating === 3 ? 
                        ['OK but could be more detailed', 'Somewhat helpful', 'Could be better'][randomInt(0, 2)] :
                        ['Not helpful', 'Didn\'t answer my question', 'Incorrect information', 'Too vague'][randomInt(0, 3)]
                  }
                });
                
                // Update query with feedback
                await queries.update(queryKey, {
                  userFeedback: {
                    rating: rating,
                    comment: rating >= 4 ? 
                      ['Very helpful!', 'Great response!', 'Exactly what I needed!', 'Thank you!'][randomInt(0, 3)] : 
                      rating === 3 ? 
                        ['OK but could be more detailed', 'Somewhat helpful', 'Could be better'][randomInt(0, 2)] :
                        ['Not helpful', 'Didn\'t answer my question', 'Incorrect information', 'Too vague'][randomInt(0, 3)],
                    providedAt: createCompatibleTimestamp(feedbackTime)
                  }
                });
              }
            }
            
            // Update the month's total queries
            monthData.totalQueries += queriesPerSession;
            
          } catch (err) {
            console.error(`Error creating session ${sessionKey}:`, err.message);
          }
        }
      }
      
      // Create metrics records for this month
      try {
        // Calculate overall data for the month
        const satisfactionRate = 70 + Math.floor(Math.random() * 20); // 70-90% satisfaction
        
        // Create daily metrics for the month
        const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
        
        // For current month, only process days up to today
        const maxDaysToProcess = isCurrentMonth ? Math.min(daysInMonth, new Date().getDate()) : daysInMonth;
        
        for (let day = 1; day <= maxDaysToProcess; day++) {
          const dayDate = new Date(currentMonth);
          dayDate.setDate(day);
          
          // Daily metrics
          const dailyQueries = Math.floor(monthData.totalQueries / daysInMonth * (0.7 + Math.random() * 0.6)); // Some variance day to day
          const dailyUsers = Math.floor(monthData.activeUsers / 3 * (0.7 + Math.random() * 0.6)); // Assume ~1/3 of monthly users active on a given day
          
          const metricsKey = generateKey();
          const startOfDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0);
          const endOfDay = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59);
          
          const metricsRecord = {
            _key: metricsKey,
            period: "daily",
            startDate: createCompatibleTimestamp(startOfDay),
            endDate: createCompatibleTimestamp(endOfDay),
            totalQueries: dailyQueries,
            uniqueUsers: dailyUsers,
            averageResponseTime: parseFloat((1.5 + Math.random() * 2).toFixed(1)),
            satisfactionRate: satisfactionRate + randomInt(-5, 5), // Slight daily variation
            
            // Distribute queries across categories
            queryDistribution: SERVICE_CATEGORIES.map(cat => {
              const weight = randomInt(5, 15); // Random distribution weight
              return {
                categoryId: `serviceCategories/${cat._key}`,
                count: Math.floor(dailyQueries * 0.75 * (weight / 70)) // 75% have categories, distribute by weights
              };
            }),
            
            topQueries: TOP_QUERIES.map(query => ({
              text: query.text,
              count: Math.floor(Math.random() * dailyQueries * 0.05), // Each top query gets up to 5% of daily queries
              avgTime: (query.avgTime * 0.8 + query.avgTime * 0.4 * Math.random()).toFixed(1)
            })),
            
            lastUpdated: createCompatibleTimestamp(new Date())
          };
          
          await analyticsMetrics.save(metricsRecord);
        }
        
        // Create monthly metrics record
        const monthlyMetricsKey = generateKey();
        const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 0, 0, 0);
        const endOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59);
        
        const monthlyMetricsRecord = {
          _key: monthlyMetricsKey,
          period: "monthly",
          startDate: createCompatibleTimestamp(startOfMonth),
          endDate: createCompatibleTimestamp(endOfMonth),
          totalQueries: monthData.totalQueries,
          uniqueUsers: monthData.activeUsers,
          averageResponseTime: parseFloat((1.5 + Math.random() * 2).toFixed(1)),
          satisfactionRate: satisfactionRate,
          
          queryDistribution: SERVICE_CATEGORIES.map(cat => {
            const weight = randomInt(5, 15); // Random distribution weight
            return {
              categoryId: `serviceCategories/${cat._key}`,
              count: Math.floor(monthData.totalQueries * 0.75 * (weight / 70)) // 75% have categories, distribute by weights
            };
          }),
          
          topQueries: TOP_QUERIES.map(query => ({
            text: query.text,
            count: Math.floor(Math.random() * monthData.totalQueries * 0.03), // Each top query gets up to 3% of monthly queries
            avgTime: (query.avgTime * 0.8 + query.avgTime * 0.4 * Math.random()).toFixed(1)
          })),
          
          lastUpdated: createCompatibleTimestamp(new Date())
        };
        
        await analyticsMetrics.save(monthlyMetricsRecord);
        
      } catch (err) {
        console.error(`Error creating metrics for month ${monthData.month + 1}:`, err.message);
      }
    }
    
    // Create sample events
    await createSampleEvents(db, totalUsers, startDate, endDate);
    
    // Print summary
    console.log(`
Summary:
- Service Categories: ${SERVICE_CATEGORIES.length}
- Users: ${totalUsers}
- Sessions: ${totalSessions}
- Queries: ${totalQueries}
- Analytics Records: ${totalQueries * 1.3} (queries + feedback)
- Data Period: 3 years (${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()})
    `);
    
    // Test query compatibility
    await debugDateFormats(db);
    
    // Test query for the most recent month using workaround
    console.log('Testing dashboard analytics query with workaround...');
    
    try {
      // Create 30 day range for testing
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30); // 30 days ago
      
      const result = await runTestQueriesWithWorkaround(db, recentDate, new Date());
      
      console.log('Dashboard analytics test result for recent month:');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.count > 0) {
        console.log('✅ Analytics data test successful!');
      } else {
        console.log('⚠️ Analytics data may have issues, please check the output.');
      }
      
      // Now try direct date comparison instead of DATE_NOW()
      console.log('Testing direct date comparison...');
      const directQuery = `
        FOR q IN queries
          FILTER q.timestamp >= '${createCompatibleTimestamp(recentDate)}'
          FILTER q.timestamp <= '${createCompatibleTimestamp(new Date())}'
          COLLECT WITH COUNT INTO count
          RETURN count
      `;
      
      const cursor = await db.query(directQuery);
      const directResult = await cursor.next();
      
      console.log(`Direct date comparison found ${directResult} queries in the last 30 days`);
      
      // Verify percentage of queries with categories
      const categorizedQuery = `
        LET totalQueries = (
          FOR q IN queries
            COLLECT WITH COUNT INTO queryCount
            RETURN queryCount
        )[0]
        
        LET categorizedQueries = (
          FOR q IN queries
            FILTER q.categoryId != null
            COLLECT WITH COUNT INTO queryCount
            RETURN queryCount
        )[0]
        
        RETURN {
          totalQueries: totalQueries,
          categorizedQueries: categorizedQueries,
          percentage: (categorizedQueries / totalQueries) * 100
        }
      `;
      
      console.log('Verifying percentage of categorized queries...');
      const catCursor = await db.query(categorizedQuery);
      const catResult = await catCursor.next();
      
      console.log('Categorization statistics:');
      console.log(JSON.stringify(catResult, null, 2));
      
      if (catResult.percentage >= 74 && catResult.percentage <= 76) {
        console.log('✅ Categorization target achieved: Approximately 75% of queries have categories assigned.');
      } else {
        console.log(`⚠️ Categorization target not met: ${catResult.percentage.toFixed(1)}% of queries have categories (target: 75%).`);
      }
      
      // Test with different date formats to debug DATE_NOW() issue
      const dateFormatTests = [
        { name: "ISO", format: `q.timestamp >= '${new Date(Date.now() - 86400000).toISOString()}'` },
        { name: "ISO with createCompatibleTimestamp", format: `q.timestamp >= '${createCompatibleTimestamp(new Date(Date.now() - 86400000))}'` },
        { name: "DATE_ISO8601", format: `q.timestamp >= DATE_ISO8601('${new Date(Date.now() - 86400000).toISOString()}')` },
        { name: "Custom DATE_ISO8601", format: `q.timestamp >= DATE_ISO8601('${createCompatibleTimestamp(new Date(Date.now() - 86400000))}')` },
        { name: "DATE_NOW()", format: `q.timestamp <= DATE_NOW()` }
      ];
      
      for (const test of dateFormatTests) {
        try {
          console.log(`Testing date format: ${test.name}`);
          const testQuery = `
            FOR q IN queries
              FILTER ${test.format}
              LIMIT 5
              RETURN q.timestamp
          `;
          
          const testCursor = await db.query(testQuery);
          const testResults = await testCursor.all();
          
          console.log(`Results: Found ${testResults.length} queries`);
          if (testResults.length > 0) {
            console.log(`Sample timestamp: ${testResults[0]}`);
          }
        } catch (err) {
          console.error(`Error testing format ${test.name}: ${err.message}`);
        }
      }
      
      // Special test for DATE_NOW() with ISO 8601 compatibility
      console.log('Performing special DATE_NOW() compatibility test...');
      const dateNowTest = `
        LET now = DATE_NOW()
        LET nowStr = DATE_ISO8601(now)
        LET nowTimestamp = DATE_TIMESTAMP(now)
        
        LET recent = (
          FOR q IN queries
            SORT q.timestamp DESC
            LIMIT 5
            RETURN {
              timestamp: q.timestamp,
              nowCompare: q.timestamp < now ? "before now" : "after now",
              isoCompare: q.timestamp < nowStr ? "before iso now" : "after iso now",
              difference: DATE_DIFF(q.timestamp, now, "ms")
            }
        )
        
        RETURN {
          now: now,
          nowStr: nowStr,
          nowTimestamp: nowTimestamp,
          recentQueries: recent
        }
      `;
      
      try {
        const nowCursor = await db.query(dateNowTest);
        const nowResult = await nowCursor.next();
        console.log('DATE_NOW() compatibility test results:');
        console.log(JSON.stringify(nowResult, null, 2));
        
        // Add a fallback solution if DATE_NOW() is still not working
        if (nowResult.recentQueries.some(q => q.nowCompare === "after now")) {
          console.log('⚠️ DATE_NOW() compatibility issue detected. Implementing fallback...');
          
          // Create a fallback solution by generating an ArangoDB function that fixes DATE_NOW()
          const createFixFunction = `
            CREATE OR REPLACE FUNCTION fixed_date_now() RETURNS DATE
            RETURN DATE_ISO8601(DATE_NOW())
          `;
          
          try {
            await db.query(createFixFunction);
            console.log('✅ Created fixed_date_now() function as a workaround');
            
            // Test the fixed function
            const fixTest = `
              LET fixedNow = fixed_date_now()
              
              FOR q IN queries
                FILTER q.timestamp <= fixedNow
                SORT q.timestamp DESC
                LIMIT 5
                RETURN {
                  timestamp: q.timestamp,
                  fixedCompare: q.timestamp <= fixedNow ? "correct" : "incorrect"
                }
            `;
            
            const fixCursor = await db.query(fixTest);
            const fixResults = await fixCursor.all();
            console.log('Fixed date function test results:');
            console.log(JSON.stringify(fixResults, null, 2));
          } catch (err) {
            console.error('Error creating fixed date function:', err.message);
          }
        }
      } catch (err) {
        console.error('Error in DATE_NOW() compatibility test:', err.message);
      }
      
    } catch (err) {
      console.error('Error testing analytics data:', err.message);
    }
    
    console.log('✅ Enhanced test data generation complete!');
    
  } catch (error) {
    debug(`Error in test data generation: ${error.message}`);
    console.error('❌ Error generating test data:', error);
  } finally {
    // Close the log file
    logStream.end();
  }
};

// Run the script
module.exports = { generateTestData };

// If this script is run directly (not imported as a module)
if (require.main === module) {
  generateTestData().catch(err => {
    console.error('Fatal error in test data generation:', err);
    process.exit(1);
  });
}