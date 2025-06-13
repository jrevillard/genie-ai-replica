// src/i18n/locales/en.js

export default {
  countries: {
    // Selected common countries shown here, in production you would include all countries
    'AF': 'Afghanistan',
    'DZ': 'Algeria',
    'AO': 'Angola',
    'AR': 'Argentina',
    'AU': 'Australia',
    'AT': 'Austria',
    'BD': 'Bangladesh',
    'BE': 'Belgium',
    'BR': 'Brazil',
    'CM': 'Cameroon',
    'CA': 'Canada',
    'CL': 'Chile',
    'CN': 'China',
    'CO': 'Colombia',
    'CD': 'Democratic Republic of the Congo',
    'DK': 'Denmark',
    'EG': 'Egypt',
    'ET': 'Ethiopia',
    'FI': 'Finland',
    'FR': 'France',
    'DE': 'Germany',
    'GH': 'Ghana',
    'IN': 'India',
    'ID': 'Indonesia',
    'IR': 'Iran',
    'IQ': 'Iraq',
    'IE': 'Ireland',
    'IL': 'Israel',
    'IT': 'Italy',
    'JP': 'Japan',
    'JO': 'Jordan',
    'KE': 'Kenya',
    'KW': 'Kuwait',
    'LB': 'Lebanon',
    'MG': 'Madagascar',
    'MY': 'Malaysia',
    'MX': 'Mexico',
    'MA': 'Morocco',
    'MZ': 'Mozambique',
    'NL': 'Netherlands',
    'NZ': 'New Zealand',
    'NG': 'Nigeria',
    'NO': 'Norway',
    'PK': 'Pakistan',
    'PS': 'Palestine',
    'PE': 'Peru',
    'PH': 'Philippines',
    'PL': 'Poland',
    'PT': 'Portugal',
    'QA': 'Qatar',
    'RO': 'Romania',
    'RU': 'Russia',
    'SA': 'Saudi Arabia',
    'SN': 'Senegal',
    'SG': 'Singapore',
    'ZA': 'South Africa',
    'ES': 'Spain',
    'SD': 'Sudan',
    'SE': 'Sweden',
    'CH': 'Switzerland',
    'SY': 'Syria',
    'TZ': 'Tanzania',
    'TH': 'Thailand',
    'TN': 'Tunisia',
    'TR': 'Turkey',
    'UG': 'Uganda',
    'UA': 'Ukraine',
    'AE': 'United Arab Emirates',
    'GB': 'United Kingdom',
    'US': 'United States',
    'VE': 'Venezuela',
    'VN': 'Vietnam',
    'YE': 'Yemen',
    'ZM': 'Zambia',
    'ZW': 'Zimbabwe'
  },
  verification: {
    verifying: 'Verifying your email...',
    success: 'Email Verified Successfully!',
    failed: 'Verification Failed',
    accountVerified: 'Your account has been successfully verified. You can now log in to your account.',
    invalidLink: 'The verification link is invalid or has expired.',
    missingToken: 'Verification token is missing.',
    generalError: 'An error occurred during verification. Please try again later.',
    proceedToLogin: 'Proceed to Login',
    backToLogin: 'Back to Login'
  },

  admin: {
    // General dashboard labels
    huduma: 'Huduma AI',
    dashboard: 'Dashboard',
    system: 'System',
    settings: 'Settings',
    overview: 'Overview',
    database: 'Database',
    logs: 'Logs',
    userManagement: 'User Management',
    security: 'Security',
    systemAdministration: 'System Administration',
    loading: 'Loading...',
    close: 'Close dashboard',
    edit: 'Edit',

    // Stats and metrics
    systemUptime: 'System Uptime',
    avgResponseTime: 'Average Response Time',
    errorRate: 'Error Rate',
    activeUsers: 'Active Users',
    fromLastMonth: 'from last month',

    // Tab labels
    tabs: {
      overview: 'System Health',
      database: 'Database',
      logs: 'Logs',
      security: 'Security',
      users: 'Users'
    },

    // System health
    systemHealthStatus: 'System Health Status',
    runDiagnostics: 'Run Diagnostics',
    resourceUsage: 'Resource Usage',

    // Service names
    services: {
      apiServices: 'API Services',
      database: 'Database',
      cache: 'Cache',
      storage: 'Storage',
      messageQueue: 'Message Queue',
      externalApi: 'External API'
    },

    // Resource types
    resources: {
      cpu: 'CPU Usage',
      memory: 'Memory Usage',
      storage: 'Storage Usage',
      network: 'Network Bandwidth'
    },

    // Database management
    databaseManagement: 'Database Management',
    reindexDatabase: 'Reindex Database',
    lastReindex: 'Last Reindex',
    databaseSize: 'Database Size',
    totalTables: 'Total Tables',

    // Log management
    logManagement: 'Log Management',
    rolloverLogs: 'Rollover Logs',
    searchLogs: 'Search Logs',
    logTime: 'Time',
    logLevel: 'Level',
    logService: 'Service',
    logMessage: 'Message',
    showingEntries: 'Showing {start}-{end} of {total} entries',

    // Log levels
    logLevels: {
      error: 'ERROR',
      warn: 'WARN',
      info: 'INFO',
      debug: 'DEBUG'
    },

    // Log messages
    logMessages: {
      connectionTimeout: 'Connection timeout to external provider',
      lowDiskSpace: 'Disk space below 10% threshold',
      userRoleUpdated: 'User role updated for admin@huduma.ai'
    },

    // Security monitoring
    securityMonitoring: 'Security Monitoring',
    securityScan: 'Security Scan',
    failedLoginAttempts: 'Failed Login Attempts (24h)',
    suspiciousActivities: 'Suspicious Activities (24h)',
    lastSecurityScan: 'Last Security Scan',
    vulnerabilitiesFound: 'Vulnerabilities Found',
    daysAgo: 'days ago',
    critical: 'critical',
    medium: 'medium',
    low: 'low',

    // User management
    userName: 'Name',
    userEmail: 'Email',
    userRole: 'Role',
    userStatus: 'Status',
    userActions: 'Actions',
    roleAdministrator: 'Administrator',
    roleUser: 'User',
    statusActive: 'Active',

    // Database actions
    dbActions: {
      reindex: 'Reindex',
      backup: 'Backup',
      optimize: 'Optimize',
      reindexDesc: 'Rebuild database indexes',
      backupDesc: 'Create database backup',
      optimizeDesc: 'Optimize query performance'
    },

    operations: {
      reindexTitle: 'Database Reindex Results',
      backupTitle: 'Database Backup Results',
      optimizeTitle: 'Database Optimization Results',
      reindexResults: 'Reindex Results',
      optimizeResults: 'Optimization Results',
      collection: 'Collection',
      status: 'Status',
      indexSuggestions: 'Index Suggestions',
      backupDetails: 'Backup Details',
      backupFile: 'Backup File',
      backupLocation: 'Location',
      backupSize: 'Size',
      errorDetails: 'Error Details',
      close: 'Close',
      resultsTitle: 'Operation Results',
      reindexDatabase: 'Reindex Database',
      backupDatabase: 'Backup Database',
      optimizeDatabase: 'Optimize Database',
      dbActions: {
        reindex: 'Reindex',
        backup: 'Backup',
        optimize: 'Optimize',
        reindexDesc: 'Rebuild database indexes',
        backupDesc: 'Create database backup',
        optimizeDesc: 'Optimize query performance'
      },
      lastReindex: 'Last Reindex',
      databaseSize: 'Database Size',
      totalTables: 'Total Tables',
      operations: {
        reindexDatabase: {
          success: 'Database reindexing completed successfully',
          error: 'Error during database reindexing',
          loading: 'Reindexing database...'
        },
        backupDatabase: {
          success: 'Database backup completed successfully',
          error: 'Error during database backup',
          loading: 'Backing up database...'
        },
        optimizeDatabase: {
          success: 'Database optimization completed successfully',
          error: 'Error during database optimization',
          loading: 'Optimizing database...'
        },
        rolloverLogs: {
          success: 'Log rollover completed successfully',
          loading: 'Rolling over logs...'
        },
        searchLogs: {
          success: 'Log search completed',
          loading: 'Searching logs...'
        },
        runDiagnostics: {
          success: 'Diagnostics completed successfully',
          loading: 'Running diagnostics...'
        },
        runSecurityScan: {
          success: 'Security scan completed successfully',
          loading: 'Running security scan...'
        }
      },
      monthlyActiveUsers: 'Monthly Active Users (MAU)',
      searchUsers: 'Search users...',
      clearSearch: 'Clear search',
      search: 'Search',
      usersFound: 'users found',
      showAllUsers: 'Show All Users',
      searching: 'Searching...',
      searchingUsers: 'Searching for users...',
      noUsersFound: 'No users found matching your search criteria.',
      noUsers: 'No users available.',
      showing: 'Showing',
      of: 'of',
      previous: 'Previous',
      next: 'Next',
      runningSecurityScan: 'Running Scan...',
      securityRecommendations: 'Security Recommendations',
      totalUsers: 'Total Users',
      newUsers: 'New Users (Month)',
      today: 'Today',
      errorLogs: 'Error Logs',
      warningLogs: 'Warning Logs',
      noErrorLogs: 'No error logs recorded today.',
      noWarningLogs: 'No warning logs recorded today.',
      infoLogsNote: 'Info logs are not shown in the summary. Use the search function to view all log types.',
      searchResults: 'Latest Search Results',
      entriesFound: 'entries found',
      viewAllResults: 'View All Results',
      logType: 'Type',
      logCount: 'Count',

      // Log types
      logTypes: {
        connectionTimeout: 'Connection timeout',
        databaseFailed: 'Database query failed',
        authFailed: 'Authentication failure',
        lowDiskSpace: 'Disk space below threshold',
        slowQuery: 'Slow query performance',
        rateLimit: 'Rate limit approaching'
      },

      // Security section
      security: {
        criticalVulnerabilities: 'Critical Vulnerabilities',
        authenticationIssues: 'Authentication Issues',
        occurrences: 'Occurrences',
        firstSeen: 'First Seen',
        lastSeen: 'Last Seen',
        timestamp: 'Timestamp',
        message: 'Message',
        service: 'Service',
        showLess: 'Show Less',
        showMore: 'Show All Authentication Issues',
        recommendedAction: 'Recommended Action',
        noVulnerabilitiesFound: 'No Vulnerabilities Found',
        systemSecure: 'Your system appears to be secure. Continue monitoring regularly.'
      },

      // Search fields
      searchFields: {
        all: 'All Fields',
        name: 'Name',
        email: 'Email',
        role: 'Role'
      },

      // User search
      userSearch: {
        resultsFound: 'Found {total} users matching "{term}"',
        error: 'Error searching users'
      },

      logSearch: {
        noResultsFound: 'No logs matched your search criteria',
        resultsFound: 'Found {count} log entries'
      }
    },
    userEdit: {
      title: 'Edit User',
      loading: 'Loading user data...',
      userInfo: 'User Information',
      userId: 'User ID',
      loginName: 'Login Name',
      fullName: 'Full Name',
      dob: 'Date of Birth',
      email: 'Email',
      emailVerified: 'Email Verified',
      verified: 'Verified',
      notVerified: 'Not Verified',
      createdAt: 'Created',
      lastLogin: 'Last Login',
      never: 'Never',
      accountSettings: 'Account Settings',
      accountStatus: 'Account Status',
      accountEnabled: 'Account Enabled',
      cannotDisableSelf: 'You cannot disable your own account',
      accountRole: 'Account Role',
      adminRole: 'Admin Role',
      cannotChangeOwnRole: 'You cannot change your own role',
      adminActions: 'Admin Actions',
      verifyEmail: 'Verify Email',
      resetPassword: 'Send Password Reset',
      forceLogout: 'Force Logout',
      failedToLoad: 'Failed to load user data',
      errorLoading: 'Error loading user data',
      saveSuccess: 'User settings updated successfully',
      errorSaving: 'Error saving user settings',
      verifyEmailSuccess: 'Verification email sent successfully',
      emailVerificationFailed: 'Failed to send verification email',
      errorVerifyingEmail: 'Error sending verification email',
      passwordResetSent: 'Password reset email sent',
      passwordResetFailed: 'Failed to send password reset',
      errorSendingReset: 'Error sending password reset',
      logoutForced: 'User has been logged out',
      logoutFailed: 'Failed to force logout',
      errorForcingLogout: 'Error forcing logout'
    },
    operations: {
      cancel: 'Cancel',
      save: 'Save Changes'
    }
  },
  passwordResetConfirm: {
    appTitle: 'Huduma AI',
    resetPassword: 'Create New Password',
    tokenLabel: 'Reset Token',
    tokenPlaceholder: 'Enter reset token',
    validateButton: 'Validate Token',
    newPasswordLabel: 'New Password',
    newPasswordPlaceholder: 'Create a new password',
    confirmNewPasswordLabel: 'Confirm New Password',
    confirmNewPasswordPlaceholder: 'Confirm your new password',
    resetButton: 'Reset Password',
    processing: 'Resetting...',
    rememberedPassword: 'Remember your password?',
    backToLogin: 'Back to Login',
    supportMessage: 'Need help? Contact our support team',
    passwordRequirements: 'Password must be at least 8 characters with at least 1 number, 1 uppercase letter, and 1 special character',
    passwordsDoNotMatch: 'Passwords do not match',
    resetSuccess: 'Your password has been successfully reset',
    resetFailed: 'Unable to reset password. Please try again.',
    noTokenProvided: 'Please provide a reset token',
    expiredToken: 'This reset token has expired. Please request a new one.',
    invalidToken: 'Invalid or unrecognized reset token',
    validatingToken: 'Validating token...',
    redirecting: 'Redirecting to login page...',
    passwordStrength: 'Password Strength',
    strengthLabels: {
      veryWeak: 'Very Weak',
      weak: 'Weak',
      fair: 'Fair',
      good: 'Good',
      strong: 'Strong'
    },
    passwordSuggestions: {
      atLeast8Chars: 'Use at least 8 characters',
      addUppercase: 'Add uppercase letters',
      addLowercase: 'Add lowercase letters',
      addNumbers: 'Add numbers',
      addSpecialChars: 'Add special characters'
    }
  },
  passwordReset: {
    appTitle: 'Huduma AI',
    resetPassword: 'Reset Your Password',
    emailLabel: 'Email Address',
    emailPlaceholder: 'Enter your email',
    resetButton: 'Send Reset Link',
    processing: 'Sending...',
    rememberPassword: 'Remember your password?',
    backToLogin: 'Back to Login',
    supportMessage: 'Need help? Contact our support team',
    invalidEmail: 'Please enter a valid email address',
    resetRequestSuccess: 'Password reset link has been sent to your email',
    resetRequestFailed: 'Unable to send password reset link. Please try again.',
    checkEmail: 'Please check your email for further instructions.'
  },

  register: {
    appTitle: "Huduma AI",
    createAccount: "Create New Account",
    username: "Username",
    usernamePlaceholder: "Enter a username",
    email: "Email",
    emailPlaceholder: "Enter your email",
    password: "Password",
    passwordPlaceholder: "Create a password",
    confirmPassword: "Confirm Password",
    confirmPasswordPlaceholder: "Confirm your password",
    acceptTerms: "I accept the",
    termsOfService: "Terms of Service",
    registerButton: "Create Account",
    processing: "Processing...",
    alreadyHaveAccount: "Already have an account?",
    loginNow: "Log in",
    privacyNotice: "By registering, you agree to our Terms of Service and Privacy Policy",
    usernameMinLength: "Username must be at least 3 characters",
    invalidEmail: "Please enter a valid email address",
    passwordRequirements: "Password must be at least 8 characters with at least 1 number and 1 uppercase letter",
    passwordsDoNotMatch: "Passwords do not match",
    mustAcceptTerms: "You must accept the Terms of Service",
    registrationFailed: "Registration failed. Please try again.",
    usernameExists: "Username already exists",
    emailExists: "Email already exists",
    registrationSuccess: "Registration Successful!",
    verificationEmailSent: "A verification email has been sent to {email}",
    checkEmailInstructions: "Please check your email and follow the instructions to verify your account before logging in.",
    backToLogin: "Back to Login",
    noEmailReceived: "Didn't receive an email?",
    resendVerification: "Resend verification email",
    verificationResent: "Verification email has been resent",
    verificationResendFailed: "Failed to resend verification email. Please try again.",
    usernameInvalidChars: 'Username can only contain letters, numbers, underscores, dots and hyphens',
    networkError: 'Network error. Please check your connection and try again.',
    registrationFailed: 'Registration failed. Please try again.',
    networkError: 'Network error. Please check your connection and try again.'
  },

  // Login section
  login: {
    appTitle: 'Huduma AI',
    username: 'Username',
    password: 'Password',
    loginButton: 'Login',
    or: 'or',
    savedAccounts: 'Saved Accounts',
    loginSuccess: 'Login successful',
    loginError: 'Login failed. Please check your credentials.',
    googleLogin: 'Continue with Google',
    facebookLogin: 'Continue with Facebook',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    noAccount: 'Don\'t have an account?',
    createAccount: 'Create account',
    termsAndPolicy: 'By logging in, you agree to our Terms of Service and Privacy Policy',
    noAccount: "Don't have an account?",
    registerNow: "Register now",
    loggingIn: "Logging in...",
    fieldsRequired: "Username and password are required",
    invalidCredentials: "Invalid username or password",
    tooManyAttempts: "Too many login attempts. Please try again later.",
    loginFailed: "Login failed. Please try again.",
    oauthNotImplemented: "Social login is not yet implemented",
    savedLoginNotImplemented: "Saved account login is not yet implemented"
  },
  charts: {
    tooltip: {
      title: 'Date',
      totalQueries: 'Total Queries',
      uniqueUsers: 'Unique Users'
    },
    day: 'Day',
    noData: 'No Data',
    notAvailable: 'N/A',
    topQueries: 'Top Queries',
    categoryDistribution: 'Knowledge Area Usage',
    usageTrend: 'Usage Trend'
  },
  analytics: {
    // Dashboard header and controls
    title: 'Data Analytics & Insights',
    period: 'Time Period',

    charts: {
      satisfactionHeatmap: "Satisfaction by Knowledge Area",
      satisfactionSubtitle: "Percentage scores over time"
    },

    timePeriods: {
      week4: "4 Weeks Ago",
      week3: "3 Weeks Ago",
      week2: "2 Weeks Ago",
      week1: "Last Week",
      current: "Current"
    },

    errors: {
      loading: "Failed to load satisfaction data. Please try again.",
    },

    status: {
      loading: "Loading...",
      noData: "No data available",
      online: "System Online",
      offline: "System Offline",
      responseTime: "Avg. Response Time",
      queueLength: "Queue",
      uptime: "Uptime"
    },

    // Period dropdown options
    periods: {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      allTime: 'All Time'
    },

    // Metrics section titles and values
    metrics: {
      totalQueries: 'Total Queries',
      uniqueUsers: 'Unique Users',
      avgResponseTime: 'Avg Response Time',
      satisfaction: 'User Satisfaction'
    },

    // Table headers and labels
    table: {
      rank: 'Rank',
      query: 'Query',
      count: 'Count',
      avgTime: 'Avg. Time'
    },

    // Chart labels and legends
    chartLabels: {
      categories: 'Areas',  // Changed from 'Categories'
      serviceCategories: 'Knowledge Areas',  // Changed from 'Service Categories'
      byUsage: 'by Usage',  // No change
      category: 'Area'  // Changed from 'Category'  
    },

    // Tooltips and hints
    tooltips: {
      selectPeriod: 'Select time period',
      selectDate: 'Select date',
      exportData: 'Export data'
    },

    // Status messages
    status: {
      loading: 'Loading analytics data...',
      noData: 'No data available for this period',
      error: 'Failed to load analytics data'
    },
    gauge: {
      historical: 'Historical Trends',
      vsPrevious: 'vs previous period',
      target: 'Target'
    },

    ratings: {
      poor: "Poor",
      average: "Average",
      good: "Good",
      excellent: "Excellent"
    },

    // Trend indicators
    slower: 'slower',
    faster: 'faster',
    percentage: 'Percentage',

    // Additional analytics fields
    note: 'Below are usage stats and user feedback summaries.',
    usageStats: 'Usage Statistics',
    peakUsers: 'Peak Concurrent Users',
    activeChats: 'Active Chats',
    usageTrend: 'Usage Trend',
    topQueries: 'Top Queries',
    feedbackSamples: 'User Feedback Samples',
    close: 'Close',
    chartComingSoon: 'Interactive chart visualization coming soon...',
    retry: 'Retry',
    dailyQueries: 'Daily Queries',
    export: 'Export Data',
    dateRange: 'Date Range',
    startDate: 'Start Date',
    endDate: 'End Date',

    // Added for AnalyticsComponent.vue
    rank: 'Rank',
    query: 'Query',
    count: 'Count',
    avgTime: 'Avg. Time',
    serviceUsage: 'Knowledge Area Usage',

    // Added for UsageTrendChart.vue
    usageTrends: 'Usage Trends',
    week: 'Last Week',
    month: 'Last Month',
    quarter: 'Last Quarter',
    year: 'Last Year',
    uniqueUsers: 'Unique Users',
    satisfactionRate: 'Satisfaction Rate',
    satisfactionAnalysis: 'User Satisfaction Analysis'
  },
  brandName: 'Huduma AI: Your Digital Government Assistant',
  nav: {
    systemStatus: 'System Status',
    menu: 'Menu',
    analytics: 'Analytics',
    userProfile: 'User Profile',
    settings: 'Settings',
    logout: 'Log Out',
    profile: 'My Profile',
    toggleSidebar: 'Toggle sidebar',
    changeLanguage: 'Change language',
    administration: "Administration"
  },
  systemStatus: {
    title: 'Service Status',
    services: 'Services',
    operational: 'Operational',
    degraded: 'Degraded',
    outage: 'Outage',
    allOperational: 'All Systems',
    someIssues: 'Some Issues',
    majorIssues: 'Major Issues',
    checking: 'Checking...',
    nextDeadline: 'Next Deadline',
    days: 'days',
    viewDetails: 'View Details'
  },
  services: {
    eCitizen: 'eCitizen Portal',
    taxFiling: 'Tax Filing System',
    idApplication: 'ID Application',
    businessReg: 'Business Registration',
    drivingLicense: 'Driving License'
  },
  // Deadline titles
  deadlines: {
    taxFiling: 'Tax Filing Deadline',
    businessRenewal: 'Business License Renewal',
    idRenewal: 'ID Card Renewal',
    vehicleRegistration: 'Vehicle Registration Deadline'
  },
  sidebar: {
    governmentServices: 'Knowledge Areas', // Changed from 'Government Services'
    chatHistory: 'Chat History',
    searchPlaceholder: 'Search knowledge areas...', // Changed from 'Search services...'
    createFolder: 'Create Folder',
    editFolder: 'Edit Folder',
    folderName: 'Folder Name',
    folderNamePlaceholder: 'Enter folder name',
    moveChat: 'Move Chat',
    moveChatTo: 'Move Chat To',
    selectFolder: 'Select Folder',
    deleteChat: 'Delete Chat',
    deleteChatConfirm: 'Are you sure you want to delete this chat?',
    deleteChatWarning: 'This action cannot be undone.',
    renameChat: "Rename Chat",
    chatTitle: "Chat Title",
    chatTitlePlaceholder: "Enter a title for this chat",
    deleteFolder: "Delete Folder",
    deleteFolderConfirm: "Are you sure you want to delete '{name}' folder?",
    chatsMoveWarning: "All chats in this folder will be moved to the default folder.",
    weatherTitle: "Weather Forecast",
    weatherLoading: "Loading weather data...",
    weatherError: "Unable to load weather data. Please try again.",
    folders: "Folders",
    emptyFolder: "No chats in this folder",
    title: 'Info & Resources',
    chatHistory: 'Recent Chats',
    noChats: 'No recent chats',
    relatedDocs: 'Related Documents',
    noDocuments: 'No related documents',
    faq: 'Frequently Asked Questions',
    title: 'Info & Resources',
    chatHistory: 'Recent Chats',
    noChats: 'No recent chats',
    relatedDocs: 'Related Documents',
    noDocuments: 'No related documents',
    faq: 'Frequently Asked Questions',
    tab: {
      all: 'All',
      folders: 'Folders',
      starred: 'Starred',
      archived: 'Archived'
    },
    savedChats: 'Saved Chats',
    folders: "Folders",
    allChats: "All Chats",
    noFolder: "All Chats",
    starredChats: "Starred",
    archivedChats: "Archived",
    emptyFolder: "This folder is empty. Move conversations here from the chat menu.",
    noStarredChats: "No starred conversations yet. Star a conversation to add it here.",
    noArchivedChats: "No archived conversations yet.",
    noSearchResults: 'No conversations found for "{term}"',
    loadingChats: "Loading chats...",
    errorLoadingConversations: "Failed to load conversations. Please try again.",
    errorLoadingUser: "User data is incomplete. Please reload the page.",
    errorNoUser: "User data is missing. Please reload the page.",
    retry: "Retry",
    message: "message",
    messages: "messages",
    created: "Created",
    updated: "Updated",
    star: "Star",
    unstar: "Unstar",
    archive: "Archive",
    chatStarred: "Conversation has been starred",
    chatUnstarred: "Conversation has been unstarred",
    chatArchived: "Conversation has been archived",
    chatUnarchived: "Conversation has been unarchived",
    errorUpdatingChat: "Failed to update conversation",
    chatRenamed: "Conversation renamed successfully",
    errorRenamingChat: "Failed to rename conversation",
    chatDeleted: "Conversation deleted successfully",
    errorDeletingChat: "Failed to delete conversation",
    chatMoved: "Conversation moved successfully",
    errorMovingChat: "Failed to move conversation",
    noPreview: "No preview available",
    searchConversations: 'Search conversations...',
    title: "Info & Resources",
  },
  leftPanel: {
    cat1: {
      name: '1. Identity & Civil Registration',
      children: [
        'Birth certificates',
        'National ID cards',
        'Passports',
        'Marriage and death certificates',
        'Voter registration'
      ]
    },
    cat2: {
      name: '2. Healthcare & Social Services',
      children: [
        'Public healthcare access',
        'Vaccination programs',
        'Health insurance',
        'Disability benefits',
        'Welfare and food assistance'
      ]
    },
    cat3: {
      name: '3. Education & Learning',
      children: [
        'Public schools and universities',
        'Scholarships and student loans',
        'Adult education programs',
        'Online learning resources'
      ]
    },
    cat4: {
      name: '4. Employment & Labor Services',
      children: [
        'Job search and unemployment benefits',
        'Worker protections and labor rights',
        'Workplace safety regulations',
        'Skills training and apprenticeships'
      ]
    },
    cat5: {
      name: '5. Taxes & Revenue',
      children: [
        'Income tax filing and refunds',
        'Property tax payments',
        'Business tax compliance',
        'Customs and import duties'
      ]
    },
    cat6: {
      name: '6. Public Safety & Justice',
      children: [
        'Police and emergency services',
        'Court and legal aid services',
        'Crime reporting',
        'Consumer protection laws'
      ]
    },
    cat7: {
      name: '7. Transportation & Mobility',
      children: [
        "Driver's licenses and vehicle registration",
        'Public transit and infrastructure',
        'Traffic violations and fines',
        'Road safety programs'
      ]
    },
    cat8: {
      name: '8. Housing & Urban Development',
      children: [
        'Public housing assistance',
        'Property registration and land records',
        'Housing loans and subsidies',
        'Zoning and building permits'
      ]
    },
    cat9: {
      name: '9. Utilities & Environment',
      children: [
        'Water and electricity services',
        'Waste management and recycling',
        'Environmental regulations',
        'Renewable energy initiatives'
      ]
    },
    cat10: {
      name: '10. Business & Trade',
      children: [
        'Business registration and licensing',
        'Trade regulations and permits',
        'Small business grants and incentives',
        'E-commerce and digital business support'
      ]
    },
    cat11: {
      name: '11. Social Security & Pensions',
      children: [
        'Retirement benefits',
        'Pension fund management',
        'Survivor benefits',
        'Disability pensions'
      ]
    },
    cat12: {
      name: '12. Community & Civic Engagement',
      children: [
        'Voting and elections',
        'Public feedback and citizen complaints',
        'Volunteering and community programs',
        'Local government participation'
      ]
    }
  },
  settings: {
    title: 'Settings',
    save: 'Save',
    close: 'Close',
    saveSettings: 'Save Settings',
    saveSuccess: 'Settings saved successfully',
    saveError: 'Error saving settings',
    display: 'Display',
    displayLanguage: 'Display Language',
    languages: {
      english: 'English',
      french: 'French',
      swahili: 'Swahili'
    },
    theme: 'Theme',
    themes: {
      light: 'Light',
      dark: 'Dark',
      system: 'System'
    },
    fontSize: 'Font Size',
    notifications: 'Notifications',
    emailUpdates: 'Email updates',
    soundNotifications: 'Sound notifications',
    accountManagement: 'Account Management',
    emailAddress: 'Email Address',
    emailAddressPlaceholder: 'Your email address',
    password: 'Password',
    changePassword: 'Change Password',
    resetUserData: 'Reset User Data',
    resetUserDataDesc: 'This will clear all your profile data and chat history.',
    deleteAccount: 'Delete Account',
    deleteAccountDesc: 'This will permanently delete your account and all associated data.',
    edit: 'Edit',
    standardAccount: 'Standard Account',
    confirmEmailChange: 'Confirm Email Change',
    pleaseEnterPassword: 'Please enter your password',
    cancel: 'Cancel',
    // Account section
    account: {
      title: 'Account',
      resetUserData: 'Reset User Data',
      resetDescription: 'This will clear all your profile data and chat history.',
      confirmReset: 'Are you sure you want to reset all your data? This cannot be undone.',
      resetComplete: 'Your data has been reset.'
    },
    // Language section
    language: {
      title: 'Language',
      selectLabel: 'Display Language'
    },
    // Appearance section
    appearance: {
      title: 'Appearance',
      theme: 'Theme',
      lightTheme: 'Light',
      darkTheme: 'Dark',
      systemTheme: 'System',
      fontSize: 'Font Size'
    },
    // Notifications section
    notifications: {
      title: 'Notifications',
      emailUpdates: 'Email updates',
      soundEnabled: 'Sound notifications'
    },
    // Added delete account translations
    confirmDeleteAccount: 'Are you sure you want to delete your account? This action cannot be undone.',
    confirmAccountDeletion: 'Confirm Account Deletion',
    accountDeletionWarning: 'Warning: This action is permanent and cannot be undone. All your data will be permanently deleted.',
    deletionReason: 'Reason for deletion (optional):',
    deletionReasonPlaceholder: 'What made you decide to delete your account?',
    enterPasswordConfirm: 'Enter your password to confirm:',
    currentPasswordPlaceholder: 'Your current password',
    deleting: 'Deleting...',
    permanentlyDeleteAccount: 'Delete Account',
    accountDeletedSuccess: 'Your account has been deleted successfully.',
    incorrectPassword: 'Incorrect password',
    accountDeletionFailed: 'Failed to delete account. Please try again later.',
    confirmChange: 'Confirm Change',
    processing: 'Processing...',
    userDataReset: 'Your profile data has been successfully reset.',
    failedToResetUserData: 'Failed to reset your profile data. Please try again later.',
    changingEmailTo: 'Changing your email to',
    will: 'will',
    logOutSystem: 'Log you out of the system',
    sendVerificationLink: 'Send a verification link to your new email',
    requireVerification: 'Require verification before you can log in again',
    checkNewEmailVerification: 'Please check your new email for verification instructions.',
    unableToVerifyEmail: 'Unable to verify email. Please try again.',
    emailAlreadyInUse: 'Email already in use',
    enterValidEmail: 'Please enter a valid email address',
    failedToUpdateEmail: 'Failed to update email. Please try again.',
    passwordResetInitiated: 'A password reset link has been sent to your email address.',
    unableToLoadUser: 'Unable to load user information. Please try again.',
    retry: 'Retry',
    user: 'User',
    account: 'Account',
    loadingUserInfo: 'Loading user information...'
  },
  userProfile: {
    title: 'User Profile',
    privacyInfo:
      "By providing more information, you'll get more accurate and meaningful responses from the chatbot. Please review our",
    privacyPolicyLink: 'Privacy Policy',
    tabs: {
      tab1: 'Personal Identification Data',
      tab2: 'Civil Registration & Documentation',
      tab3: 'Address & Residency Information',
      tab4: 'Identity & Travel Documents',
      tab5: 'Health & Medical Records',
      tab6: 'Employment & Economic Data',
      tab7: 'Education & Academic Records',
      tab8: 'Financial & Tax Data',
      tab9: 'Social Security & Welfare',
      tab10: 'Criminal & Legal Records',
      tab11: 'Transportation & Mobility',
      tab12: 'Civic & Political Participation'
    },
    residencyStatuses: {
      citizen: 'Citizen',
      permanentResident: 'Permanent Resident',
      temporaryResident: 'Temporary Resident',
      other: 'Other'
    },
    yesNo: {
      yes: 'Yes',
      no: 'No'
    },
    fields: {
      // Tab 1
      fullName: 'Full name (including aliases)',
      dob: 'Date of birth',
      gender: 'Gender',
      nationality: 'Nationality',
      maritalStatus: 'Marital status',
      photograph: 'Photograph',
      biometric: 'Fingerprints / Biometric data',
      // Tab 2
      birthCert: 'Birth certificate',
      deathCert: 'Death certificate',
      marriageDivorce: 'Marriage / Divorce records',
      adoption: 'Adoption records',
      citizenship: 'Citizenship / Naturalization documents',
      immigration: 'Immigration & visa history',
      // Tab 3
      currentAddress: 'Current residential address',
      previousAddresses: 'Previous addresses',
      homeOrRental: 'Homeownership or rental details',
      utilityBills: 'Utility bills linked to the address',
      landRecords: 'Land and property ownership records',
      // Tab 4
      idCard: 'National ID card number',
      passport: 'Passport details',
      driversLicense: "Driver's license",
      voterId: 'Voter ID',
      ssn: 'Social Security / National Insurance Number',
      militaryRecords: 'Military service records',
      // Tab 5
      medicalHistory: 'Medical history and health conditions',
      vaccinations: 'Vaccination records',
      insuranceDetails: 'Health insurance details',
      disability: 'Disability status',
      organDonor: 'Organ donor status',
      prescriptions: 'Prescriptions and treatments received',
      mentalHealth: 'Mental health history',
      // Tab 6
      eHistory: 'Employment history',
      currentEmployer: 'Current employer details',
      workPermits: 'Work permits and labor contracts',
      certifications: 'Professional certifications and licenses',
      unemployment: 'Unemployment status and benefits received',
      tin: 'Taxpayer identification number (TIN)',
      businessAffiliations: 'Business ownership and company affiliations',
      // Tab 7
      schools: 'School and university attended',
      diplomas: 'Diplomas, degrees, and certifications',
      performance: 'Academic performance and test scores',
      scholarships: 'Scholarships and financial aid received',
      // Tab 8
      incomeTax: 'Income tax records',
      bankAccounts: 'Banking and financial accounts',
      propertyTax: 'Property tax payments',
      businessTax: 'Business tax filings',
      pensionContrib: 'Pension contributions and withdrawals',
      loanAid: 'Loan and government aid records',
      // Tab 9
      pensionStatus: 'Pension status and contributions',
      childcare: 'Childcare support',
      foodAssistance: 'Food assistance / welfare programs',
      housingAssistance: 'Housing assistance',
      // Tab 10
      policeRecords: 'Police records (criminal history, arrests, charges)',
      courtCases: 'Court case history',
      finesPenalties: 'Fines and penalties',
      paroleProbation: 'Parole or probation status',
      citizenshipRevocation: 'Citizenship revocation (if applicable)',
      // Tab 11
      vehicleReg: 'Vehicle registration details',
      trafficViolations: 'Traffic violations and fines',
      licenseHistory: 'Driving license history and endorsements',
      publicTransportCard: 'Public transport card usage',
      // Tab 12
      voterRegistration: 'Voter registration details',
      electionHistory: 'Election participation history',
      partyMembership: 'Political party membership',
      militaryStatus: 'Military service or conscription status',
      publicServiceRoles: 'Public service roles',
      //Additional
      postalCode: 'Postal Code',
      country: 'Country',
      residencyStatus: 'Residency Status',
      bloodType: 'Blood Type',
      education: "Education",
      degrees: "Degrees",
      academicRecords: "Academic Records",
      // Most of the core fields are already translated
      dateOfBirth: 'Date of Birth',
      profilePhoto: 'Profile Photo',
      phoneNumber: 'Phone Number',
      emailAddress: 'Email Address',
      preferredLanguage: 'Preferred Language',

      // Tab 2 - Civil Registration & Documentation
      // Some of these fields are already translated
      deathCertificate: 'Death Certificate',
      marriageRecords: 'Marriage Records',
      divorceRecords: 'Divorce Records',
      adoptionRecords: 'Adoption Records',
      citizenshipDocuments: 'Citizenship Documents',
      naturalizationDocuments: 'Naturalization Documents',
      visaHistory: 'Visa History',

      // Tab 3 - Address & Residency
      // Some of these fields are already translated
      previousAddresses: 'Previous Addresses',
      homeOwnership: 'Home Ownership',
      rentalDetails: 'Rental Details',
      utilityBills: 'Utility Bills',
      propertyRecords: 'Property Records',
      residencyDuration: 'Residency Duration',

      // Tab 4 - Identity & Travel Documents
      // Some of these fields are already translated
      nationalIDNumber: 'National ID Number',
      passportNumber: 'Passport Number',
      passportExpiry: 'Passport Expiry',
      visaType: 'Visa Type',
      visaNumber: 'Visa Number',
      visaExpiry: 'Visa Expiry',

      // Tab 5 - Health & Medical Records
      medicalHistory: 'Medical History',
      vaccinations: 'Vaccinations',
      healthInsurance: 'Health Insurance',
      bloodType: 'Blood Type',
      organDonor: 'Organ Donor Status',
      allergies: 'Allergies',
      currentMedications: 'Current Medications',
      chronicConditions: 'Chronic Conditions',

      // Tab 6 - Employment & Economic Data
      // Some of these fields are already translated
      employmentStatus: 'Employment Status',
      occupation: 'Occupation',
      employerName: 'Employer Name',
      employerAddress: 'Employer Address',
      employmentHistory: 'Employment History',
      annualIncome: 'Annual Income',
      workPermitNumber: 'Work Permit Number',
      workPermitExpiry: 'Work Permit Expiry',

      // Tab 7 - Education & Academic Records
      // Some of these fields are already translated
      highestEducation: 'Highest Education Level',
      institutionName: 'Institution Name',
      graduationYear: 'Graduation Year',
      fieldOfStudy: 'Field of Study',
      additionalCertifications: 'Additional Certifications',
      languages: 'Languages Spoken',
      academicAchievements: 'Academic Achievements',

      // Tab 8 - Financial & Tax Data
      // Some of these fields are already translated
      accountNumber: 'Account Number',
      bankName: 'Bank Name',
      financialAssets: 'Financial Assets',
      liabilities: 'Liabilities',
      creditScore: 'Credit Score',
      taxIdentificationNumber: 'Tax Identification Number',
      lastTaxReturn: 'Last Tax Return',
      taxExemptions: 'Tax Exemptions'
    },
    actions: {
      cancel: 'Cancel',
      save: 'Save Profile',
      previous: 'Previous',
      next: 'Next',
      saving: 'Saving...'
    },
    tabComingSoon: 'This tab is under development and will be available soon.',
    saveSuccess: 'Profile saved successfully',
    loadError: 'Error loading profile data',
    saveError: 'Error saving profile data',
    confirmCancel: 'You have unsaved changes. Are you sure you want to cancel?',
    uploadPhoto: 'Upload Photo',
    uploadFile: 'Upload File',
    photoRequirements: 'Photo must be clear, recent, and show your full face',
    biometricRequirements: 'Only official biometric data files are accepted',
    requiredFields: 'Required fields',
    documentUpload: 'Document Upload',
    validationTitle: 'Please correct the following errors:',
    completionStatus: '{percent}% complete',
    validation: {
      nameRequired: 'Full name is required',
      dobRequired: 'Date of birth is required',
      dobFuture: 'Date of birth cannot be in the future'
    },
    placeholders: {
      fullName: 'Enter your full legal name',
      nationality: 'Enter your nationality',
      searchDisciplines: "Search disciplines...",
      selectDiscipline: "Select a discipline",
      searchDegrees: "Search degrees...",
      selectDegree: "Select a degree"
    },

    noMatchingDegrees: "No matching degrees found",
    degreeOptions: [
      "Associate Degree",
      "Bachelor of Arts (BA)",
      "Bachelor of Science (BS)",
      "Bachelor of Engineering (BEng)",
      "Bachelor of Business Administration (BBA)",
      "Bachelor of Fine Arts (BFA)",
      "Bachelor of Education (BEd)",
      "Bachelor of Medicine (MBBS)",
      "Bachelor of Laws (LLB)",
      "Master of Arts (MA)",
      "Master of Science (MS)",
      "Master of Business Administration (MBA)",
      "Master of Engineering (MEng)",
      "Master of Fine Arts (MFA)",
      "Master of Education (MEd)",
      "Master of Laws (LLM)",
      "Master of Public Health (MPH)",
      "Doctor of Philosophy (PhD)",
      "Doctor of Medicine (MD)",
      "Doctor of Education (EdD)",
      "Doctor of Business Administration (DBA)",
      "Doctor of Jurisprudence (JD)",
      "Professional Diploma",
      "Technical Diploma",
      "Vocational Certificate",
      "Graduate Certificate",
      "Post-Graduate Diploma",
      "Post-Doctoral"
    ],

    gender: {
      male: 'Male',
      female: 'Female',
      other: 'Other',
      preferNot: 'Prefer not to say'
    },
    maritalStatus: {
      single: 'Single',
      married: 'Married',
      divorced: 'Divorced',
      widowed: 'Widowed',
      other: 'Other'
    },
    select: 'Please select',
    existingFile: 'Existing file',
    noMatchingDisciplines: "No matching disciplines found",
    educationOptions: [
      "Accounting",
      "Aerospace Engineering",
      "Agricultural Science",
      "Anthropology",
      "Architecture",
      "Art History",
      "Artificial Intelligence",
      "Astronomy",
      "Astrophysics",
      "Biochemistry",
      "Biomedical Engineering",
      "Biotechnology",
      "Business Administration",
      "Chemical Engineering",
      "Chemistry",
      "Civil Engineering",
      "Communications",
      "Computer Engineering",
      "Computer Science",
      "Construction Management",
      "Criminal Justice",
      "Cybersecurity",
      "Data Science",
      "Dentistry",
      "Economics",
      "Education",
      "Electrical Engineering",
      "Elementary Education",
      "English Literature",
      "Environmental Engineering",
      "Environmental Science",
      "Fashion Design",
      "Film Studies",
      "Finance",
      "Fine Arts",
      "Food Science",
      "Forensic Science",
      "Game Design",
      "Geography",
      "Geology",
      "Graphic Design",
      "Health Administration",
      "History",
      "Hospitality Management",
      "Human Resources",
      "Industrial Design",
      "Industrial Engineering",
      "Information Systems",
      "Information Technology",
      "Interior Design",
      "International Business",
      "International Relations",
      "Journalism",
      "Law",
      "Library Science",
      "Linguistics",
      "Management",
      "Marketing",
      "Materials Science",
      "Mathematics",
      "Mechanical Engineering",
      "Media Studies",
      "Medicine",
      "Meteorology",
      "Microbiology",
      "Music",
      "Nanotechnology",
      "Nursing",
      "Nutrition",
      "Occupational Therapy",
      "Oceanography",
      "Petroleum Engineering",
      "Pharmacy",
      "Philosophy",
      "Photography",
      "Physical Education",
      "Physical Therapy",
      "Physics",
      "Political Science",
      "Psychology",
      "Public Administration",
      "Public Health",
      "Public Relations",
      "Robotics",
      "Secondary Education",
      "Social Work",
      "Sociology",
      "Software Engineering",
      "Special Education",
      "Sports Management",
      "Statistics",
      "Systems Engineering",
      "Theatre Arts",
      "Tourism",
      "Urban Planning",
      "Veterinary Medicine",
      "Web Development",
      "Wildlife Biology",
      "Zoology"
    ],
    confirmSaveTitle: "Save Profile",
    confirmSave: "Are you sure you want to save these changes?",
    placeholders: {
      searchCountries: 'Search countries...',
      selectCountry: 'Select a country'
    },
    noMatchingCountries: 'No matching countries found',
    profileIcon: 'Profile Icon',
    change: 'Change',
    chooseProfileIcon: 'Choose a Profile Icon',
    presetIcons: 'Preset Icons',
    upload: 'Upload',
    initials: 'Initials',
    clickToUpload: 'Click to upload',
    useThisImage: 'Use This Image',
    useInitials: 'Use Initials',
    // Country Selection
    countryLoadError: 'Error loading countries',
    countryUpdateError: 'Error updating country',

    // Education Section
    searchResults: 'Search Results',
    noResults: 'No Results',
    searchingFor: 'Searching for',

    // Loading States
    retryLoading: 'Retry',
    loadingProfile: 'Loading user profile...',
    savingProfile: 'Saving profile...',

    // Error Messages
    errors: {
      savingFailed: 'Failed to save profile',
      loadingFailed: 'Failed to load profile data',
      invalidForm: 'Please fill all required fields',
      invalidFileType: 'Invalid file type',
      fileTooLarge: 'File is too large'
    },

    // Confirmation & Success
    tabComplete: 'Tab completed!',
    confirmDiscardChanges: 'Discard unsaved changes?',
    confirmLeave: 'Are you sure you want to leave? Any unsaved changes will be lost.',
    profileComplete: 'Profile successfully completed',
    fieldUpdated: 'Field updated successfully',
    nextSection: 'Next section',
    previousSection: 'Previous section',
    uploadProgress: 'Upload progress: {percent}%',
    navigationWarning: 'Please complete this section before proceeding',

    // For form validation
    validation: {
      // Add to existing validation object
      requiredField: '{field} is required',
      invalidFormat: 'Invalid format for {field}',
      futureDate: 'Date cannot be in the future',
      invalidSelection: 'Please make a valid selection',
      passwordLength: 'Password must be at least 8 characters',
      matchError: 'Fields do not match'
    },

    // For accessibility
    aria: {
      tabList: 'Profile form sections',
      nextButton: 'Go to next section',
      prevButton: 'Go to previous section',
      closeButton: 'Close profile form',
      saveButton: 'Save profile data',
      requiredField: 'Required field',
      dropdownSelect: 'Select an option'
    },
    // Employment status options
    employmentStatuses: {
      employed: 'Employed',
      selfEmployed: 'Self-Employed',
      unemployed: 'Unemployed',
      student: 'Student',
      retired: 'Retired',
      homemaker: 'Homemaker',
      other: 'Other'
    },

    // Education level options
    educationLevels: {
      primary: 'Primary Education',
      secondary: 'Secondary Education',
      highSchool: 'High School',
      vocational: 'Vocational Training',
      associate: 'Associate Degree',
      bachelor: 'Bachelor\'s Degree',
      master: 'Master\'s Degree',
      doctoral: 'Doctoral Degree',
      professional: 'Professional Degree',
      other: 'Other'
    },

    // Language proficiency levels
    proficiencyLevels: {
      native: 'Native',
      fluent: 'Fluent',
      advanced: 'Advanced',
      intermediate: 'Intermediate',
      basic: 'Basic'
    },

    // Blood type options (shown in dropdown)
    bloodTypes: {
      aPositive: 'A+',
      aNegative: 'A-',
      bPositive: 'B+',
      bNegative: 'B-',
      abPositive: 'AB+',
      abNegative: 'AB-',
      oPositive: 'O+',
      oNegative: 'O-',
      unknown: 'Unknown'
    },

    // Languages spoken
    languages: {
      english: 'English',
      french: 'French',
      swahili: 'Swahili',
      arabic: 'Arabic',
      spanish: 'Spanish',
      portuguese: 'Portuguese',
      chinese: 'Chinese',
      japanese: 'Japanese',
      german: 'German',
      russian: 'Russian',
      hindi: 'Hindi',
      urdu: 'Urdu',
      other: 'Other'
    },
    // Notification messages
    notifications: {
      saveSuccess: 'Profile saved successfully',
      saveFailed: 'Failed to save profile',
      loadSuccess: 'Profile loaded successfully',
      loadFailed: 'Failed to load profile',
      fieldRequired: 'This field is required',
      uploadSuccess: 'File uploaded successfully',
      uploadFailed: 'Failed to upload file',
      formChanged: 'You have unsaved changes',
      sessionExpired: 'Your session has expired, please log in again',
      profileUpdated: 'Your profile has been updated',
      profileIncomplete: 'Your profile is incomplete'
    },

    // Form instructions and help text
    instructions: {
      fullNameHelp: 'Enter your full legal name as it appears on your official documents',
      dobHelp: 'Enter your date of birth in MM/DD/YYYY format',
      uploadPhotoHelp: 'Upload a recent photo. File must be JPG, PNG, or GIF and less than 2MB',
      passwordHelp: 'Password must be at least 8 characters with one uppercase letter, one number, and one special character',
      documentHelp: 'Accepted formats: PDF, JPG, PNG (max 5MB)',
      requiredFields: 'Fields marked with * are required',
      selectFromList: 'Please select an option from the list',
      nextTab: 'Continue to next section',
      previousTab: 'Return to previous section',
      saveInstructions: 'Click Save to store your information',
      cancelInstructions: 'Click Cancel to discard changes'
    },

    // Section completion status
    completionStatus: {
      notStarted: 'Not Started',
      inProgress: 'In Progress',
      complete: 'Complete',
      percentComplete: '{percent}% Complete',
      tabsCompleted: '{completed} of {total} sections completed'
    }
  },
  chatbot: {
    placeholder: 'Type your query here...',
    sendButton: 'Send',
    fileReceived: 'File received successfully.',
    fileUploadError: 'Error uploading file.',
    processingError: 'Error processing your request.',
    welcomeMessage: 'Welcome! How can I assist you with Kenya government services today?',
    attachFile: 'Attach File',
    fileTooLarge: 'File is too large. Maximum size is {maxSize}.',
    saveChat: 'Save Chat',
    chatTitle: 'Chat Title',
    chatTitlePlaceholder: 'Enter a title for this chat',
    selectFolder: 'Select Folder',
    newChat: 'New Chat',
    clearContext: 'Clear context and start a new conversation',
    unsavedChanges: 'You have unsaved changes. Are you sure you want to start a new chat?',
    whatCanIHelp: "How can I help you today?",
    justChat: "Just Chat",
    contextAdded: 'Context added to your query',
    contextRemoved: 'Context removed from your query',
    sessionUpdated: 'Session updated',
    newChatStarted: 'Started a new conversation',
    loadError: 'Unable to load chat history',
    responsePrefix: "I received your message",
    withContext: "with context",
    sessionUpdated: "Session updated.",
    newChatStarted: "Started a new conversation.",
    conversationLoaded: "Conversation loaded successfully!",
    loadError: "Unable to load conversation.",
    saveConfirmTitle: "Save Existing Conversation",
    saveConfirmMessage: "Save existing conversation?",
    loadConfirmTitle: "Load Existing Conversation",
    loadConfirmMessage: "You have unsaved changes. Do you want to discard them and load the selected conversation, or save the current conversation first?",
    loadAndDiscard: "Load and Discard",
    saveAndLoad: "Save and Load",
    saveAndStartNew: "Save and Start New",
    discardAndStartNew: "Discard and Start New",
    newChatTitle: "Start New Chat"
  },
  quickhelp: {
    applyForID: "Apply for ID",
    payTaxes: "Pay taxes",
    startBusiness: "Start a business",
    findHealthcare: "Find healthcare",
    educationServices: "Education services",
    transportLicenses: "Transport & licenses",
    housingPrograms: "Housing programs",
    findJobs: "Find jobs",
    justChat: "Just Chat",
    // Prompts as separate keys with a clear naming pattern
    justChatPrompt: "I'd like to chat about government services",
    applyForIDPrompt: "I need information on how to apply for a national ID card",
    payTaxesPrompt: "What's the process for paying my taxes online?",
    startBusinessPrompt: "Guide me through the steps to register a new business",
    findHealthcarePrompt: "Where can I find information about public healthcare services?",
    educationServicesPrompt: "What education services are available for my children?",
    transportLicensesPrompt: "How do I renew my driving license?",
    housingProgramsPrompt: "Tell me about affordable housing programs in Kenya",
    findJobsPrompt: "What government job opportunities are currently available?"
  },
  common: {
    cancel: 'Cancel',
    create: 'Create',
    save: 'Save',
    move: 'Move',
    delete: 'Delete'
  },
  feedback: {
    title: 'Feedback',
    positive: 'Positive feedback',
    negative: 'Negative feedback',
    promptText: 'Was this response helpful?',
    placeholder: 'Additional comments...',
    submit: 'Submit Feedback',
    close: 'Cancel',
    thankYouMessage: 'Thank you for your feedback!',
    submitting: 'Submitting...',
    error: 'Something went wrong. Please try again.',
    success: 'Thank you for your feedback!',
  },
  responseRating: {
    title: 'Help Us Improve',
    note: 'Your feedback will be used to better tune the chatbot and improve responses over time.',
    chatbotResponse: 'Chatbot Response:',
    ratingLabels: {
      1: 'Useless',
      2: 'Slightly Helpful',
      3: 'Moderately Helpful',
      4: 'Very Helpful',
      5: 'Life Changing'
    },
    additionalComments: 'Additional comments...',
    submit: 'Submit',
    cancel: 'Cancel'
  }
}
