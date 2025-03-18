// src/i18n/locales/sw.js

export default {
  passwordResetConfirm: {
    appTitle: 'Huduma AI',
    resetPassword: 'Tengeneza Nenosiri Mpya',
    tokenLabel: 'Tokeni ya Kubadilisha',
    tokenPlaceholder: 'Ingiza tokeni ya kubadilisha',
    validateButton: 'Thibitisha Tokeni',
    newPasswordLabel: 'Nenosiri Mpya',
    newPasswordPlaceholder: 'Tengeneza nenosiri mpya',
    confirmNewPasswordLabel: 'Thibitisha Nenosiri Mpya',
    confirmNewPasswordPlaceholder: 'Thibitisha nenosiri lako mpya',
    resetButton: 'Weka Nenosiri Upya',
    processing: 'Inabadilisha...',
    rememberedPassword: 'Unakumbuka nenosiri lako?',
    backToLogin: 'Rudi Kuingia',
    supportMessage: 'Unahitaji msaada? Wasiliana na timu yetu ya usaidizi',
    passwordRequirements: 'Nenosiri lazima liwe na angalau herufi 8 zenye angalau namba 1, herufi kubwa 1 na herufi maalum 1',
    passwordsDoNotMatch: 'Maneno ya siri hayalingani',
    resetSuccess: 'Nenosiri lako limebadilishwa kwa mafanikio',
    resetFailed: 'Imeshindwa kubadilisha nenosiri. Tafadhali jaribu tena.',
    noTokenProvided: 'Tafadhali utoe tokeni ya kubadilisha',
    expiredToken: 'Tokeni hii ya kubadilisha imekwisha. Tafadhali omba mpya.',
    invalidToken: 'Tokeni batili au isiyojulikana'
  },
  passwordReset: {
    appTitle: 'Huduma AI',
    resetPassword: 'Weka Nenosiri Upya',
    emailLabel: 'Anwani ya Barua Pepe',
    emailPlaceholder: 'Ingiza barua pepe yako',
    resetButton: 'Tuma Kiunga cha Kubadilisha',
    processing: 'Inatuma...',
    rememberPassword: 'Unakumbuka nenosiri lako?',
    backToLogin: 'Rudi Kuingia',
    supportMessage: 'Unahitaji msaada? Wasiliana na timu yetu ya usaidizi',
    invalidEmail: 'Tafadhali ingiza anwani halali ya barua pepe',
    resetRequestSuccess: 'Kiunga cha kubadilisha nenosiri kimeletwa kwenye barua pepe yako',
    resetRequestFailed: 'Imeshindwa kutuma kiunga cha kubadilisha. Tafadhali jaribu tena.'
  },
  register: {
    appTitle: "Huduma AI",
    createAccount: "Tengeneza Akaunti Mpya",
    username: "Jina la mtumiaji",
    usernamePlaceholder: "Ingiza jina la mtumiaji",
    email: "Barua pepe",
    emailPlaceholder: "Ingiza barua pepe yako",
    password: "Nenosiri",
    passwordPlaceholder: "Tengeneza nenosiri",
    confirmPassword: "Thibitisha Nenosiri",
    confirmPasswordPlaceholder: "Thibitisha nenosiri lako",
    acceptTerms: "Ninakubali",
    termsOfService: "Masharti ya Huduma",
    registerButton: "Tengeneza Akaunti",
    processing: "Inachakata...",
    alreadyHaveAccount: "Una akaunti tayari?",
    loginNow: "Ingia",
    privacyNotice: "Kwa kujiandikisha, unakubali Masharti ya Huduma na Sera ya Faragha",
    usernameMinLength: "Jina la mtumiaji lazima liwe na angalau herufi 3",
    invalidEmail: "Tafadhali ingiza anwani halali ya barua pepe",
    passwordRequirements: "Nenosiri lazima liwe na angalau herufi 8 na angalau namba 1 na herufi kubwa 1",
    passwordsDoNotMatch: "Nenosiri hazilingani",
    mustAcceptTerms: "Lazima ukubali Masharti ya Huduma",
    registrationFailed: "Usajili umeshindwa. Tafadhali jaribu tena."
  },
  login: {
    appTitle: 'Huduma AI',
    username: 'Jina la mtumiaji',
    password: 'Nywila',
    loginButton: 'Ingia',
    or: 'au',
    savedAccounts: 'Akaunti Zilizohifadhiwa',
    loginSuccess: 'Umefanikiwa kuingia',
    loginError: 'Imeshindwa kuingia. Tafadhali angalia taarifa zako.',
    googleLogin: 'Endelea na Google',
    facebookLogin: 'Endelea na Facebook',
    rememberMe: 'Nikumbuke',
    forgotPassword: 'Umesahau nywila?',
    noAccount: 'Huna akaunti?',
    createAccount: 'Fungua akaunti',
    termsAndPolicy: 'Kwa kuingia, unakubali Masharti yetu ya Huduma na Sera ya Faragha',
    noAccount: "Huna akaunti?",
    registerNow: "Jiandikishe sasa"
  },
  charts: {
    tooltip: {
      title: 'Tarehe',
      totalQueries: 'Jumla ya Maswali',
      uniqueUsers: 'Watumiaji wa Kipekee'
    },
    day: 'Siku',
    noData: 'Hakuna Data',
    notAvailable: 'Haipatikani',
    topQueries: 'Maswali ya Juu',
    categoryDistribution: 'Matumizi ya Vikundi vya Huduma',
    usageTrend: 'Mwelekeo wa Matumizi'
  },
  analytics: {
    // Dashboard header and controls
    title: 'Data za Uchanganuzi & Maoni',
    period: 'Kipindi cha Muda',

    // Period dropdown options
    periods: {
      daily: 'Kila Siku',
      weekly: 'Kila Wiki',
      monthly: 'Kila Mwezi',
      allTime: 'Wakati Wote'
    },

    // Metrics section titles and values
    metrics: {
      totalQueries: 'Jumla ya Maswali',
      uniqueUsers: 'Watumiaji wa Kipekee',
      avgResponseTime: 'Wastani wa Muda wa Majibu',
      satisfaction: 'Kuridhika kwa Watumiaji'
    },

    // Table headers and labels
    table: {
      rank: 'Nafasi',
      query: 'Swali',
      count: 'Idadi',
      avgTime: 'Wastani wa Muda'
    },

    // Chart labels and legends
    chartLabels: {
      categories: 'Vikundi',
      serviceCategories: 'Vikundi vya Huduma',
      byUsage: 'kwa Matumizi',
      category: 'Kikundi'
    },

    // Tooltips and hints
    tooltips: {
      selectPeriod: 'Chagua kipindi',
      selectDate: 'Chagua tarehe',
      exportData: 'Toa data'
    },

    // Status messages
    status: {
      loading: 'Inapakia data za uchanganuzi...',
      noData: 'Hakuna data inayopatikana kwa kipindi hiki',
      error: 'Imeshindwa kupakia data za uchanganuzi'
    },

    // Trend indicators
    slower: 'polepole zaidi',
    faster: 'haraka zaidi',
    percentage: 'Asilimia',

    // Additional analytics fields
    note: 'Dashibodi hii inaonyesha takwimu za matumizi na maoni ya watumiaji wa mfumo wa mazungumzo.',
    usageStats: 'Takwimu za Matumizi',
    totalQueries: 'Jumla ya Maswali',
    avgResponseTime: 'Wastani wa Muda wa Majibu',
    peakUsers: 'Watumiaji wa Juu Zaidi',
    activeChats: 'Mazungumzo Yanayoendelea',
    usageTrend: 'Mwelekeo wa Matumizi',
    topQueries: 'Maswali ya Juu',
    feedbackSamples: 'Maoni ya Watumiaji',
    close: 'Funga',
    chartComingSoon: 'Uonyeshaji wa chati unakuja hivi karibuni...',
    error: 'Imeshindwa kupakia data za uchambuzi',
    retry: 'Jaribu tena',
    dailyQueries: 'Maswali ya Kila Siku',
    export: 'Toa Data',
    dateRange: 'Kipindi cha Tarehe',
    startDate: 'Tarehe ya Kuanza',
    endDate: 'Tarehe ya Mwisho',

    // Added for AnalyticsComponent.vue
    rank: 'Nafasi',
    query: 'Ombi',
    count: 'Idadi',
    avgTime: 'Wastani wa Muda',
    serviceUsage: 'Matumizi ya Vikundi vya Huduma',

    // Added for UsageTrendChart.vue
    usageTrends: 'Mienendo ya Matumizi',
    week: 'Wiki Iliyopita',
    month: 'Mwezi Uliopita',
    quarter: 'Robo Mwaka Iliyopita',
    year: 'Mwaka Uliopita',
    uniqueUsers: 'Watumiaji wa Kipekee',
    satisfactionRate: 'Kiwango cha Kuridhika'
  },
  brandName: 'Huduma AI: Msaidizi Wako wa Kiserikali wa Kidijitali',
  nav: {
    systemStatus: 'Hali ya Mfumo',
    menu: 'Menyu',
    analytics: 'Takwimu',
    userProfile: 'Profaili',
    settings: 'Mipangilio',
    logout: 'Ondoka',
    profile: 'Profaili Yangu',
    toggleSidebar: 'Geuza upau wa pembeni',
    changeLanguage: 'Badilisha lugha',
    languages: {
      english: 'Kiingereza',
      french: 'Kifaransa',
      swahili: 'Kiswahili'
    }
  },
  systemStatus: {
    title: 'Hali ya Huduma',
    services: 'Huduma',
    operational: 'Inafanya Kazi',
    degraded: 'Ina Shida Ndogo',
    outage: 'Haifanyi Kazi',
    allOperational: 'Mifumo Yote',
    someIssues: 'Shida Chache',
    majorIssues: 'Shida Kubwa',
    checking: 'Inakagua...',
    nextDeadline: 'Tarehe ya Mwisho Ijayo',
    days: 'siku',
    viewDetails: 'Angalia Maelezo Zaidi'
  },
  // Service names
  services: {
    eCitizen: 'Tovuti ya eCitizen',
    taxFiling: 'Mfumo wa Kutuma Kodi',
    idApplication: 'Maombi ya Kitambulisho',
    businessReg: 'Usajili wa Biashara',
    drivingLicense: 'Leseni ya Udereva'
  },

  // Deadline titles
  deadlines: {
    taxFiling: 'Tarehe ya Mwisho ya Kutuma Kodi',
    businessRenewal: 'Kuhuisha Leseni ya Biashara',
    idRenewal: 'Kuhuisha Kitambulisho',
    vehicleRegistration: 'Tarehe ya Mwisho ya Usajili wa Gari'
  },
  sidebar: {
    governmentServices: 'Huduma za Serikali',
    chatHistory: 'Historia ya Gumzo',
    searchPlaceholder: 'Tafuta huduma...',
    createFolder: 'Unda Folda',
    editFolder: 'Hariri Folda',
    folderName: 'Jina la Folda',
    folderNamePlaceholder: 'Ingiza jina la folda',
    moveChat: 'Hamisha Mazungumzo',
    moveChatTo: 'Hamisha Mazungumzo Kwenda',
    selectFolder: 'Chagua Folda',
    deleteChat: 'Futa Mazungumzo',
    deleteChatConfirm: 'Je, una uhakika unataka kufuta mazungumzo haya?',
    deleteChatWarning: 'Kitendo hiki hakiwezi kutenduliwa.',
    renameChat: "Badilisha jina la mazungumzo",
    chatTitle: "Kichwa cha mazungumzo",
    chatTitlePlaceholder: "Ingiza kichwa cha mazungumzo haya",
    deleteFolder: "Futa Folda",
    deleteFolderConfirm: "Una uhakika unataka kufuta folda ya '{name}'?",
    chatsMoveWarning: "Mazungumzo yote katika folda hii yatahamishwa kwenye folda ya chaguo-msingi.",
    weatherTitle: "Utabiri wa Hali ya Hewa",
    weatherLoading: "Inapakia data ya hali ya hewa...",
    weatherError: "Imeshindwa kupakia data ya hali ya hewa. Tafadhali jaribu tena.",
    folders: "Folda",
    emptyFolder: "Hakuna mazungumzo katika folda hii",
    title: 'Taarifa na Rasilimali',
    chatHistory: 'Mazungumzo ya Hivi Karibuni',
    noChats: 'Hakuna mazungumzo ya hivi karibuni',
    relatedDocs: 'Nyaraka Zinazohusiana',
    noDocuments: 'Hakuna nyaraka zinazohusiana',
    faq: 'Maswali Yanayoulizwa Mara kwa Mara'
  },
  leftPanel: {
    cat1: {
      name: '1. Utambulisho & Usajili wa Kiraia',
      children: [
        'Vyeti vya kuzaliwa',
        'Vitambulisho vya Taifa',
        'Pasi za kusafiria',
        'Vyeti vya ndoa na vifo',
        'Usajili wa wapiga kura'
      ]
    },
    cat2: {
      name: '2. Huduma za Afya & Ustawi wa Jamii',
      children: [
        'Upatikanaji wa huduma za afya',
        'Mikakati ya chanjo',
        'Bima ya afya',
        'Huduma za walemavu',
        'Msaada wa ustawi na chakula'
      ]
    },
    cat3: {
      name: '3. Elimu & Kujifunza',
      children: [
        'Shule za umma na vyuo vikuu',
        'Mikopo na ufadhili wa wanafunzi',
        'Programu za elimu ya watu wazima',
        'Rasilimali za kujifunza mtandaoni'
      ]
    },
    cat4: {
      name: '4. Ajira & Huduma za Kazi',
      children: [
        'Utafutaji wa kazi na malipo ya ukosefu wa ajira',
        'Haki na ulinzi wa wafanyakazi',
        'Kanuni za usalama kazini',
        'Mafunzo ya stadi na uanagenzi'
      ]
    },
    cat5: {
      name: '5. Ushuru & Mapato',
      children: [
        'Kuwasilisha kodi ya mapato na marejesho',
        'Malipo ya kodi ya mali',
        'Uz compliance kodi za biashara',
        'Ushuru wa forodha na uingizaji'
      ]
    },
    cat6: {
      name: '6. Usalama wa Umma & Sheria',
      children: [
        'Polisi na huduma za dharura',
        'Mahakama na msaada wa kisheria',
        'Kuripoti uhalifu',
        'Sheria za ulinzi wa watumiaji'
      ]
    },
    cat7: {
      name: '7. Usafiri & Uhamaji',
      children: [
        'Leseni za udereva na usajili wa magari',
        'Usafiri wa umma na miundombinu',
        'Makosa ya trafiki na faini',
        'Programu za usalama barabarani'
      ]
    },
    cat8: {
      name: '8. Makazi & Maendeleo ya Miji',
      children: [
        'Msaada wa makazi ya umma',
        'Usajili wa ardhi na mali',
        'Mikopo na ruzuku za makazi',
        'Kibali cha ujenzi na upangaji'
      ]
    },
    cat9: {
      name: '9. Huduma za Umma & Mazingira',
      children: [
        'Huduma za maji na umeme',
        'Usimamizi wa taka na urejelezaji',
        'Kanuni za mazingira',
        'Miradi ya nishati mbadala'
      ]
    },
    cat10: {
      name: '10. Biashara & Biashara',
      children: [
        'Usajili wa biashara na leseni',
        'Kanuni na vibali vya biashara',
        'Misaada na motisha kwa biashara ndogo',
        'Msaada wa biashara za mtandaoni'
      ]
    },
    cat11: {
      name: '11. Hifadhi ya Jamii & Pensheni',
      children: [
        'Manufaa ya kustaafu',
        'Usimamizi wa mfuko wa pensheni',
        'Manufaa ya warithi',
        'Pensheni za ulemavu'
      ]
    },
    cat12: {
      name: '12. Jamii & Ushiriki wa Kiraia',
      children: [
        'Kupiga kura na uchaguzi',
        'Maoni ya umma na malalamiko ya raia',
        'Kujitolea na programu za jamii',
        'Ushiriki katika serikali za mitaa'
      ]
    }
  },
  settings: {
    title: 'Mipangilio',
    save: 'Hifadhi Mipangilio',
    close: 'Funga',
    saveSuccess: 'Mipangilio imehifadhiwa kwa mafanikio',
    saveError: 'Hitilafu katika kuhifadhi mipangilio',
    language: {
      title: 'Lugha',
      selectLabel: 'Lugha ya Onyesho'
    },
    appearance: {
      title: 'Muonekano',
      theme: 'Mandhari',
      lightTheme: 'Angavu',
      darkTheme: 'Giza',
      systemTheme: 'Mfumo',
      fontSize: 'Ukubwa wa Fonti'
    },
    notifications: {
      title: 'Arifa',
      emailUpdates: 'Arifa za barua pepe',
      soundEnabled: 'Arifa za sauti'
    },
    account: {
      title: 'Akaunti',
      resetUserData: 'Rudisha Data za Mtumiaji',
      resetDescription: 'Hii itafuta data zote za wasifu wako na historia ya mazungumzo.',
      confirmReset: 'Je, una uhakika unataka kufuta data zako zote? Hili halitaweza kutendeka tena.',
      resetComplete: 'Data zako zimerudishwa.'
    }
  },
  userProfile: {
    title: 'Wasifu wa Mtumiaji',
    privacyInfo:
      'Kwa kutoa taarifa zaidi, utapata majibu sahihi na muhimu. Tafadhali soma',
    privacyPolicyLink: 'Sera ya Faragha',
    tabs: {
      tab1: '1. Taarifa za Utambulisho',
      tab2: '2. Usajili wa Kiraia & Nyaraka',
      tab3: '3. Anwani & Makazi',
      tab4: '4. Nyaraka za Kitambulisho & Safari',
      tab5: '5. Afya & Rekodi za Matibabu',
      tab6: '6. Ajira & Uchumi',
      tab7: '7. Elimu & Masomo',
      tab8: '8. Fedha & Ushuru',
      tab9: '9. Hifadhi ya Jamii & Ustawi',
      tab10: '10. Kumbukumbu za Jinai & Sheria',
      tab11: '11. Usafiri & Uhamaji',
      tab12: '12. Ushiriki wa Kiraia & Kisiasa'
    },
    fields: {
      // Tab 1
      fullName: 'Jina Kamili',
      dob: 'Tarehe ya Kuzaliwa',
      gender: 'Jinsia',
      nationality: 'Uraia',
      maritalStatus: 'Hali ya Ndoa',
      photograph: 'Picha',
      biometric: 'Alama za Vidole / Data za Kibayometriki',

      // Tab 2
      birthCert: 'Cheti cha Kuzaliwa',
      deathCert: 'Cheti cha Kifo',
      marriageDivorce: 'Rekodi za Ndoa / Talaka',
      adoption: 'Rekodi za Kuasili',
      citizenship: 'Nyaraka za Uraia / Uhamiaji',
      immigration: 'Historia ya Uhamiaji na Visa',

      // Tab 3
      currentAddress: 'Anwani ya Sasa ya Makazi',
      previousAddresses: 'Anwani za Awali',
      homeOrRental: 'Maelezo ya Umiliki au Upangaji',
      utilityBills: 'Bili za Huduma Zinazohusiana na Anwani',
      landRecords: 'Rekodi za Umiliki wa Ardhi na Mali',

      // Tab 4
      idCard: 'Nambari ya Kitambulisho cha Taifa',
      passport: 'Maelezo ya Pasipoti',
      driversLicense: 'Leseni ya Udereva',
      voterId: 'Kitambulisho cha Mpiga Kura',
      ssn: 'Nambari ya Hifadhi ya Jamii / Bima ya Taifa',
      militaryRecords: 'Rekodi za Huduma ya Jeshi',

      // Tab 5
      medicalHistory: 'Historia ya Matibabu na Hali za Afya',
      vaccinations: 'Rekodi za Chanjo',
      insuranceDetails: 'Maelezo ya Bima ya Afya',
      disability: 'Hali ya Ulemavu',
      organDonor: 'Hali ya Mchango wa Viungo',
      prescriptions: 'Maagizo ya Dawa na Matibabu Yaliyopokelewa',
      mentalHealth: 'Historia ya Afya ya Akili',

      // Tab 6
      eHistory: 'Historia ya Ajira',
      currentEmployer: 'Maelezo ya Mwajiri wa Sasa',
      workPermits: 'Vibali vya Kazi na Mikataba',
      certifications: 'Vyeti na Leseni za Kitaaluma',
      unemployment: 'Hali ya Ukosefu wa Ajira na Manufaa Yaliyopokelewa',
      tin: 'Nambari ya Utambulisho wa Mlipa Kodi (TIN)',
      businessAffiliations: 'Umiliki wa Biashara na Ushirikiano wa Kampuni',

      // Tab 7
      schools: 'Shule na Vyuo Vilivyohudhiriwa',
      diplomas: 'Diploma, Shahada, na Vyeti',
      performance: 'Utendaji wa Kitaaluma na Alama za Mitihani',
      scholarships: 'Ufadhili na Msaada wa Kifedha Uliopokelewa',

      // Tab 8
      incomeTax: 'Rekodi za Kodi ya Mapato',
      bankAccounts: 'Akaunti za Benki na Fedha',
      propertyTax: 'Malipo ya Kodi ya Mali',
      businessTax: 'Maelezo ya Kodi ya Biashara',
      pensionContrib: 'Michango na Uondoaji wa Pensheni',
      loanAid: 'Rekodi za Mikopo na Misaada ya Serikali',

      // Tab 9
      pensionStatus: 'Hali ya Pensheni na Michango',
      childcare: 'Msaada wa Utunzaji wa Watoto',
      foodAssistance: 'Programu za Msaada wa Chakula / Ustawi',
      housingAssistance: 'Msaada wa Nyumba',

      // Tab 10
      policeRecords: 'Rekodi za Polisi (historia ya uhalifu, kukamatwa, mashtaka)',
      courtCases: 'Historia ya Kesi za Mahakama',
      finesPenalties: 'Faini na Adhabu',
      paroleProbation: 'Hali ya Parole au Probesheni',
      citizenshipRevocation: 'Kufutwa kwa Uraia (kama inatumika)',

      // Tab 11
      vehicleReg: 'Maelezo ya Usajili wa Gari',
      trafficViolations: 'Ukiukaji wa Sheria za Trafiki na Faini',
      licenseHistory: 'Historia ya Leseni ya Udereva na Vidokezo',
      publicTransportCard: 'Matumizi ya Kadi ya Usafiri wa Umma',

      // Tab 12
      voterRegistration: 'Maelezo ya Usajili wa Mpiga Kura',
      electionHistory: 'Historia ya Ushiriki wa Uchaguzi',
      partyMembership: 'Uanachama wa Chama cha Kisiasa',
      militaryStatus: 'Huduma ya Jeshi au Hali ya Utii',
      publicServiceRoles: 'Majukumu ya Huduma za Umma'
    },
    actions: {
      cancel: 'Ghairi',
      save: 'Hifadhi Profaili',
      previous: 'Iliyopita',
      next: 'Inayofuata',
      saving: 'Inahifadhi...'
    },
    tabComingSoon: 'Kichupo hiki kipo katika maendeleo na kitapatikana hivi karibuni.',
    saveSuccess: 'Wasifu umehifadhiwa kwa mafanikio',
    loadError: 'Hitilafu katika kupakia data ya wasifu',
    saveError: 'Hitilafu katika kuhifadhi wasifu',
    confirmCancel: 'Una mabadiliko ambayo hayajahifadhiwa. Je, una uhakika unataka kughairi?',
    uploadPhoto: 'Pakia Picha',
    uploadFile: 'Pakia Faili',
    photoRequirements: 'Picha lazima iwe wazi, ya hivi karibuni, na ionyeshe uso wako kamili',
    biometricRequirements: 'Ni faili rasmi za data za bayometriki pekee zinazokubaliwa',
    requiredFields: 'Sehemu zinazohitajika',
    documentUpload: 'Kupakia Nyaraka',
    validationTitle: 'Tafadhali sahihisha makosa yafuatayo:',
    completionStatus: 'Imekamilika {percent}%',
    validation: {
      nameRequired: 'Jina kamili linahitajika',
      dobRequired: 'Tarehe ya kuzaliwa inahitajika',
      dobFuture: 'Tarehe ya kuzaliwa haiwezi kuwa wakati ujao'
    },
    placeholders: {
      fullName: 'Ingiza jina lako kamili la kisheria',
      nationality: 'Ingiza uraia wako'
    },
    gender: {
      male: 'Mwanaume',
      female: 'Mwanamke',
      other: 'Nyingine',
      preferNot: 'Sipendelei kusema'
    },
    maritalStatus: {
      single: 'Sijaoa/Sijaolewa',
      married: 'Nimeoa/Nimeolewa',
      divorced: 'Nimetalikiwa/Nimetaliki',
      widowed: 'Mjane',
      other: 'Nyingine'
    },
    select: 'Tafadhali chagua',
    existingFile: 'Faili iliyopo'
  },
  chatbot: {
    placeholder: 'Andika swali lako hapa...',
    sendButton: 'Tuma',
    fileReceived: 'Faili imepokelewa.',
    fileUploadError: 'Hitilafu katika kupakia faili.',
    processingError: 'Hitilafu katika kushughulikia ombi lako.',
    welcomeMessage: 'Karibu! Nawezaje kukusaidia na huduma za serikali ya Kenya leo?',
    attachFile: 'Ambatisha Faili',
    fileTooLarge: 'Faili ni kubwa sana. Ukubwa wa juu ni {maxSize}.',
    saveChat: 'Hifadhi Mazungumzo',
    chatTitle: 'Kichwa cha Mazungumzo',
    chatTitlePlaceholder: 'Ingiza kichwa cha mazungumzo haya',
    selectFolder: 'Chagua Folda',
    newChat: 'Mazungumzo Mapya',
    clearContext: 'Futa muktadha na anza mazungumzo mapya',
    unsavedChanges: 'Una mabadiliko ambayo hayajahifadhiwa. Una uhakika unataka kuanza mazungumzo mapya?',
    whatCanIHelp: "Naweza kukusaidia vipi leo?",
    justChat: "Ongea tu"
  },
  quickhelp: {
    applyForID: "Omba kitambulisho",
    payTaxes: "Lipa kodi",
    startBusiness: "Anza biashara",
    findHealthcare: "Pata huduma za afya",
    educationServices: "Huduma za elimu",
    transportLicenses: "Usafiri na leseni",
    housingPrograms: "Programu za nyumba",
    findJobs: "Tafuta kazi"
  },
  common: {
    cancel: 'Ghairi',
    create: 'Unda',
    save: 'Hifadhi',
    move: 'Hamisha',
    delete: 'Futa'
  },
  feedback: {
    title: 'Maoni',
    positive: 'Maoni mazuri',
    negative: 'Maoni hasi',
    promptText: 'Je, jibu hili lilikuwa la msaada?',
    placeholder: 'Maoni ya ziada...',
    submit: 'Wasilisha Maoni',
    close: 'Ghairi',
    thankYouMessage: 'Asante kwa maoni yako!',
    submitting: 'Inawasilisha...',
    error: 'Hitilafu imetokea. Tafadhali jaribu tena.'
  },
  responseRating: {
    title: 'Tusaidie Kuboresha',
    note: 'Maoni yako yatatumika kuboresha chatbot na kuboresha majibu kwa muda.',
    chatbotResponse: 'Jibu la Chatbot:',
    ratingLabels: {
      1: 'Haina msaada',
      2: 'Msaada Kidogo',
      3: 'Msaada wa Wastani',
      4: 'Msaada Sana',
      5: 'Inabadilisha Maisha'
    },
    additionalComments: 'Maoni ya ziada...',
    submit: 'Wasilisha',
    cancel: 'Ghairi'
  }
}
