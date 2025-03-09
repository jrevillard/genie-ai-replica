// src/i18n.js

import { createI18n } from 'vue-i18n'

const messages = {
  // ----------------------------------------------------------------
  // ENGLISH
  en: {
    brandName: 'Kenya eGovernment AI Services for Citizens',
    nav: {
      menu: 'Menu',
      analytics: 'Analytics',
      userProfile: 'User Profile',
      settings: 'Settings',
      logout: 'Log Out',
      profile: 'My Profile'
    },
    sidebar: {
      governmentServices: 'Government Services',
      chatHistory: 'Chat History',
      searchPlaceholder: 'Search services...',
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
      chatTitlePlaceholder: "Enter a title for this chat",
      searchPlaceholder: "Search services..."
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
    analytics: {
      title: 'Data Analytics & Insights',
      note: 'Below are usage stats and user feedback summaries.',
      usageStats: 'Usage Statistics',
      totalQueries: 'Total Queries',
      avgResponseTime: 'Avg Response Time',
      peakUsers: 'Peak Concurrent Users',
      activeChats: 'Active Chats',
      usageTrend: 'Usage Trend',
      topQueries: 'Top Queries',
      feedbackSamples: 'User Feedback Samples',
      close: 'Close',
      loading: 'Loading analytics data...',
      chartComingSoon: 'Interactive chart visualization coming soon...',
      error: 'Failed to load analytics data',
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
      serviceUsage: 'Service Categories Usage',
      // Added for UsageTrendChart.vue
      usageTrends: 'Usage Trends',
      week: 'Last Week',
      month: 'Last Month',
      quarter: 'Last Quarter',
      year: 'Last Year',
      uniqueUsers: 'Unique Users',
      satisfactionRate: 'Satisfaction Rate'
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
      }
    },
    userProfile: {
      title: 'User Profile',
      privacyInfo:
        "By providing more information, you'll get more accurate and meaningful responses from the chatbot. Please review our",
      privacyPolicyLink: 'Privacy Policy',
      tabs: {
        tab1: '1. Personal Identification Data',
        tab2: '2. Civil Registration & Documentation',
        tab3: '3. Address & Residency Information',
        tab4: '4. Identity & Travel Documents',
        tab5: '5. Health & Medical Records',
        tab6: '6. Employment & Economic Data',
        tab7: '7. Education & Academic Records',
        tab8: '8. Financial & Tax Data',
        tab9: '9. Social Security & Welfare',
        tab10: '10. Criminal & Legal Records',
        tab11: '11. Transportation & Mobility',
        tab12: '12. Civic & Political Participation'
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
        publicServiceRoles: 'Public service roles'
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
        nationality: 'Enter your nationality'
      },
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
      existingFile: 'Existing file'
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
  },

  // ----------------------------------------------------------------
  // FRENCH
  fr: {
    brandName: 'Services IA du eGouvernement du Kenya pour les Citoyens',
    nav: {
      menu: 'Menu',
      analytics: 'Analytique',
      userProfile: 'Profil Utilisateur',
      settings: 'Paramètres',
      logout: 'Déconnexion',
      profile: 'Mon Profil'
    },
    sidebar: {
      governmentServices: 'Services gouvernementaux',
      chatHistory: 'Historique de conversation',
      searchPlaceholder: 'Rechercher un service...',
      createFolder: 'Créer un Dossier',
      editFolder: 'Modifier le Dossier',
      folderName: 'Nom du Dossier',
      folderNamePlaceholder: 'Entrez le nom du dossier',
      moveChat: 'Déplacer la Conversation',
      moveChatTo: 'Déplacer Vers',
      selectFolder: 'Sélectionner un Dossier',
      deleteChat: 'Supprimer la Conversation',
      deleteChatConfirm: 'Êtes-vous sûr de vouloir supprimer cette conversation?',
      deleteChatWarning: 'Cette action ne peut pas être annulée.',
      renameChat: "Renommer la conversation",
      chatTitle: "Titre de la conversation",
      chatTitlePlaceholder: "Entrez un titre pour cette conversation",
      deleteFolder: "Supprimer le dossier",
      deleteFolderConfirm: "Êtes-vous sûr de vouloir supprimer le dossier '{name}' ?",
      chatsMoveWarning: "Toutes les conversations de ce dossier seront déplacées vers le dossier par défaut.",
      weatherTitle: "Prévisions Météo",
      weatherLoading: "Chargement des données météo...",
      weatherError: "Impossible de charger les données météo. Veuillez réessayer.",
      folders: "Dossiers",
      emptyFolder: "Aucune conversation dans ce dossier",
      chatTitlePlaceholder: "Entrez un titre pour cette conversation",
      searchPlaceholder: "Rechercher des services..."
    },
    leftPanel: {
      cat1: {
        name: '1. Identité & Enregistrement civil',
        children: [
          'Actes de naissance',
          "Cartes d'identité nationale",
          'Passeports',
          'Actes de mariage et de décès',
          'Inscription sur les listes électorales'
        ]
      },
      cat2: {
        name: '2. Santé & Services sociaux',
        children: [
          'Accès aux soins publics',
          'Programmes de vaccination',
          'Assurance maladie',
          'Allocations pour invalidité',
          'Aide sociale et alimentaire'
        ]
      },
      cat3: {
        name: '3. Éducation & Apprentissage',
        children: [
          'Écoles et universités publiques',
          'Bourses et prêts étudiants',
          "Programmes d'éducation pour adultes",
          "Ressources d'apprentissage en ligne"
        ]
      },
      cat4: {
        name: '4. Emploi & Services du travail',
        children: [
          "Recherche d'emploi et allocations chômage",
          'Droits et protections des travailleurs',
          'Réglementations sur la sécurité au travail',
          'Formations et apprentissages'
        ]
      },
      cat5: {
        name: '5. Impôts & Recettes',
        children: [
          "Déclaration d'impôts et remboursements",
          'Paiements de taxes foncières',
          'Conformité fiscale des entreprises',
          'Droits de douane et importation'
        ]
      },
      cat6: {
        name: '6. Sécurité publique & Justice',
        children: [
          "Police et services d'urgence",
          'Tribunaux et aide juridique',
          'Déclaration de crimes',
          'Lois de protection des consommateurs'
        ]
      },
      cat7: {
        name: '7. Transport & Mobilité',
        children: [
          'Permis de conduire et immatriculation',
          'Transports publics et infrastructures',
          'Infractions routières et amendes',
          'Programmes de sécurité routière'
        ]
      },
      cat8: {
        name: '8. Logement & Aménagement urbain',
        children: [
          'Aide au logement social',
          'Enregistrement des propriétés et terrains',
          'Prêts et subventions au logement',
          'Permis de zonage et de construction'
        ]
      },
      cat9: {
        name: '9. Services publics & Environnement',
        children: [
          "Services d'eau et d'électricité",
          'Gestion des déchets et recyclage',
          'Réglementations environnementales',
          "Initiatives d'énergie renouvelable"
        ]
      },
      cat10: {
        name: '10. Affaires & Commerce',
        children: [
          'Enregistrement et licences commerciales',
          'Réglementations et permis de commerce',
          'Subventions et incitations pour PME',
          'Soutien au commerce électronique'
        ]
      },
      cat11: {
        name: '11. Sécurité sociale & Retraites',
        children: [
          'Allocations de retraite',
          'Gestion des fonds de pension',
          'Allocations de survivant',
          'Pensions pour invalidité'
        ]
      },
      cat12: {
        name: '12. Communauté & Participation civique',
        children: [
          'Élections et vote',
          "Retour d'information et plaintes des citoyens",
          'Bénévolat et programmes communautaires',
          'Participation au gouvernement local'
        ]
      }
    },
    analytics: {
      title: 'Tableau de Bord Analytique',
      note: 'Ce tableau de bord présente les statistiques d\'utilisation et les commentaires des utilisateurs du système de chat.',
      usageStats: 'Statistiques d\'Utilisation',
      totalQueries: 'Total des Requêtes',
      avgResponseTime: 'Temps de Réponse Moyen',
      peakUsers: 'Utilisateurs Simultanés',
      activeChats: 'Chats Actifs',
      usageTrend: 'Tendance d\'Utilisation',
      topQueries: 'Requêtes Principales',
      feedbackSamples: 'Commentaires des Utilisateurs',
      close: 'Fermer',
      loading: 'Chargement des données analytiques...',
      chartComingSoon: 'Visualisation graphique interactive bientôt disponible...',
      error: 'Échec du chargement des données',
      retry: 'Réessayer',
      dailyQueries: 'Requêtes Quotidiennes',
      export: 'Exporter les Données',
      dateRange: 'Période',
      startDate: 'Date de début',
      endDate: 'Date de fin',
      // Added for AnalyticsComponent.vue
      rank: 'Rang',
      query: 'Requête',
      count: 'Nombre',
      avgTime: 'Temps Moyen',
      serviceUsage: 'Utilisation des Catégories de Service',
      // Added for UsageTrendChart.vue
      usageTrends: 'Tendances d\'Utilisation',
      week: 'Dernière Semaine',
      month: 'Dernier Mois',
      quarter: 'Dernier Trimestre',
      year: 'Dernière Année',
      uniqueUsers: 'Utilisateurs Uniques',
      satisfactionRate: 'Taux de Satisfaction'
    },
    settings: {
      title: 'Paramètres',
      save: 'Enregistrer',
      close: 'Fermer',
      saveSuccess: 'Paramètres enregistrés avec succès',
      saveError: 'Erreur lors de l\'enregistrement des paramètres',
      language: {
        title: 'Langue',
        selectLabel: 'Langue d\'affichage'
      },
      appearance: {
        title: 'Apparence',
        theme: 'Thème',
        lightTheme: 'Clair',
        darkTheme: 'Sombre',
        systemTheme: 'Système',
        fontSize: 'Taille de police'
      },
      notifications: {
        title: 'Notifications',
        emailUpdates: 'Mises à jour par email',
        soundEnabled: 'Notifications sonores'
      },
      account: {
        title: 'Compte',
        resetUserData: 'Réinitialiser les données',
        resetDescription: 'Cela effacera toutes vos données de profil et votre historique de chat.',
        confirmReset: 'Êtes-vous sûr de vouloir réinitialiser toutes vos données ? Cette action ne peut pas être annulée.',
        resetComplete: 'Vos données ont été réinitialisées.'
      }
    },
    userProfile: {
      title: 'Profil Utilisateur',
      privacyInfo:
        "En fournissant plus d'informations, vous obtiendrez des réponses plus précises. Veuillez consulter notre",
      privacyPolicyLink: 'Politique de Confidentialité',
      tabs: {
        tab1: '1. Données d\'identification personnelle',
        tab2: '2. Enregistrement civil & Documentation',
        tab3: '3. Adresse & Résidence',
        tab4: '4. Documents d\'identité & Voyage',
        tab5: '5. Dossiers de santé & médicaux',
        tab6: '6. Emploi & Économie',
        tab7: '7. Éducation & Académique',
        tab8: '8. Données Financières & Impôts',
        tab9: '9. Sécurité sociale & Aide',
        tab10: '10. Casier judiciaire & Légal',
        tab11: '11. Transport & Mobilité',
        tab12: '12. Participation Civique & Politique'
      },
      fields: {
        // Tab 1
        fullName: 'Nom complet (y compris alias)',
        dob: 'Date de naissance',
        gender: 'Genre',
        nationality: 'Nationalité',
        maritalStatus: 'État civil',
        photograph: 'Photographie',
        biometric: 'Empreintes / Données biométriques',
        
        // Tab 2
        birthCert: 'Acte de naissance',
        deathCert: 'Acte de décès',
        marriageDivorce: 'Actes de mariage / divorce',
        adoption: 'Documents d\'adoption',
        citizenship: 'Documents de citoyenneté / naturalisation',
        immigration: 'Historique d\'immigration et visas',
        
        // Tab 3
        currentAddress: 'Adresse résidentielle actuelle',
        previousAddresses: 'Adresses précédentes',
        homeOrRental: 'Détails de propriété ou de location',
        utilityBills: 'Factures de services liées à l\'adresse',
        landRecords: 'Registres de propriété foncière',
        
        // Tab 4
        idCard: 'Numéro de carte d\'identité nationale',
        passport: 'Détails du passeport',
        driversLicense: 'Permis de conduire',
        voterId: 'Carte d\'électeur',
        ssn: 'Numéro de sécurité sociale / assurance nationale',
        militaryRecords: 'États de service militaire',
        
        // Tab 5
        medicalHistory: 'Antécédents médicaux et conditions de santé',
        vaccinations: 'Registre de vaccinations',
        insuranceDetails: 'Détails d\'assurance santé',
        disability: 'Statut d\'invalidité',
        organDonor: 'Statut de donneur d\'organes',
        prescriptions: 'Prescriptions et traitements reçus',
        mentalHealth: 'Historique de santé mentale',
        
        // Tab 6
        eHistory: 'Historique d\'emploi',
        currentEmployer: 'Détails de l\'employeur actuel',
        workPermits: 'Permis de travail et contrats',
        certifications: 'Certifications et licences professionnelles',
        unemployment: 'Statut de chômage et allocations reçues',
        tin: 'Numéro d\'identification fiscale (NIF)',
        businessAffiliations: 'Propriété d\'entreprise et affiliations',
        
        // Tab 7
        schools: 'Écoles et universités fréquentées',
        diplomas: 'Diplômes, grades et certifications',
        performance: 'Performance académique et résultats de tests',
        scholarships: 'Bourses et aides financières reçues',
        
        // Tab 8
        incomeTax: 'Registres d\'impôt sur le revenu',
        bankAccounts: 'Comptes bancaires et financiers',
        propertyTax: 'Paiements de taxe foncière',
        businessTax: 'Déclarations fiscales d\'entreprise',
        pensionContrib: 'Contributions et retraits de pension',
        loanAid: 'Registres de prêts et d\'aide gouvernementale',
        
        // Tab 9
        pensionStatus: 'Statut de pension et contributions',
        childcare: 'Aide à la garde d\'enfants',
        foodAssistance: 'Programmes d\'aide alimentaire / sociale',
        housingAssistance: 'Aide au logement',
        
        // Tab 10
        policeRecords: 'Casier judiciaire (historique criminel, arrestations, accusations)',
        courtCases: 'Historique des affaires judiciaires',
        finesPenalties: 'Amendes et pénalités',
        paroleProbation: 'Statut de libération conditionnelle ou probation',
        citizenshipRevocation: 'Révocation de citoyenneté (si applicable)',
        
        // Tab 11
        vehicleReg: 'Détails d\'immatriculation de véhicule',
        trafficViolations: 'Infractions routières et amendes',
        licenseHistory: 'Historique du permis de conduire et avenants',
        publicTransportCard: 'Utilisation de carte de transport public',
        
        // Tab 12
        voterRegistration: 'Détails d\'inscription électorale',
        electionHistory: 'Historique de participation électorale',
        partyMembership: 'Adhésion à un parti politique',
        militaryStatus: 'Service militaire ou statut de conscription',
        publicServiceRoles: 'Rôles de service public'
      },
      actions: {
        cancel: 'Annuler',
        save: 'Enregistrer',
        previous: 'Précédent',
        next: 'Suivant',
        saving: 'Enregistrement...'
      },
      tabComingSoon: 'Cet onglet est en cours de développement et sera bientôt disponible.',
      saveSuccess: 'Profil enregistré avec succès',
      loadError: 'Erreur lors du chargement du profil',
      saveError: 'Erreur lors de l\'enregistrement du profil',
      confirmCancel: 'Vous avez des modifications non enregistrées. Êtes-vous sûr de vouloir annuler?',
      uploadPhoto: 'Télécharger une photo',
      uploadFile: 'Télécharger un fichier',
      photoRequirements: 'La photo doit être claire, récente et montrer votre visage complet',
      biometricRequirements: 'Seuls les fichiers de données biométriques officiels sont acceptés',
      requiredFields: 'Champs obligatoires',
      documentUpload: 'Téléchargement de Documents',
      validationTitle: 'Veuillez corriger les erreurs suivantes:',
      completionStatus: '{percent}% complété',
      validation: {
        nameRequired: 'Le nom complet est requis',
        dobRequired: 'La date de naissance est requise',
        dobFuture: 'La date de naissance ne peut pas être dans le futur'
      },
      placeholders: {
        fullName: 'Entrez votre nom légal complet',
        nationality: 'Entrez votre nationalité'
      },
      gender: {
        male: 'Homme',
        female: 'Femme',
        other: 'Autre',
        preferNot: 'Préfère ne pas dire'
      },
      maritalStatus: {
        single: 'Célibataire',
        married: 'Marié(e)',
        divorced: 'Divorcé(e)',
        widowed: 'Veuf/Veuve',
        other: 'Autre'
      },
      select: 'Veuillez sélectionner',
      existingFile: 'Fichier existant'
    },
    chatbot: {
      placeholder: 'Tapez votre requête ici...',
      sendButton: 'Envoyer',
      fileReceived: 'Fichier reçu avec succès.',
      fileUploadError: 'Erreur lors du téléversement du fichier.',
      processingError: 'Erreur lors du traitement de votre demande.',
      welcomeMessage: 'Bienvenue! Comment puis-je vous aider avec les services du gouvernement kenyan aujourd\'hui?',
      attachFile: 'Joindre un fichier',
      fileTooLarge: 'Le fichier est trop volumineux. La taille maximale est de {maxSize}.',
      saveChat: 'Enregistrer la Conversation',
      chatTitle: 'Titre de la Conversation',
      chatTitlePlaceholder: 'Entrez un titre pour cette conversation',
      selectFolder: 'Sélectionner un Dossier',
      newChat: 'Nouvelle Conversation',
      clearContext: 'Effacer le contexte et démarrer une nouvelle conversation',
      unsavedChanges: 'Vous avez des modifications non enregistrées. Êtes-vous sûr de vouloir commencer une nouvelle conversation?',
      whatCanIHelp: "Comment puis-je vous aider aujourd'hui ?",
      justChat: "Simplement discuter"
    },
    quickhelp: {
      applyForID: "Demander une pièce d'identité",
      payTaxes: "Payer des impôts",
      startBusiness: "Créer une entreprise",
      findHealthcare: "Trouver des soins de santé",
      educationServices: "Services d'éducation",
      transportLicenses: "Transport et permis",
      housingPrograms: "Programmes de logement",
      findJobs: "Trouver un emploi"
    },


    common: {
      cancel: 'Annuler',
      create: 'Créer',
      save: 'Enregistrer',
      move: 'Déplacer',
      delete: 'Supprimer'
    },
    feedback: {
      title: 'Retour d\'information',
      positive: 'Avis positif',
      negative: 'Avis négatif',
      promptText: 'Cette réponse a-t-elle été utile?',
      placeholder: 'Commentaires supplémentaires...',
      submit: 'Soumettre',
      close: 'Annuler',
      thankYouMessage: 'Merci pour votre retour d\'information!',
      submitting: 'Envoi en cours...',
      error: 'Une erreur s\'est produite. Veuillez réessayer.'
    },
    responseRating: {
      title: 'Aidez-nous à Améliorer',
      note: 'Vos commentaires seront utilisés pour mieux ajuster le chatbot et améliorer les réponses au fil du temps.',
      chatbotResponse: 'Réponse du Chatbot:',
      ratingLabels: {
        1: 'Inutile',
        2: 'Légèrement Utile',
        3: 'Modérément Utile',
        4: 'Très Utile',
        5: 'Révolutionnaire'
      },
      additionalComments: 'Commentaires supplémentaires...',
      submit: 'Soumettre',
      cancel: 'Annuler'
    }
  },

  // ----------------------------------------------------------------
  // SWAHILI
  sw: {
    brandName: 'Huduma za Kenya eGovernment AI kwa Wananchi',
    nav: {
      menu: 'Menyu',
      analytics: 'Takwimu',
      userProfile: 'Profaili',
      settings: 'Mipangilio',
      logout: 'Ondoka',
      profile: 'Profaili Yangu'
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
      chatTitlePlaceholder: "Ingiza kichwa cha mazungumzo haya",
      searchPlaceholder: "Tafuta huduma..."
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
    analytics: {
      title: 'Dashibodi ya Takwimu',
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
      loading: 'Inapakia data za uchambuzi...',
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
};

export default createI18n({
  locale: 'en', // default locale
  fallbackLocale: 'en',
  messages
})
