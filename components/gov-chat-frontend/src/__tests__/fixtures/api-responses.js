'use strict';

/**
 * API response fixtures for frontend tests.
 *
 * Response shapes match the actual backend API responses.
 * Backend API response shape is the source of truth.
 * User fields are consistent with backend __tests__/fixtures/users.js
 * for cross-component fixture consistency (FR36).
 */

// ---------------------------------------------------------------------------
// Chat responses
// ---------------------------------------------------------------------------

const conversationsListResponse = {
  conversations: [
    {
      _key: 'conv-1',
      _id: 'conversations/conv-1',
      userId: 'http://localhost:8080/realms/genie#user-123',
      userKey: 'users/user-123',
      title: 'How to apply for a passport',
      categoryId: 'citizenship',
      created: '2026-05-19T10:30:00.000Z',
      updated: '2026-05-19T10:35:00.000Z',
      messageCount: 5,
      isStarred: false,
      isArchived: false,
      tags: ['passport', 'travel']
    }
  ],
  pagination: {
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false
  }
};

const singleConversationResponse = {
  _key: 'conv-1',
  _id: 'conversations/conv-1',
  userId: 'http://localhost:8080/realms/genie#user-123',
  userKey: 'users/user-123',
  title: 'How to apply for a passport',
  categoryId: 'citizenship',
  created: '2026-05-19T10:30:00.000Z',
  updated: '2026-05-19T10:35:00.000Z',
  messageCount: 2,
  isStarred: false,
  isArchived: false,
  tags: ['passport']
};

const messagesListResponse = {
  messages: [
    {
      _key: 'msg-1',
      _id: 'messages/msg-1',
      conversationId: 'conv-1',
      content: 'How do I apply for a passport?',
      sender: 'user',
      userId: 'http://localhost:8080/realms/genie#user-123',
      timestamp: '2026-05-19T10:30:00.000Z',
      queryId: 'query-1',
      metadata: {},
      isRead: true
    },
    {
      _key: 'msg-2',
      _id: 'messages/msg-2',
      conversationId: 'conv-1',
      content: 'To apply for a passport, you need to visit the nearest office with your ID...',
      sender: 'assistant',
      userId: 'http://localhost:8080/realms/genie#user-123',
      timestamp: '2026-05-19T10:31:00.000Z',
      queryId: 'query-1',
      metadata: {},
      isRead: true
    }
  ],
  pagination: {
    total: 2,
    limit: 50,
    offset: 0,
    hasMore: false
  }
};

// ---------------------------------------------------------------------------
// Category / Service tree responses
// ---------------------------------------------------------------------------

const categoriesListResponse = [
  {
    catKey: 'citizenship',
    name: 'Citizenship and Immigration',
    children: ['passport-services', 'visa-services']
  },
  {
    catKey: 'health',
    name: 'Health Services',
    children: ['medical-card', 'insurance']
  }
];

const categoriesDetailedResponse = [
  {
    catKey: 'citizenship',
    name: 'Citizenship and Immigration',
    children: [
      { serviceKey: 'passport-services', serviceName: 'Passport Services' },
      { serviceKey: 'visa-services', serviceName: 'Visa Services' }
    ]
  }
];

const categoryTranslationsResponse = [
  { lang: 'FR', text: 'Citoyenneté et immigration' },
  { lang: 'ES', text: 'Ciudadanía e inmigración' }
];

// ---------------------------------------------------------------------------
// User profile responses
// ---------------------------------------------------------------------------

const userProfileResponse = {
  _key: 'users/user-123',
  _id: 'users/user-123',
  email: 'test@example.com',
  name: 'Test User',
  roles: ['user'],
  emailVerified: true,
  createdAt: '2026-01-15T08:00:00.000Z',
  updatedAt: '2026-05-19T10:30:00.000Z',
  locale: 'en',
  preferences: {
    theme: 'light',
    notificationsEnabled: true
  }
};

const userContextResponse = {
  name: 'Test User',
  role: ['user'],
  emailVerified: true
};

// ---------------------------------------------------------------------------
// Analytics responses
// ---------------------------------------------------------------------------

const analyticsDashboardResponse = {
  queries: {
    total: 1523,
    unanswered: 42,
    answeredPercentage: 97.24,
    avgResponseTime: 2.8
  },
  categories: [
    { categoryId: 'citizenship', name: 'Citizenship and Immigration', count: 423 },
    { categoryId: 'health', name: 'Health Services', count: 312 }
  ],
  feedback: {
    total: 891,
    positive: 723,
    neutral: 124,
    negative: 44,
    positivePercentage: 81.1,
    negativePercentage: 4.9
  },
  users: {
    activeCount: 234
  },
  topQueries: [
    { text: 'How to apply for passport', count: 45, avgTime: 2.3 },
    { text: 'Medical card requirements', count: 38, avgTime: 3.1 }
  ]
};

const analyticsTimeseriesResponse = [
  { timestamp: '2026-05-19T00:00:00.000Z', value: 145 },
  { timestamp: '2026-05-19T01:00:00.000Z', value: 132 },
  { timestamp: '2026-05-19T02:00:00.000Z', value: 98 }
];

// ---------------------------------------------------------------------------
// Document / File responses
// ---------------------------------------------------------------------------

const fileListResponse = {
  files: [
    {
      _key: 'file-1',
      _id: 'files/file-1',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024000,
      uploadedBy: 'user-123',
      uploadedAt: '2026-05-19T10:30:00.000Z',
      status: 'ready',
      metadata: {
        pages: 10,
        title: 'Annual Report 2026'
      }
    }
  ],
  pagination: {
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false
  }
};

const fileUploadResponse = {
  _key: 'file-1',
  _id: 'files/file-1',
  originalName: 'report.pdf',
  mimeType: 'application/pdf',
  size: 1024000,
  uploadedBy: 'user-123',
  uploadedAt: '2026-05-19T10:30:00.000Z',
  status: 'processing',
  metadata: {}
};

module.exports = {
  // Chat
  conversationsListResponse,
  singleConversationResponse,
  messagesListResponse,
  // Categories
  categoriesListResponse,
  categoriesDetailedResponse,
  categoryTranslationsResponse,
  // User profile
  userProfileResponse,
  userContextResponse,
  // Analytics
  analyticsDashboardResponse,
  analyticsTimeseriesResponse,
  // Files
  fileListResponse,
  fileUploadResponse
};
