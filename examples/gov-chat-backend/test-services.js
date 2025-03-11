// test-services.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000/api';
const TEST_IMAGE_PATH = path.join(__dirname, 'test-image.jpg'); // Create a test image or replace with any image path

// Create a test image if it doesn't exist
if (!fs.existsSync(TEST_IMAGE_PATH)) {
  // Create a simple 10x10 black square as a test image
  const buffer = Buffer.alloc(100); // 10x10 black pixels
  fs.writeFileSync(TEST_IMAGE_PATH, buffer);
  console.log(`Created test image at ${TEST_IMAGE_PATH}`);
}

// Helper function to format results
function formatResult(test, success, data = null, error = null) {
  return {
    test,
    success,
    data: success ? data : null,
    error: !success ? (error?.response?.data || error?.message || error) : null,
    timestamp: new Date().toISOString()
  };
}

// Axios instance with error handling
const api = axios.create({
  baseURL: API_URL,
  timeout: 10000, // 10 seconds
});

// Tests for User Service
async function testUserService() {
  console.log('\n🧪 TESTING USER SERVICE');
  const results = [];
  let userId = null;
  
  // Test 1: Create User
  try {
    console.log('Testing user creation...');
    const formData = new FormData();
    
    const userData = {
      personalIdentification: {
        fullName: 'Test User',
        dob: '1990-01-01',
        gender: 'Other',
        nationality: 'Test Country'
      },
      addressResidency: {
        currentAddress: '123 Test Street'
      }
    };
    
    formData.append('data', JSON.stringify(userData));
    
    // Add a test image file
    if (fs.existsSync(TEST_IMAGE_PATH)) {
      const fileContent = fs.readFileSync(TEST_IMAGE_PATH);
      formData.append('personalIdentification-photo', fileContent, {
        filename: 'test-image.jpg',
        contentType: 'image/jpeg'
      });
    }
    
    const response = await api.post('/users', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });
    
    userId = response.data._key;
    results.push(formatResult('User Creation', true, { userId }));
    console.log(`✅ User created with ID: ${userId}`);
  } catch (error) {
    results.push(formatResult('User Creation', false, null, error));
    console.error('❌ User creation failed:', error.message);
    // If user creation fails, use a hardcoded test user ID for subsequent tests
    userId = 'test_user_fallback';
  }
  
  // Test 2: Search Users
  try {
    console.log('Testing user search...');
    const response = await api.get('/users', {
      params: { 
        limit: 10, 
        offset: 0
      }
    });
    
    results.push(formatResult('Search Users', true, { 
      count: response.data.users?.length || 0,
      pagination: response.data.pagination
    }));
    console.log(`✅ Found ${response.data.users?.length || 0} users`);
  } catch (error) {
    results.push(formatResult('Search Users', false, null, error));
    console.error('❌ User search failed:', error.message);
  }
  
  return { results, userId };
}

// Tests for Service Categories
async function testServiceCategories() {
  console.log('\n🧪 TESTING SERVICE CATEGORIES');
  const results = [];
  
  // Test 1: Get All Categories
  try {
    console.log('Testing retrieval of all categories...');
    const response = await api.get('/services/categories');
    
    const categoriesCount = response.data?.length || 0;
    results.push(formatResult('Get All Categories', true, { 
      count: categoriesCount,
      categories: response.data?.slice(0, 3) // Just include first 3 for brevity
    }));
    console.log(`✅ Retrieved ${categoriesCount} categories`);
    
    // Test 2: Search Categories
    try {
      console.log('Testing category search...');
      const searchTerm = 'health';
      const searchResponse = await api.get('/services/search', {
        params: { query: searchTerm }
      });
      
      results.push(formatResult('Search Categories', true, { 
        categories: searchResponse.data?.categories?.length || 0,
        services: searchResponse.data?.services?.length || 0
      }));
      console.log(`✅ Search for "${searchTerm}" returned ${searchResponse.data?.categories?.length || 0} categories and ${searchResponse.data?.services?.length || 0} services`);
    } catch (error) {
      results.push(formatResult('Search Categories', false, null, error));
      console.error('❌ Category search failed:', error.message);
    }
    
  } catch (error) {
    results.push(formatResult('Get All Categories', false, null, error));
    console.error('❌ Category retrieval failed:', error.message);
  }
  
  return { results };
}

// Tests for Query Service
async function testQueryService(userId) {
  console.log('\n🧪 TESTING QUERY SERVICE');
  const results = [];
  let queryId = null;
  let sessionId = `test_session_${Date.now()}`; // Mock session ID
  
  // Test 1: Create Query
  try {
    console.log('Testing query creation...');
    const queryData = {
      userId: userId || 'test_user_fallback',
      sessionId: sessionId,
      text: 'How do I apply for a health insurance card?',
      categoryId: 'health'
    };
    
    const response = await api.post('/queries', queryData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    queryId = response.data._key;
    
    results.push(formatResult('Create Query', true, { 
      queryId,
      text: response.data.text
    }));
    console.log(`✅ Query created with ID: ${queryId}`);
  } catch (error) {
    results.push(formatResult('Create Query', false, null, error));
    console.error('❌ Query creation failed:', error.message);
  }
  
  // Test 2: Search Queries
  try {
    console.log('Testing query search...');
    const response = await api.get('/queries', {
      params: { 
        limit: 10, 
        offset: 0
      }
    });
    
    results.push(formatResult('Search Queries', true, { 
      count: response.data.queries?.length || 0,
      pagination: response.data.pagination
    }));
    console.log(`✅ Found ${response.data.queries?.length || 0} queries`);
  } catch (error) {
    results.push(formatResult('Search Queries', false, null, error));
    console.error('❌ Query search failed:', error.message);
  }
  
  // Test 3: Add Feedback to Query (This should trigger analytics creation)
  if (queryId) {
    try {
      console.log('Testing adding feedback to query...');
      const feedbackData = {
        rating: 4,
        comment: 'This was a helpful response'
      };
      
      const response = await api.post(`/queries/${queryId}/feedback`, feedbackData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      results.push(formatResult('Add Query Feedback', true, {
        queryId,
        feedback: feedbackData
      }));
      console.log(`✅ Feedback added to query ${queryId}`);
    } catch (error) {
      results.push(formatResult('Add Query Feedback', false, null, error));
      console.error(`❌ Adding feedback to query ${queryId} failed:`, error.message);
    }
  }
  
  // Test 4: Mark Query as Answered (This should also update analytics)
  if (queryId) {
    try {
      console.log('Testing marking query as answered...');
      const answerData = {
        responseTime: 1500 // 1.5 seconds
      };
      
      const response = await api.put(`/queries/${queryId}/answered`, answerData, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      results.push(formatResult('Mark Query Answered', true, {
        queryId,
        isAnswered: response.data.isAnswered,
        responseTime: response.data.responseTime
      }));
      console.log(`✅ Query ${queryId} marked as answered`);
    } catch (error) {
      results.push(formatResult('Mark Query Answered', false, null, error));
      console.error(`❌ Marking query ${queryId} as answered failed:`, error.message);
    }
  }
  
  return { results, queryId };
}

// Tests for Session Service
async function testSessionService(userId) {
  console.log('\n🧪 TESTING SESSION SERVICE');
  const results = [];
  let sessionId = null;
  
  // Test 1: Create Session
  try {
    console.log('Testing session creation...');
    const sessionData = {
      userId: userId || 'test_user_fallback',
      deviceInfo: {
        type: 'desktop'
      }
    };
    
    const response = await api.post('/sessions', sessionData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    sessionId = response.data._key;
    
    results.push(formatResult('Create Session', true, { 
      sessionId,
      startTime: response.data.startTime
    }));
    console.log(`✅ Session created with ID: ${sessionId}`);
  } catch (error) {
    results.push(formatResult('Create Session', false, null, error));
    console.error('❌ Session creation failed:', error.message);
  }
  
  return { results, sessionId };
}

// Tests for Analytics Service
async function testAnalyticsService() {
  console.log('\n🧪 TESTING ANALYTICS SERVICE');
  const results = [];
  
  // Test 1: Get Dashboard Analytics
  try {
    console.log('Testing dashboard analytics retrieval...');
    // Use current date for testing
    const today = new Date().toISOString().split('T')[0];
    const response = await api.get('/analytics/dashboard', {
      params: { 
        startDate: today,
        endDate: new Date().toISOString()  // Use full ISO string for endDate
      }
    });
    
    results.push(formatResult('Get Dashboard Analytics', true, response.data));
    console.log('✅ Dashboard analytics retrieved successfully');
  } catch (error) {
    results.push(formatResult('Get Dashboard Analytics', false, null, error));
    console.error('❌ Dashboard analytics retrieval failed:', error.message);
  }
  
  // Test 2: Get General Analytics
  try {
    console.log('Testing general analytics retrieval...');
    // Explicitly provide start and end dates
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // 30 days ago
    
    const response = await api.get('/analytics', {
      params: { 
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      }
    });
    
    results.push(formatResult('Get General Analytics', true, response.data));
    console.log('✅ General analytics retrieved successfully');
  } catch (error) {
    results.push(formatResult('Get General Analytics', false, null, error));
    console.error('❌ General analytics retrieval failed:', error.message);
  }
  
  // Test 3: Track Event
  try {
    console.log('Testing event tracking...');
    const eventData = {
      userId: 'test_user_fallback',
      eventType: 'pageView',
      eventData: {
        page: 'home'
      }
    };
    
    const response = await api.post('/analytics/events', eventData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    results.push(formatResult('Track Event', true, response.data));
    console.log('✅ Event tracked successfully');
  } catch (error) {
    results.push(formatResult('Track Event', false, null, error));
    console.error('❌ Event tracking failed:', error.message);
  }
  
  // Test 4: Verify Analytics Records
  try {
    console.log('Testing analytics records verification...');
    const response = await api.get('/analytics/records', {
      params: { 
        limit: 10, 
        offset: 0
      }
    });
    
    results.push(formatResult('Get Analytics Records', true, { 
      count: response.data?.length || 0,
      records: response.data?.slice(0, 3) // Just include first 3 for brevity
    }));
    console.log(`✅ Found ${response.data?.length || 0} analytics records`);
  } catch (error) {
    results.push(formatResult('Get Analytics Records', false, null, error));
    console.error('❌ Analytics records verification failed:', error.message);
    
    // Optional fallback: Try to check events if analytics records fail
    try {
      console.log('Falling back to check events instead...');
      const eventsResponse = await api.get('/analytics/events', {
        params: { 
          limit: 10, 
          offset: 0
        }
      });
      
      results.push(formatResult('Get Events Records', true, { 
        count: eventsResponse.data?.length || 0
      }));
      console.log(`✅ Found ${eventsResponse.data?.length || 0} events`);
    } catch (eventsError) {
      results.push(formatResult('Get Events Records', false, null, eventsError));
      console.error('❌ Events records verification failed:', eventsError.message);
    }
  }
  
  return { results };
}

// Main test function
async function runAllTests() {
  console.log('🚀 STARTING SERVICE TESTS');
  console.log(`API URL: ${API_URL}`);
  
  // Store all test results
  const allResults = {};
  
  // Run user tests first to get a user ID
  const userTests = await testUserService();
  allResults.userService = userTests.results;
  const userId = userTests.userId;
  
  // Run service category tests
  const categoryTests = await testServiceCategories();
  allResults.serviceCategoriesService = categoryTests.results;
  
  // Run query tests with the user ID
  const queryTests = await testQueryService(userId);
  allResults.queryService = queryTests.results;
  
  // Run session tests with the user ID
  const sessionTests = await testSessionService(userId);
  allResults.sessionService = sessionTests.results;
  
  // Run analytics tests
  const analyticsTests = await testAnalyticsService();
  allResults.analyticsService = analyticsTests.results;
  
  // Generate summary
  console.log('\n📊 TEST SUMMARY');
  
  let totalTests = 0;
  let passedTests = 0;
  
  Object.keys(allResults).forEach(service => {
    const serviceResults = allResults[service];
    const servicePassed = serviceResults.filter(r => r.success).length;
    const serviceTotal = serviceResults.length;
    
    totalTests += serviceTotal;
    passedTests += servicePassed;
    
    console.log(`${service}: ${servicePassed}/${serviceTotal} tests passed (${Math.round(servicePassed/serviceTotal*100)}%)`);
  });
  
  console.log(`\nOverall: ${passedTests}/${totalTests} tests passed (${Math.round(passedTests/totalTests*100)}%)`);
  
  // Save results to file
  const resultFile = path.join(__dirname, 'test-results.json');
  fs.writeFileSync(resultFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      totalTests,
      passedTests,
      percentage: Math.round(passedTests/totalTests*100)
    },
    results: allResults
  }, null, 2));
  
  console.log(`\nDetailed results saved to: ${resultFile}`);
}

// Run all tests
runAllTests().catch(error => {
  console.error('Error running tests:', error);
});