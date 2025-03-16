// src/i18n/locales/fr.js

export default {
  charts: {
    tooltip: {
      title: 'Date',
      totalQueries: 'Requêtes Totales',
      uniqueUsers: 'Utilisateurs Uniques'
    },
    day: 'Jour',
    noData: 'Aucune Donnée',
    notAvailable: 'N/D',
    topQueries: 'Principales Requêtes',
    categoryDistribution: 'Utilisation des Catégories de Service',
    usageTrend: 'Tendance d\'Utilisation'
  },
  analytics: {
    // Dashboard header and controls
    title: 'Données Analytiques & Aperçus',
    period: 'Période',
    
    // Period dropdown options
    periods: {
      daily: 'Quotidien',
      weekly: 'Hebdomadaire',
      monthly: 'Mensuel',
      allTime: 'Tout Temps'
    },
    
    // Metrics section titles and values
    metrics: {
      totalQueries: 'Requêtes Totales',
      uniqueUsers: 'Utilisateurs Uniques',
      avgResponseTime: 'Temps de Réponse Moyen',
      satisfaction: 'Satisfaction des Utilisateurs'
    },
    
    // Table headers and labels
    table: {
      rank: 'Rang',
      query: 'Requête',
      count: 'Nombre',
      avgTime: 'Temps Moyen'
    },
    
    // Chart labels and legends
    chartLabels: {
      categories: 'Catégories',
      serviceCategories: 'Catégories de Service',
      byUsage: 'par Utilisation',
      category: 'Catégorie'
    },
    
    // Tooltips and hints
    tooltips: {
      selectPeriod: 'Sélectionner la période',
      selectDate: 'Sélectionner la date',
      exportData: 'Exporter les données'
    },
    
    // Status messages
    status: {
      loading: 'Chargement des données analytiques...',
      noData: 'Aucune donnée disponible pour cette période',
      error: 'Échec du chargement des données analytiques'
    },
    
    // Trend indicators
    slower: 'plus lent',
    faster: 'plus rapide',
    percentage: 'Pourcentage',
    
    // Additional analytics fields
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
  brandName: 'Huduma AI: Votre Assistant Gouvernemental Numérique',
  nav: {
    systemStatus: 'État du Système',
    menu: 'Menu',
    analytics: 'Analytique',
    userProfile: 'Profil Utilisateur',
    settings: 'Paramètres',
    logout: 'Déconnexion',
    profile: 'Mon Profil',
    toggleSidebar: 'Basculer la barre latérale',
    changeLanguage: 'Changer de langue',
    languages: {
      english: 'Anglais',
      french: 'Français',
      swahili: 'Swahili'
    }
  },
  systemStatus: {
    title: 'État des Services',
    services: 'Services',
    operational: 'Opérationnel',
    degraded: 'Dégradé',
    outage: 'Panne',
    allOperational: 'Tous les Systèmes',
    someIssues: 'Quelques Problèmes',
    majorIssues: 'Problèmes Majeurs',
    checking: 'Vérification...',
    nextDeadline: 'Prochaine Échéance',
    days: 'jours',
    viewDetails: 'Voir les Détails'
  },
  // Service names
  services: {
    eCitizen: 'Portail eCitoyen',
    taxFiling: 'Système de Déclaration Fiscale',
    idApplication: 'Demande de Carte d\'Identité',
    businessReg: 'Enregistrement d\'Entreprise',
    drivingLicense: 'Permis de Conduire'
  },
  // Deadline titles
  deadlines: {
    taxFiling: 'Date Limite de Déclaration Fiscale',
    businessRenewal: 'Renouvellement de Licence Commerciale',
    idRenewal: 'Renouvellement de Carte d\'Identité',
    vehicleRegistration: 'Date Limite d\'Immatriculation de Véhicule'
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
    title: 'Infos et ressources',
    chatHistory: 'Conversations récentes',
    noChats: 'Aucune conversation récente',
    relatedDocs: 'Documents connexes',
    noDocuments: 'Aucun document connexe',
    faq: 'Questions fréquemment posées'
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
}
