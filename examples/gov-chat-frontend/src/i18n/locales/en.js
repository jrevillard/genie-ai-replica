// src/i18n/locales/en.js

export default {
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
    satisfactionRate: 'Satisfaction Rate'
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
    changeLanguage: 'Change language'
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
    faq: 'Frequently Asked Questions'
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
    save: 'Save Settings',
    close: 'Close',
    saveSuccess: 'Settings saved successfully',
    saveError: 'Error saving settings',
    language: {
      title: 'Language',
      selectLabel: 'Display Language'
    },
    appearance: {
      title: 'Appearance',
      theme: 'Theme',
      lightTheme: 'Light',
      darkTheme: 'Dark',
      systemTheme: 'System',
      fontSize: 'Font Size'
    },
    notifications: {
      title: 'Notifications',
      emailUpdates: 'Email updates',
      soundEnabled: 'Sound notifications'
    },
    account: {
      title: 'Account',
      resetUserData: 'Reset User Data',
      resetDescription: 'This will clear all your profile data and chat history.',
      confirmReset: 'Are you sure you want to reset all your data? This cannot be undone.',
      resetComplete: 'Your data has been reset.'
    },
    title: 'Settings',
    close: 'Close',
    saveSettings: 'Save Settings',
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
    save: 'Save',
    edit: 'Edit',
    // Additional entries for modals and confirmations
    standardAccount: 'Standard Account',
    confirmEmailChange: 'Confirm Email Change',
    pleaseEnterPassword: 'Please enter your password',
    cancel: 'Cancel'
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
      "education": "Education",
      "degrees": "Degrees",
      "academicRecords": "Academic Records"
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
    ]
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
    justChat: "Just Chat"
  },
  quickhelp: {
    applyForID: "Apply for ID",
    payTaxes: "Pay taxes",
    startBusiness: "Start a business",
    findHealthcare: "Find healthcare",
    educationServices: "Education services",
    transportLicenses: "Transport & licenses",
    housingPrograms: "Housing programs",
    findJobs: "Find jobs"
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
    error: 'Something went wrong. Please try again.'
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
