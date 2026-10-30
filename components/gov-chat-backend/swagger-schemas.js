// Shared OpenAPI component schemas — the single source of truth for the
// components.schemas section of the runtime spec. Some are $ref'd from the
// route annotations (Analytics, CategoryTree, Event, QueryContext); the rest
// document the runtime contract in swagger-ui. Consumed by index.js (the
// runtime swagger spec) and by scripts/generate-api-client.sh (the mobile
// client generation spec), so both specs carry the same schemas.
module.exports = {
  Event: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      userId: { type: 'string', description: 'ID of the user' },
      eventType: { type: 'string', description: 'Type of event' },
      eventData: { type: 'object', description: 'Additional event data' },
      timestamp: { type: 'string', format: 'date-time', description: 'Event timestamp' }
    }
  },
  Analytics: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      queryCount: { type: 'integer', description: 'Number of queries' },
      feedbackCount: { type: 'integer', description: 'Number of feedback submissions' },
      avgRating: { type: 'number', description: 'Average rating' },
      timestamp: { type: 'string', format: 'date-time', description: 'Analytics timestamp' }
    }
  },
  Query: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      userId: { type: 'string', description: 'ID of the user' },
      sessionId: { type: 'string', description: 'ID of the session' },
      text: { type: 'string', description: 'Query text' },
      isAnswered: { type: 'boolean', description: 'Whether the query has been answered' },
      timestamp: { type: 'string', format: 'date-time', description: 'Query timestamp' },
      categoryId: { type: 'string', description: 'Category ID' },
      feedback: {
        type: 'object',
        properties: {
          rating: { type: 'number' },
          comment: { type: 'string' }
        }
      }
    }
  },
  // The hierarchy tree, as both public endpoints serve it. ONE
  // definition: the wire contract must not be written twice. The two
  // trees differ in ONE field: the public tree falls back to the
  // ENGLISH name for its display name, the admin tree does not (the
  // admin panel keys its label map by the display name) — the
  // descriptions of `name` say which tree they describe.
  CategoryTree: {
    type: 'object',
    properties: {
      catKey: { type: 'string' },
      catCode: { type: 'string', nullable: true },
      name: {
        type: 'string',
        nullable: true,
        description:
          'The name the UI displays: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation.'
      },
      nameEN: {
        type: 'string',
        nullable: true,
        description:
          "The ENGLISH name — the SSOT every filter label is spoken in. Clients put THIS value on the query wire; the localized `name` is display-only. It is the English translation row, or the entity document's own `nameEN` for an entity with no English translation row."
      },
      children: {
        type: 'array',
        description: "The category's services, display + wire spellings.",
        items: {
          type: 'object',
          properties: {
            _key: {
              type: 'string',
              description:
                "The service entity's stable key. Neither spelling of the name is unique inside a category, so identity that survives renames and locale switches keys on this."
            },
            name: {
              type: 'string',
              nullable: true,
              description:
                'Display name: the localized translation, or — on the PUBLIC tree — the ENGLISH one when the active locale has no translation.'
            },
            nameEN: {
              type: 'string',
              nullable: true,
              description:
                "The ENGLISH name, the filter wire (SSOT): the English translation row, or the entity document's own `nameEN` for an entity with no English translation row."
            }
          }
        }
      }
    }
  },
  // The scope a query is filtered by. The labels are ENGLISH: the
  // corpus's chunk_labels carry the EN translation, so a localized
  // label matches no chunk and scopes the query to nothing.
  QueryContext: {
    type: 'object',
    description: 'Context labels (required for conversation mode)',
    properties: {
      categoryLabel: {
        type: 'string',
        nullable: true,
        description:
          "The ENGLISH label of the category — the SSOT every filter label is spoken in (the hierarchy's own `nameEN`). It is forwarded to the retriever as is: a label that matches no chunk scopes the query to nothing."
      },
      categoryLabels: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The legacy PLURAL spelling of categoryLabel (the upstream OPEA field). Honoured like the singular when present; a bare string is read as ONE label. Clients of this API should send the singular.'
      },
      serviceLabels: {
        type: 'array',
        items: { type: 'string' },
        description:
          'ENGLISH service labels. A bare string is also accepted and read as ONE label (never as a sequence of characters, never as an empty scope).'
      },
      language: { type: 'string', default: 'EN' }
    }
  },
  Session: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      userId: { type: 'string', description: 'ID of the user' },
      startTime: { type: 'string', format: 'date-time', description: 'Session start time' },
      endTime: { type: 'string', format: 'date-time', description: 'Session end time' },
      isActive: { type: 'boolean', description: 'Whether the session is active' },
      deviceInfo: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          browser: { type: 'string' },
          os: { type: 'string' }
        }
      },
      ipAddress: { type: 'string', description: 'Client IP address' }
    }
  },
  User: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      email: { type: 'string', format: 'email', description: 'User email address' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' }
    }
  },
  Conversation: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      userId: { type: 'string', description: 'ID of the user who owns the conversation' },
      title: { type: 'string', description: 'Conversation title' },
      categoryId: { type: 'string', description: 'ID of the service category' },
      lastMessage: { type: 'string', description: 'Preview of the last message' },
      created: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
      updated: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
      messageCount: { type: 'integer', description: 'Number of messages in the conversation' },
      isStarred: { type: 'boolean', description: 'Whether the conversation is starred' },
      isArchived: { type: 'boolean', description: 'Whether the conversation is archived' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags associated with the conversation'
      }
    }
  },
  Message: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      conversationId: { type: 'string', description: 'ID of the parent conversation' },
      userId: { type: 'string', description: 'ID of the user who sent or received the message' },
      content: { type: 'string', description: 'Message content' },
      timestamp: { type: 'string', format: 'date-time', description: 'Message timestamp' },
      sender: {
        type: 'string',
        enum: ['user', 'assistant'],
        description: 'Sender type (user or assistant)'
      },
      queryId: { type: 'string', description: 'Optional ID of a related query (for assistant messages)' },
      readStatus: { type: 'boolean', description: 'Whether the message has been read' },
      metadata: {
        type: 'object',
        description: 'Additional message metadata'
      }
    }
  },
  Folder: {
    type: 'object',
    properties: {
      _key: { type: 'string', description: 'Unique identifier' },
      name: { type: 'string', description: 'Folder name' },
      description: { type: 'string', description: 'Folder description' },
      created: { type: 'string', format: 'date-time', description: 'Creation timestamp' },
      updated: { type: 'string', format: 'date-time', description: 'Last update timestamp' },
      isArchived: { type: 'boolean', description: 'Whether the folder is archived' },
      color: { type: 'string', description: 'Color code for the folder' },
      icon: { type: 'string', description: 'Icon identifier for the folder' },
      parentFolderId: { type: 'string', description: 'Parent folder ID (null for root folders)' },
      order: { type: 'integer', description: 'Display order within parent' }
    }
  },
  FolderListResponse: {
    type: 'object',
    properties: {
      folders: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/Folder'
        }
      }
    }
  },
  ConversationListResponse: {
    type: 'object',
    properties: {
      conversations: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/Conversation'
        }
      },
      total: {
        type: 'integer',
        description: 'Total number of conversations matching the filter criteria'
      },
      offset: {
        type: 'integer',
        description: 'Current offset for pagination'
      },
      limit: {
        type: 'integer',
        description: 'Current limit for pagination'
      }
    }
  },
  MessageListResponse: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/Message'
        }
      },
      total: {
        type: 'integer',
        description: 'Total number of messages in the conversation'
      },
      offset: {
        type: 'integer',
        description: 'Current offset for pagination'
      },
      limit: {
        type: 'integer',
        description: 'Current limit for pagination'
      }
    }
  },
  SearchResponse: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            conversation: { $ref: '#/components/schemas/Conversation' },
            snippet: { type: 'string', description: 'Text snippet containing the search match' },
            matchType: { type: 'string', description: 'Type of match (title, message, etc.)' }
          }
        }
      },
      total: { type: 'integer', description: 'Total number of matching results' },
      offset: { type: 'integer', description: 'Current offset for pagination' },
      limit: { type: 'integer', description: 'Current limit for pagination' }
    }
  },
  ConversationStats: {
    type: 'object',
    properties: {
      totalConversations: { type: 'integer', description: 'Total number of conversations' },
      totalMessages: { type: 'integer', description: 'Number of messages' },
      avgMessagesPerConversation: { type: 'number', description: 'Average number of messages per conversation' },
      starredCount: { type: 'integer', description: 'Number of starred conversations' },
      archivedCount: { type: 'integer', description: 'Number of archived conversations' },
      conversationsByCategory: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            categoryId: { type: 'string', description: 'Category ID' },
            count: { type: 'integer', description: 'Number of conversations in this category' }
          }
        }
      },
      messagesByType: {
        type: 'object',
        properties: {
          user: { type: 'integer', description: 'Number of user messages' },
          assistant: { type: 'integer', description: 'Number of assistant messages' }
        }
      }
    }
  }
};
