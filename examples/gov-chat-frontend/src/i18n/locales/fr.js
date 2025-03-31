// src/i18n/locales/fr.js

export default {
  verification: {
    verifying: 'Vérification de votre email...',
    success: 'Email vérifié avec succès !',
    failed: 'Échec de la vérification',
    accountVerified: 'Votre compte a été vérifié avec succès. Vous pouvez maintenant vous connecter à votre compte.',
    invalidLink: 'Le lien de vérification est invalide ou a expiré.',
    missingToken: 'Le jeton de vérification est manquant.',
    generalError: 'Une erreur s\'est produite lors de la vérification. Veuillez réessayer plus tard.',
    proceedToLogin: 'Continuer vers la connexion',
    backToLogin: 'Retour à la connexion'
  },
  admin: {
    // Libellés généraux du tableau de bord
    huduma: 'Huduma AI',
    dashboard: 'Tableau de bord',
    system: 'Système',
    settings: 'Paramètres',
    overview: 'Aperçu',
    database: 'Base de données',
    logs: 'Journaux',
    userManagement: 'Gestion des utilisateurs',
    security: 'Sécurité',
    systemAdministration: 'Administration du système',
    loading: 'Chargement...',
    close: 'Fermer le tableau de bord',
    edit: 'Modifier',

    // Statistiques et métriques
    systemUptime: 'Temps de fonctionnement',
    avgResponseTime: 'Temps de réponse moyen',
    errorRate: 'Taux d\'erreur',
    activeUsers: 'Utilisateurs actifs',
    fromLastMonth: 'par rapport au mois dernier',

    // Étiquettes des onglets
    tabs: {
      overview: 'État du système',
      database: 'Base de données',
      logs: 'Journaux',
      security: 'Sécurité',
      users: 'Utilisateurs'
    },

    // Santé du système
    systemHealthStatus: 'État de santé du système',
    runDiagnostics: 'Exécuter les diagnostics',
    resourceUsage: 'Utilisation des ressources',

    // Noms des services
    services: {
      apiServices: 'Services API',
      database: 'Base de données',
      cache: 'Cache',
      storage: 'Stockage',
      messageQueue: 'File d\'attente de messages',
      externalApi: 'API externe'
    },

    // Types de ressources
    resources: {
      cpu: 'Utilisation CPU',
      memory: 'Utilisation mémoire',
      storage: 'Utilisation stockage',
      network: 'Bande passante réseau'
    },

    // Gestion de la base de données
    databaseManagement: 'Gestion de la base de données',
    reindexDatabase: 'Réindexer la base',
    lastReindex: 'Dernière réindexation',
    databaseSize: 'Taille de la base',
    totalTables: 'Nombre de tables',

    // Gestion des journaux
    logManagement: 'Gestion des journaux',
    rolloverLogs: 'Rotation des journaux',
    searchLogs: 'Rechercher les journaux',
    logTime: 'Heure',
    logLevel: 'Niveau',
    logService: 'Service',
    logMessage: 'Message',
    showingEntries: 'Affichage de {start} à {end} sur {total} entrées',

    // Niveaux de journaux
    logLevels: {
      error: 'ERREUR',
      warning: 'AVERTISSEMENT',
      info: 'INFO',
      debug: 'DEBUG'
    },

    // Messages de journaux
    logMessages: {
      connectionTimeout: 'Délai de connexion dépassé pour le fournisseur externe',
      lowDiskSpace: 'Espace disque inférieur au seuil de 10%',
      userRoleUpdated: 'Rôle d\'utilisateur mis à jour pour admin@huduma.ai'
    },

    // Surveillance de la sécurité
    securityMonitoring: 'Surveillance de la sécurité',
    securityScan: 'Analyse de sécurité',
    failedLoginAttempts: 'Tentatives de connexion échouées (24h)',
    suspiciousActivities: 'Activités suspectes (24h)',
    lastSecurityScan: 'Dernière analyse de sécurité',
    vulnerabilitiesFound: 'Vulnérabilités trouvées',
    daysAgo: 'jours',
    critical: 'critiques',
    medium: 'moyennes',
    low: 'faibles',

    // Gestion des utilisateurs
    userName: 'Nom',
    userEmail: 'Email',
    userRole: 'Rôle',
    userStatus: 'Statut',
    userActions: 'Actions',
    roleAdministrator: 'Administrateur',
    roleUser: 'Utilisateur',
    statusActive: 'Actif',

    // Actions sur la base de données
    dbActions: {
      reindex: 'Réindexer',
      backup: 'Sauvegarder',
      optimize: 'Optimiser',
      reindexDesc: 'Reconstruire les index de la base',
      backupDesc: 'Créer une sauvegarde de la base',
      optimizeDesc: 'Optimiser les performances des requêtes'
    },

    operations: {
      reindexTitle: 'Résultats de la Réindexation de Base de Données',
      backupTitle: 'Résultats de la Sauvegarde de Base de Données',
      optimizeTitle: 'Résultats de l\'Optimisation de Base de Données',
      reindexResults: 'Résultats de Réindexation',
      optimizeResults: 'Résultats d\'Optimisation',
      collection: 'Collection',
      status: 'Statut',
      indexSuggestions: 'Suggestions d\'Index',
      backupDetails: 'Détails de Sauvegarde',
      backupFile: 'Fichier de Sauvegarde',
      backupLocation: 'Emplacement',
      backupSize: 'Taille',
      errorDetails: 'Détails de l\'Erreur',
      close: 'Fermer',
      resultsTitle: 'Résultats de l\'Opération',
      reindexDatabase: 'Réindexer la Base de Données',
      backupDatabase: 'Sauvegarder la Base de Données',
      optimizeDatabase: 'Optimiser la Base de Données',
      dbActions: {
        reindex: 'Réindexer',
        backup: 'Sauvegarder',
        optimize: 'Optimiser',
        reindexDesc: 'Reconstruire les index de la base de données',
        backupDesc: 'Créer une sauvegarde de la base de données',
        optimizeDesc: 'Optimiser les performances de requête'
      },
      lastReindex: 'Dernière Réindexation',
      databaseSize: 'Taille de la Base de Données',
      totalTables: 'Nombre Total de Tables',
      operations: {
        reindexDatabase: {
          success: 'Réindexation de la base de données terminée avec succès',
          error: 'Erreur lors de la réindexation de la base de données',
          loading: 'Réindexation de la base de données...'
        },
        backupDatabase: {
          success: 'Sauvegarde de la base de données terminée avec succès',
          error: 'Erreur lors de la sauvegarde de la base de données',
          loading: 'Sauvegarde de la base de données...'
        },
        optimizeDatabase: {
          success: 'Optimisation de la base de données terminée avec succès',
          error: 'Erreur lors de l\'optimisation de la base de données',
          loading: 'Optimisation de la base de données...'
        },
        rolloverLogs: {
          success: 'Rotation des journaux terminée avec succès',
          loading: 'Rotation des journaux...'
        },
        searchLogs: {
          success: 'Recherche dans les journaux terminée',
          loading: 'Recherche dans les journaux...'
        },
        runDiagnostics: {
          success: 'Diagnostics terminés avec succès',
          loading: 'Exécution des diagnostics...'
        },
        runSecurityScan: {
          success: 'Analyse de sécurité terminée avec succès',
          loading: 'Exécution de l\'analyse de sécurité...'
        }
      }
    }
  },
  passwordResetConfirm: {
    appTitle: 'Huduma AI',
    resetPassword: 'Créer un nouveau mot de passe',
    tokenLabel: 'Jeton de réinitialisation',
    tokenPlaceholder: 'Entrez le jeton de réinitialisation',
    validateButton: 'Valider le jeton',
    newPasswordLabel: 'Nouveau mot de passe',
    newPasswordPlaceholder: 'Créez un nouveau mot de passe',
    confirmNewPasswordLabel: 'Confirmez le nouveau mot de passe',
    confirmNewPasswordPlaceholder: 'Confirmez votre nouveau mot de passe',
    resetButton: 'Réinitialiser le mot de passe',
    processing: 'Réinitialisation...',
    rememberedPassword: 'Vous rappelez-vous de votre mot de passe ?',
    backToLogin: 'Retour à la connexion',
    supportMessage: 'Besoin d\'aide ? Contactez notre équipe de support',
    passwordRequirements: 'Le mot de passe doit comporter au moins 8 caractères avec au moins 1 chiffre, 1 lettre majuscule et 1 caractère spécial',
    passwordsDoNotMatch: 'Les mots de passe ne correspondent pas',
    resetSuccess: 'Votre mot de passe a été réinitialisé avec succès',
    resetFailed: 'Impossible de réinitialiser le mot de passe. Veuillez réessayer.',
    noTokenProvided: 'Veuillez fournir un jeton de réinitialisation',
    expiredToken: 'Ce jeton de réinitialisation a expiré. Veuillez en demander un nouveau.',
    invalidToken: 'Jeton invalide ou non reconnu',
    validatingToken: 'Validation du jeton...',
    redirecting: 'Redirection vers la page de connexion...',
    passwordStrength: 'Force du mot de passe',
    strengthLabels: {
      veryWeak: 'Très faible',
      weak: 'Faible',
      fair: 'Moyen',
      good: 'Bon',
      strong: 'Fort'
    },
    passwordSuggestions: {
      atLeast8Chars: 'Utilisez au moins 8 caractères',
      addUppercase: 'Ajoutez des lettres majuscules',
      addLowercase: 'Ajoutez des lettres minuscules',
      addNumbers: 'Ajoutez des chiffres',
      addSpecialChars: 'Ajoutez des caractères spéciaux'
    }
  },
  passwordReset: {
    appTitle: 'Huduma AI',
    resetPassword: 'Réinitialiser votre mot de passe',
    emailLabel: 'Adresse email',
    emailPlaceholder: 'Entrez votre email',
    resetButton: 'Envoyer le lien de réinitialisation',
    processing: 'Envoi...',
    rememberPassword: 'Vous vous souvenez de votre mot de passe?',
    backToLogin: 'Retour à la connexion',
    supportMessage: 'Besoin d\'aide? Contactez notre équipe de support',
    invalidEmail: 'Veuillez entrer une adresse email valide',
    resetRequestSuccess: 'Un lien de réinitialisation de mot de passe a été envoyé à votre email',
    resetRequestFailed: 'Impossible d\'envoyer le lien de réinitialisation. Veuillez réessayer.',
    checkEmail: 'Veuillez vérifier votre email pour les instructions à suivre.'
  },

  register: {
    appTitle: "Huduma AI",
    createAccount: "Créer un nouveau compte",
    username: "Nom d'utilisateur",
    usernamePlaceholder: "Entrez un nom d'utilisateur",
    email: "Email",
    emailPlaceholder: "Entrez votre email",
    password: "Mot de passe",
    passwordPlaceholder: "Créez un mot de passe",
    confirmPassword: "Confirmez le mot de passe",
    confirmPasswordPlaceholder: "Confirmez votre mot de passe",
    acceptTerms: "J'accepte les",
    termsOfService: "conditions d'utilisation",
    registerButton: "Créer un compte",
    processing: "Traitement en cours...",
    alreadyHaveAccount: "Vous avez déjà un compte?",
    loginNow: "Connectez-vous",
    privacyNotice: "En vous inscrivant, vous acceptez nos conditions d'utilisation et notre politique de confidentialité",
    usernameMinLength: "Le nom d'utilisateur doit comporter au moins 3 caractères",
    invalidEmail: "Veuillez entrer une adresse email valide",
    passwordRequirements: "Le mot de passe doit comporter au moins 8 caractères avec au moins 1 chiffre et 1 lettre majuscule",
    passwordsDoNotMatch: "Les mots de passe ne correspondent pas",
    mustAcceptTerms: "Vous devez accepter les conditions d'utilisation",
    registrationFailed: "L'inscription a échoué. Veuillez réessayer.",
    usernameExists: "Ce nom d'utilisateur existe déjà",
    emailExists: "Cette adresse email existe déjà",
    registrationSuccess: "Inscription réussie !",
    verificationEmailSent: "Un email de vérification a été envoyé à {email}",
    checkEmailInstructions: "Veuillez vérifier votre email et suivre les instructions pour valider votre compte avant de vous connecter.",
    backToLogin: "Retour à la connexion",
    noEmailReceived: "Vous n'avez pas reçu d'email ?",
    resendVerification: "Renvoyer l'email de vérification",
    verificationResent: "L'email de vérification a été renvoyé",
    verificationResendFailed: "Échec du renvoi de l'email de vérification. Veuillez réessayer.",
    usernameExists: "Ce nom d'utilisateur existe déjà",
    emailExists: "Cette adresse email existe déjà",
    usernameInvalidChars: 'Le nom d\'utilisateur ne peut contenir que des lettres, des chiffres, des traits de soulignement, des points et des traits d\'union',
    networkError: 'Erreur réseau. Veuillez vérifier votre connexion et réessayer.',
    registrationFailed: 'L\'inscription a échoué. Veuillez réessayer.',
    usernameExists: 'Ce nom d\'utilisateur existe déjà',
    emailExists: 'Cet email existe déjà'
  },
  // Login section
  login: {
    appTitle: 'Huduma AI',
    username: 'Nom d\'utilisateur',
    password: 'Mot de passe',
    loginButton: 'Connexion',
    or: 'ou',
    savedAccounts: 'Comptes enregistrés',
    loginSuccess: 'Connexion réussie',
    loginError: 'Échec de la connexion. Veuillez vérifier vos identifiants.',
    googleLogin: 'Continuer avec Google',
    facebookLogin: 'Continuer avec Facebook',
    rememberMe: 'Se souvenir de moi',
    forgotPassword: 'Mot de passe oublié?',
    noAccount: 'Vous n\'avez pas de compte?',
    createAccount: 'Créer un compte',
    termsAndPolicy: 'En vous connectant, vous acceptez nos Conditions d\'Utilisation et notre Politique de Confidentialité',
    noAccount: "Vous n'avez pas de compte?",
    registerNow: "Inscrivez-vous",
    loggingIn: "Connexion en cours...",
    fieldsRequired: "Nom d'utilisateur et mot de passe requis",
    invalidCredentials: "Nom d'utilisateur ou mot de passe invalide",
    tooManyAttempts: "Trop de tentatives de connexion. Veuillez réessayer plus tard.",
    loginFailed: "Échec de la connexion. Veuillez réessayer.",
    oauthNotImplemented: "La connexion sociale n'est pas encore implémentée",
    savedLoginNotImplemented: "La connexion avec compte enregistré n'est pas encore implémentée"
  },
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
    categoryDistribution: 'Utilisation des Domaines de Connaissance',
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
      categories: 'Domaines',  // Changed from 'Catégories'
      serviceCategories: 'Domaines de Connaissance',  // Changed from 'Catégories de Service'
      byUsage: 'par Utilisation',  // No change
      category: 'Domaine'  // Changed from 'Catégorie'
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
    serviceUsage: 'Utilisation des Domaines de Connaissance',

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
    governmentServices: 'Domaines de Connaissance', // Changed from 'Services gouvernementaux'
    chatHistory: 'Historique de conversation',
    searchPlaceholder: 'Rechercher des domaines de connaissance...', // Changed from 'Rechercher un service...'
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
    edit: 'Modifier',
    close: 'Fermer',
    saveSuccess: 'Paramètres enregistrés avec succès',
    saveError: 'Erreur lors de l\'enregistrement des paramètres',
    saveSettings: 'Enregistrer',
    cancel: 'Annuler',

    language: {
      title: 'Langue',
      selectLabel: 'Langue d\'affichage'
    },
    displayLanguage: 'Langue d\'affichage',
    languages: {
      english: 'Anglais',
      french: 'Français',
      swahili: 'Swahili'
    },

    appearance: {
      title: 'Apparence',
      theme: 'Thème',
      lightTheme: 'Clair',
      darkTheme: 'Sombre',
      systemTheme: 'Système',
      fontSize: 'Taille de police'
    },
    display: 'Affichage',
    theme: 'Thème',
    themes: {
      light: 'Clair',
      dark: 'Sombre',
      system: 'Système'
    },
    fontSize: 'Taille de police',

    notifications: {
      title: 'Notifications',
      emailUpdates: 'Mises à jour par email',
      soundEnabled: 'Notifications sonores'
    },
    notifications: 'Notifications',
    emailUpdates: 'Mises à jour par e-mail',
    soundNotifications: 'Notifications sonores',

    account: {
      title: 'Compte',
      resetUserData: 'Réinitialiser les données',
      resetDescription: 'Cela effacera toutes vos données de profil et votre historique de chat.',
      confirmReset: 'Êtes-vous sûr de vouloir réinitialiser toutes vos données ? Cette action ne peut pas être annulée.',
      resetComplete: 'Vos données ont été réinitialisées.'
    },
    accountManagement: 'Gestion du compte',
    emailAddress: 'Adresse e-mail',
    emailAddressPlaceholder: 'Votre adresse e-mail',
    password: 'Mot de passe',
    changePassword: 'Changer le mot de passe',
    resetUserData: 'Réinitialiser les données',
    resetUserDataDesc: 'Cela effacera toutes vos données de profil et votre historique de chat.',
    deleteAccount: 'Supprimer le compte',
    deleteAccountDesc: 'Cela supprimera définitivement votre compte et toutes les données associées.',

    // Additional entries for modals and confirmations
    standardAccount: 'Compte Standard',
    confirmEmailChange: 'Confirmer le changement d\'e-mail',
    pleaseEnterPassword: 'Veuillez entrer votre mot de passe',
    confirmDeleteAccount: 'Êtes-vous sûr de vouloir supprimer votre compte ? Cette action ne peut pas être annulée.',
    confirmAccountDeletion: 'Confirmer la Suppression du Compte',
    accountDeletionWarning: 'Avertissement : Cette action est permanente et ne peut pas être annulée. Toutes vos données seront définitivement supprimées.',
    deletionReason: 'Raison de la suppression (facultatif) :',
    deletionReasonPlaceholder: 'Qu\'est-ce qui vous a fait décider de supprimer votre compte ?',
    enterPasswordConfirm: 'Entrez votre mot de passe pour confirmer :',
    currentPasswordPlaceholder: 'Votre mot de passe actuel',
    deleting: 'Suppression en cours...',
    permanentlyDeleteAccount: 'Supprimer le Compte',
    accountDeletedSuccess: 'Votre compte a été supprimé avec succès.',
    incorrectPassword: 'Mot de passe incorrect',
    accountDeletionFailed: 'Échec de la suppression du compte. Veuillez réessayer plus tard.',
  },
  userProfile: {
    title: 'Profil Utilisateur',
    privacyInfo:
      "En fournissant plus d'informations, vous obtiendrez des réponses plus précises. Veuillez consulter notre",
    privacyPolicyLink: 'Politique de Confidentialité',
    tabs: {
      tab1: 'Données d\'identification personnelle',
      tab2: 'Enregistrement civil & Documentation',
      tab3: 'Adresse & Résidence',
      tab4: 'Documents d\'identité & Voyage',
      tab5: 'Dossiers de santé & médicaux',
      tab6: 'Emploi & Économie',
      tab7: 'Éducation & Académique',
      tab8: 'Données Financières & Impôts',
      tab9: 'Sécurité sociale & Aide',
      tab10: 'Casier judiciaire & Légal',
      tab11: 'Transport & Mobilité',
      tab12: 'Participation Civique & Politique'
    },
    residencyStatuses: {
      citizen: 'Citoyen',
      permanentResident: 'Résident Permanent',
      temporaryResident: 'Résident Temporaire',
      other: 'Autre'
    },
    yesNo: {
      yes: 'Oui',
      no: 'Non'
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
      publicServiceRoles: 'Rôles de service public',
      // New fields
      postalCode: 'Code Postal',
      country: 'Pays',
      residencyStatus: 'Statut de Résidence',
      bloodType: 'Groupe Sanguin',
      "education": "Éducation",
      "degrees": "Diplômes",
      "academicRecords": "Dossiers Académiques"
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
      nationality: 'Entrez votre nationalité',
      searchDisciplines: "Rechercher des disciplines...",
      selectDiscipline: "Sélectionner une discipline",
      searchDegrees: "Rechercher des diplômes...",
      selectDegree: "Sélectionner un diplôme"
    },

    noMatchingDegrees: "Aucun diplôme correspondant trouvé",
    degreeOptions: [
      "Diplôme d'associé",
      "Licence en lettres (BA)",
      "Licence en sciences (BS)",
      "Licence en ingénierie (BEng)",
      "Licence en administration des affaires (BBA)",
      "Licence en beaux-arts (BFA)",
      "Licence en éducation (BEd)",
      "Licence en médecine (MBBS)",
      "Licence en droit (LLB)",
      "Master en lettres (MA)",
      "Master en sciences (MS)",
      "Master en administration des affaires (MBA)",
      "Master en ingénierie (MEng)",
      "Master en beaux-arts (MFA)",
      "Master en éducation (MEd)",
      "Master en droit (LLM)",
      "Master en santé publique (MPH)",
      "Doctorat en philosophie (PhD)",
      "Doctorat en médecine (MD)",
      "Doctorat en éducation (EdD)",
      "Doctorat en administration des affaires (DBA)",
      "Doctorat en jurisprudence (JD)",
      "Diplôme professionnel",
      "Diplôme technique",
      "Certificat professionnel",
      "Certificat d'études supérieures",
      "Diplôme post-universitaire",
      "Post-doctoral"
    ],
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
    existingFile: 'Fichier existant',
    noMatchingDisciplines: "Aucune discipline correspondante trouvée",
    educationOptions: [
      "Comptabilité",
      "Ingénierie aérospatiale",
      "Sciences agricoles",
      "Anthropologie",
      "Architecture",
      "Histoire de l'art",
      "Intelligence artificielle",
      "Astronomie",
      "Astrophysique",
      "Biochimie",
      "Ingénierie biomédicale",
      "Biotechnologie",
      "Administration des affaires",
      "Génie chimique",
      "Chimie",
      "Génie civil",
      "Communications",
      "Génie informatique",
      "Informatique",
      "Gestion de la construction",
      "Justice pénale",
      "Cybersécurité",
      "Science des données",
      "Dentisterie",
      "Économie",
      "Éducation",
      "Génie électrique",
      "Éducation primaire",
      "Littérature anglaise",
      "Génie environnemental",
      "Sciences environnementales",
      "Design de mode",
      "Études cinématographiques",
      "Finance",
      "Beaux-arts",
      "Science alimentaire",
      "Science forensique",
      "Conception de jeux",
      "Géographie",
      "Géologie",
      "Design graphique",
      "Administration de la santé",
      "Histoire",
      "Gestion hôtelière",
      "Ressources humaines",
      "Design industriel",
      "Génie industriel",
      "Systèmes d'information",
      "Technologie de l'information",
      "Design d'intérieur",
      "Commerce international",
      "Relations internationales",
      "Journalisme",
      "Droit",
      "Bibliothéconomie",
      "Linguistique",
      "Gestion",
      "Marketing",
      "Science des matériaux",
      "Mathématiques",
      "Génie mécanique",
      "Études des médias",
      "Médecine",
      "Météorologie",
      "Microbiologie",
      "Musique",
      "Nanotechnologie",
      "Soins infirmiers",
      "Nutrition",
      "Ergothérapie",
      "Océanographie",
      "Génie pétrolier",
      "Pharmacie",
      "Philosophie",
      "Photographie",
      "Éducation physique",
      "Physiothérapie",
      "Physique",
      "Sciences politiques",
      "Psychologie",
      "Administration publique",
      "Santé publique",
      "Relations publiques",
      "Robotique",
      "Éducation secondaire",
      "Travail social",
      "Sociologie",
      "Génie logiciel",
      "Éducation spécialisée",
      "Gestion sportive",
      "Statistiques",
      "Génie des systèmes",
      "Arts du théâtre",
      "Tourisme",
      "Urbanisme",
      "Médecine vétérinaire",
      "Développement web",
      "Biologie de la faune",
      "Zoologie"
    ],
    confirmSaveTitle: "Enregistrer le profil",
    confirmSave: "Êtes-vous sûr de vouloir enregistrer ces modifications ?"
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
    justChat: "Simplement discuter",
    contextAdded: 'Contexte ajouté à votre requête',
    contextRemoved: 'Contexte supprimé de votre requête',
    sessionUpdated: 'Session mise à jour',
    newChatStarted: 'Nouvelle conversation démarrée',
    loadError: 'Impossible de charger l\'historique de conversation'
  },
  quickhelp: {
    applyForID: "Demander une pièce d'identité",
    payTaxes: "Payer des impôts",
    startBusiness: "Créer une entreprise",
    findHealthcare: "Trouver des soins de santé",
    educationServices: "Services d'éducation",
    transportLicenses: "Transport et permis",
    housingPrograms: "Programmes de logement",
    findJobs: "Trouver un emploi",
    justChat: "Simplement discuter",
    // Prompts as separate keys with a clear naming pattern
    justChatPrompt: "Je voudrais discuter des services gouvernementaux",
    applyForIDPrompt: "J'ai besoin d'informations sur la procédure de demande d'une carte d'identité nationale",
    payTaxesPrompt: "Quelle est la procédure pour payer mes impôts en ligne ?",
    startBusinessPrompt: "Guidez-moi à travers les étapes pour enregistrer une nouvelle entreprise",
    findHealthcarePrompt: "Où puis-je trouver des informations sur les services de santé publique ?",
    educationServicesPrompt: "Quels services éducatifs sont disponibles pour mes enfants ?",
    transportLicensesPrompt: "Comment renouveler mon permis de conduire ?",
    housingProgramsPrompt: "Parlez-moi des programmes de logement abordable au Kenya",
    findJobsPrompt: "Quelles opportunités d'emploi gouvernementales sont actuellement disponibles ?"
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
    success: 'Merci pour votre avis !',
    error: 'Impossible de soumettre votre avis. Veuillez réessayer.'
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
