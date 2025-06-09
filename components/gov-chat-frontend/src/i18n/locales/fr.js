// src/i18n/locales/fr.js

export default {
  countries: {
    'AF': 'Afghanistan',
    'DZ': 'Algérie',
    'AO': 'Angola',
    'AR': 'Argentine',
    'AU': 'Australie',
    'AT': 'Autriche',
    'BD': 'Bangladesh',
    'BE': 'Belgique',
    'BR': 'Brésil',
    'CM': 'Cameroun',
    'CA': 'Canada',
    'CL': 'Chili',
    'CN': 'Chine',
    'CO': 'Colombie',
    'CD': 'République démocratique du Congo',
    'DK': 'Danemark',
    'EG': 'Égypte',
    'ET': 'Éthiopie',
    'FI': 'Finlande',
    'FR': 'France',
    'DE': 'Allemagne',
    'GH': 'Ghana',
    'IN': 'Inde',
    'ID': 'Indonésie',
    'IR': 'Iran',
    'IQ': 'Irak',
    'IE': 'Irlande',
    'IL': 'Israël',
    'IT': 'Italie',
    'JP': 'Japon',
    'JO': 'Jordanie',
    'KE': 'Kenya',
    'KW': 'Koweït',
    'LB': 'Liban',
    'MG': 'Madagascar',
    'MY': 'Malaisie',
    'MX': 'Mexique',
    'MA': 'Maroc',
    'MZ': 'Mozambique',
    'NL': 'Pays-Bas',
    'NZ': 'Nouvelle-Zélande',
    'NG': 'Nigeria',
    'NO': 'Norvège',
    'PK': 'Pakistan',
    'PS': 'Palestine',
    'PE': 'Pérou',
    'PH': 'Philippines',
    'PL': 'Pologne',
    'PT': 'Portugal',
    'QA': 'Qatar',
    'RO': 'Roumanie',
    'RU': 'Russie',
    'SA': 'Arabie Saoudite',
    'SN': 'Sénégal',
    'SG': 'Singapour',
    'ZA': 'Afrique du Sud',
    'ES': 'Espagne',
    'SD': 'Soudan',
    'SE': 'Suède',
    'CH': 'Suisse',
    'SY': 'Syrie',
    'TZ': 'Tanzanie',
    'TH': 'Thaïlande',
    'TN': 'Tunisie',
    'TR': 'Turquie',
    'UG': 'Ouganda',
    'UA': 'Ukraine',
    'AE': 'Émirats Arabes Unis',
    'GB': 'Royaume-Uni',
    'US': 'États-Unis',
    'VE': 'Venezuela',
    'VN': 'Vietnam',
    'YE': 'Yémen',
    'ZM': 'Zambie',
    'ZW': 'Zimbabwe'
  },
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
      warn: 'AVERTISSEMENT',
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
      },
      monthlyActiveUsers: 'Utilisateurs Actifs Mensuels (UAM)',
      searchUsers: 'Rechercher des utilisateurs...',
      clearSearch: 'Effacer la recherche',
      search: 'Rechercher',
      usersFound: 'utilisateurs trouvés',
      showAllUsers: 'Afficher tous les utilisateurs',
      searching: 'Recherche en cours...',
      searchingUsers: 'Recherche d\'utilisateurs en cours...',
      noUsersFound: 'Aucun utilisateur trouvé correspondant à vos critères de recherche.',
      noUsers: 'Aucun utilisateur disponible.',
      showing: 'Affichage de',
      of: 'sur',
      previous: 'Précédent',
      next: 'Suivant',
      runningSecurityScan: 'Analyse en cours...',
      securityRecommendations: 'Recommandations de sécurité',
      totalUsers: 'Total des utilisateurs',
      newUsers: 'Nouveaux utilisateurs (Mois)',
      today: 'Aujourd\'hui',
      errorLogs: 'Journaux d\'erreurs',
      warningLogs: 'Journaux d\'avertissements',
      noErrorLogs: 'Aucun journal d\'erreur enregistré aujourd\'hui.',
      noWarningLogs: 'Aucun journal d\'avertissement enregistré aujourd\'hui.',
      infoLogsNote: 'Les journaux d\'information ne sont pas affichés dans le résumé. Utilisez la fonction de recherche pour voir tous les types de journaux.',
      searchResults: 'Derniers résultats de recherche',
      entriesFound: 'entrées trouvées',
      viewAllResults: 'Voir tous les résultats',
      logType: 'Type',
      logCount: 'Nombre',
      
      // Log types
      logTypes: {
        connectionTimeout: 'Délai de connexion dépassé',
        databaseFailed: 'Échec de requête de base de données',
        authFailed: 'Échec d\'authentification',
        lowDiskSpace: 'Espace disque en dessous du seuil',
        slowQuery: 'Performance lente de requête',
        rateLimit: 'Limite de taux proche'
      },
      
      // Security section
      security: {
        criticalVulnerabilities: 'Vulnérabilités critiques',
        authenticationIssues: 'Problèmes d\'authentification',
        occurrences: 'Occurrences',
        firstSeen: 'Première apparition',
        lastSeen: 'Dernière apparition',
        timestamp: 'Horodatage',
        message: 'Message',
        service: 'Service',
        showLess: 'Afficher moins',
        showMore: 'Afficher tous les problèmes d\'authentification',
        recommendedAction: 'Action recommandée',
        noVulnerabilitiesFound: 'Aucune vulnérabilité trouvée',
        systemSecure: 'Votre système semble être sécurisé. Continuez à le surveiller régulièrement.'
      },
      
      // Search fields
      searchFields: {
        all: 'Tous les champs',
        name: 'Nom',
        email: 'Email',
        role: 'Rôle'
      },
      
      // User search
      userSearch: {
        resultsFound: 'Trouvé {total} utilisateurs correspondant à "{term}"',
        error: 'Erreur lors de la recherche d\'utilisateurs'
      },
      
      logSearch: {
        noResultsFound: 'Aucun journal ne correspond à vos critères de recherche',
        resultsFound: 'Trouvé {count} entrées de journal'
      }
    },
    userEdit: {
      title: 'Modifier l\'Utilisateur',
      loading: 'Chargement des données utilisateur...',
      userInfo: 'Informations de l\'Utilisateur',
      userId: 'ID Utilisateur',
      loginName: 'Nom d\'Utilisateur',
      fullName: 'Nom Complet',
      dob: 'Date de Naissance',
      email: 'E-mail',
      emailVerified: 'E-mail Vérifié',
      verified: 'Vérifié',
      notVerified: 'Non Vérifié',
      createdAt: 'Créé le',
      lastLogin: 'Dernière Connexion',
      never: 'Jamais',
      accountSettings: 'Paramètres du Compte',
      accountStatus: 'Statut du Compte',
      accountEnabled: 'Compte Activé',
      cannotDisableSelf: 'Vous ne pouvez pas désactiver votre propre compte',
      accountRole: 'Rôle du Compte',
      adminRole: 'Rôle Administrateur',
      cannotChangeOwnRole: 'Vous ne pouvez pas modifier votre propre rôle',
      adminActions: 'Actions d\'Administration',
      verifyEmail: 'Vérifier l\'E-mail',
      resetPassword: 'Envoyer Réinitialisation de Mot de Passe',
      forceLogout: 'Forcer la Déconnexion',
      failedToLoad: 'Échec du chargement des données utilisateur',
      errorLoading: 'Erreur lors du chargement des données utilisateur',
      saveSuccess: 'Paramètres utilisateur mis à jour avec succès',
      errorSaving: 'Erreur lors de l\'enregistrement des paramètres utilisateur',
      verifyEmailSuccess: 'E-mail de vérification envoyé avec succès',
      emailVerificationFailed: 'Échec de l\'envoi de l\'e-mail de vérification',
      errorVerifyingEmail: 'Erreur lors de l\'envoi de l\'e-mail de vérification',
      passwordResetSent: 'E-mail de réinitialisation de mot de passe envoyé',
      passwordResetFailed: 'Échec de l\'envoi de la réinitialisation du mot de passe',
      errorSendingReset: 'Erreur lors de l\'envoi de la réinitialisation du mot de passe',
      logoutForced: 'L\'utilisateur a été déconnecté',
      logoutFailed: 'Échec de la déconnexion forcée',
      errorForcingLogout: 'Erreur lors de la déconnexion forcée'
    },
    operations: {
      cancel: 'Annuler',
      save: 'Enregistrer les Modifications'
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

    charts: {
      satisfactionHeatmap: "Satisfaction par domaine de connaissance",
      satisfactionSubtitle: "Pourcentages au fil du temps"
    },

    timePeriods: {
      week4: "Il y a 4 semaines",
      week3: "Il y a 3 semaines",
      week2: "Il y a 2 semaines",
      week1: "Semaine dernière",
      current: "Actuel"
    },
    
    errors: {
      loading: "Échec du chargement des données de satisfaction. Veuillez réessayer.",
    },
    
    status: {
      loading: "Chargement...",
      noData: "Aucune donnée disponible"
    },

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
    gauge: {
      historical: 'Tendances historiques',
      vsPrevious: 'par rapport à la période précédente',
      target: 'Cible'
    },
    ratings: {
      poor: "Faible",
      average: "Moyen",
      good: "Bon", 
      excellent: "Excellent"
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
    satisfactionRate: 'Taux de Satisfaction',
    satisfactionAnalysis: 'Analyse de Satisfaction des Utilisateurs'
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
    administration: "Administration",
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
    faq: 'Questions fréquemment posées',
    tab: {
      all: 'Tous',
      folders: 'Dossiers',
      starred: 'Favoris',
      archived: 'Archivés'
    },
    savedChats: 'Conversations Enregistrées',
    folders: "Dossiers",
    allChats: "Toutes les Conversations",
    noFolder: "Tous les chats",
    starredChats: "Favorites",
    archivedChats: "Archivées",
    emptyFolder: "Ce dossier est vide. Déplacez les conversations ici depuis le menu de conversation.",
    noStarredChats: "Pas encore de conversations favorites. Marquez une conversation pour l'ajouter ici.",
    noArchivedChats: "Pas encore de conversations archivées.",
    noSearchResults: 'Aucune conversation trouvée pour "{term}"',
    loadingChats: "Chargement des conversations...",
    errorLoadingConversations: "Échec du chargement des conversations. Veuillez réessayer.",
    errorLoadingUser: "Les données utilisateur sont incomplètes. Veuillez recharger la page.",
    errorNoUser: "Les données utilisateur sont manquantes. Veuillez recharger la page.",
    retry: "Réessayer",
    message: "message",
    messages: "messages",
    created: "Créé",
    updated: "Mis à jour",
    star: "Favoris",
    unstar: "Retirer des favoris",
    archive: "Archiver",
    chatStarred: "La conversation a été ajoutée aux favoris",
    chatUnstarred: "La conversation a été retirée des favoris",
    chatArchived: "La conversation a été archivée",
    chatUnarchived: "La conversation a été désarchivée",
    errorUpdatingChat: "Échec de la mise à jour de la conversation",
    chatRenamed: "Conversation renommée avec succès",
    errorRenamingChat: "Échec du renommage de la conversation",
    chatDeleted: "Conversation supprimée avec succès",
    errorDeletingChat: "Échec de la suppression de la conversation",
    chatMoved: "Conversation déplacée avec succès",
    errorMovingChat: "Échec du déplacement de la conversation",
    noPreview: "Aucun aperçu disponible",
    searchConversations: 'Rechercher des conversations...'
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
      education: "Éducation",
      degrees: "Diplômes",
      academicRecords: "Dossiers Académiques",
      // Most of the core fields are already translated
      dateOfBirth: 'Date de Naissance',
      profilePhoto: 'Photo de Profil',
      phoneNumber: 'Numéro de Téléphone',
      emailAddress: 'Adresse Email',
      preferredLanguage: 'Langue Préférée',

      // Tab 2 - Civil Registration & Documentation
      // Some of these fields are already translated
      deathCertificate: 'Certificat de Décès',
      marriageRecords: 'Actes de Mariage',
      divorceRecords: 'Actes de Divorce',
      adoptionRecords: 'Documents d\'Adoption',
      citizenshipDocuments: 'Documents de Citoyenneté',
      naturalizationDocuments: 'Documents de Naturalisation',
      visaHistory: 'Historique des Visas',

      // Tab 3 - Address & Residency
      // Some of these fields are already translated
      previousAddresses: 'Adresses Précédentes',
      homeOwnership: 'Propriété du Domicile',
      rentalDetails: 'Détails de Location',
      utilityBills: 'Factures de Services Publics',
      propertyRecords: 'Registres de Propriété',
      residencyDuration: 'Durée de Résidence',

      // Tab 4 - Identity & Travel Documents
      // Some of these fields are already translated
      nationalIDNumber: 'Numéro de Carte d\'Identité Nationale',
      passportNumber: 'Numéro de Passeport',
      passportExpiry: 'Date d\'Expiration du Passeport',
      visaType: 'Type de Visa',
      visaNumber: 'Numéro de Visa',
      visaExpiry: 'Date d\'Expiration du Visa',

      // Tab 5 - Health & Medical Records
      medicalHistory: 'Antécédents Médicaux',
      vaccinations: 'Vaccinations',
      healthInsurance: 'Assurance Santé',
      bloodType: 'Groupe Sanguin',
      organDonor: 'Statut de Donneur d\'Organes',
      allergies: 'Allergies',
      currentMedications: 'Médicaments Actuels',
      chronicConditions: 'Conditions Chroniques',

      // Tab 6 - Employment & Economic Data
      // Some of these fields are already translated
      employmentStatus: 'Statut d\'Emploi',
      occupation: 'Profession',
      employerName: 'Nom de l\'Employeur',
      employerAddress: 'Adresse de l\'Employeur',
      employmentHistory: 'Historique d\'Emploi',
      annualIncome: 'Revenu Annuel',
      workPermitNumber: 'Numéro de Permis de Travail',
      workPermitExpiry: 'Date d\'Expiration du Permis de Travail',

      // Tab 7 - Education & Academic Records
      // Some of these fields are already translated
      highestEducation: 'Niveau d\'Éducation le Plus Élevé',
      institutionName: 'Nom de l\'Institution',
      graduationYear: 'Année d\'Obtention du Diplôme',
      fieldOfStudy: 'Domaine d\'Étude',
      additionalCertifications: 'Certifications Supplémentaires',
      languages: 'Langues Parlées',
      academicAchievements: 'Réalisations Académiques',

      // Tab 8 - Financial & Tax Data
      // Some of these fields are already translated
      accountNumber: 'Numéro de Compte',
      bankName: 'Nom de la Banque',
      financialAssets: 'Actifs Financiers',
      liabilities: 'Passifs',
      creditScore: 'Score de Crédit',
      taxIdentificationNumber: 'Numéro d\'Identification Fiscale',
      lastTaxReturn: 'Dernière Déclaration Fiscale',
      taxExemptions: 'Exonérations Fiscales'
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
    confirmSave: "Êtes-vous sûr de vouloir enregistrer ces modifications ?",
    placeholders: {
      searchCountries: 'Rechercher des pays...',
      selectCountry: 'Sélectionnez un pays'
    },
    noMatchingCountries: 'Aucun pays correspondant trouvé',
    fields: {
      nationality: 'Nationalité',
      country: 'Pays'
    },
    // Profile Icon Section
    profileIcon: 'Icône de Profil',
    change: 'Modifier',
    chooseProfileIcon: 'Choisir une Icône de Profil',
    presetIcons: 'Icônes Prédéfinies',
    upload: 'Télécharger',
    initials: 'Initiales',
    clickToUpload: 'Cliquer pour télécharger',
    useThisImage: 'Utiliser Cette Image',
    useInitials: 'Utiliser les Initiales',

    // Country Selection
    countryLoadError: 'Erreur lors du chargement des pays',
    countryUpdateError: 'Erreur lors de la mise à jour du pays',

    // Education Section
    searchResults: 'Résultats de Recherche',
    noResults: 'Aucun Résultat',
    searchingFor: 'Recherche de',

    // Loading States
    retryLoading: 'Réessayer',
    loadingProfile: 'Chargement du profil utilisateur...',
    savingProfile: 'Enregistrement du profil...',

    // Error Messages
    errors: {
      savingFailed: 'Échec de l\'enregistrement du profil',
      loadingFailed: 'Échec du chargement des données du profil',
      invalidForm: 'Veuillez remplir tous les champs obligatoires',
      invalidFileType: 'Type de fichier invalide',
      fileTooLarge: 'Le fichier est trop volumineux'
    },

    // Confirmation & Success
    tabComplete: 'Onglet complété!',
    confirmDiscardChanges: 'Abandonner les modifications non enregistrées?',
    // For consistency and completeness
    confirmLeave: 'Êtes-vous sûr de vouloir quitter? Les modifications non enregistrées seront perdues.',
    profileComplete: 'Profil complété avec succès',
    fieldUpdated: 'Champ mis à jour avec succès',
    nextSection: 'Section suivante',
    previousSection: 'Section précédente',
    uploadProgress: 'Progression du téléchargement: {percent}%',
    navigationWarning: 'Veuillez compléter cette section avant de continuer',

    // For form validation
    validation: {
      // Add to existing validation object
      requiredField: '{field} est requis',
      invalidFormat: 'Format invalide pour {field}',
      futureDate: 'La date ne peut pas être dans le futur',
      invalidSelection: 'Veuillez faire une sélection valide',
      passwordLength: 'Le mot de passe doit comporter au moins 8 caractères',
      matchError: 'Les champs ne correspondent pas'
    },

    // For accessibility
    aria: {
      tabList: 'Sections du formulaire de profil',
      nextButton: 'Aller à la section suivante',
      prevButton: 'Aller à la section précédente',
      closeButton: 'Fermer le formulaire de profil',
      saveButton: 'Enregistrer les données du profil',
      requiredField: 'Champ obligatoire',
      dropdownSelect: 'Sélectionner une option'
    },
    // Employment status options
    employmentStatuses: {
      employed: 'Employé',
      selfEmployed: 'Travailleur Indépendant',
      unemployed: 'Sans Emploi',
      student: 'Étudiant',
      retired: 'Retraité',
      homemaker: 'Au Foyer',
      other: 'Autre'
    },

    // Education level options
    educationLevels: {
      primary: 'Éducation Primaire',
      secondary: 'Éducation Secondaire',
      highSchool: 'Lycée',
      vocational: 'Formation Professionnelle',
      associate: 'Diplôme d\'Associé',
      bachelor: 'Licence',
      master: 'Master',
      doctoral: 'Doctorat',
      professional: 'Diplôme Professionnel',
      other: 'Autre'
    },

    // Language proficiency levels
    proficiencyLevels: {
      native: 'Langue Maternelle',
      fluent: 'Courant',
      advanced: 'Avancé',
      intermediate: 'Intermédiaire',
      basic: 'Notions de Base'
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
      unknown: 'Inconnu'
    },

    // Languages spoken
    languages: {
      english: 'Anglais',
      french: 'Français',
      swahili: 'Swahili',
      arabic: 'Arabe',
      spanish: 'Espagnol',
      portuguese: 'Portugais',
      chinese: 'Chinois',
      japanese: 'Japonais',
      german: 'Allemand',
      russian: 'Russe',
      hindi: 'Hindi',
      urdu: 'Ourdou',
      other: 'Autre'
    },
    // Notification messages
    notifications: {
      saveSuccess: 'Profil enregistré avec succès',
      saveFailed: 'Échec de l\'enregistrement du profil',
      loadSuccess: 'Profil chargé avec succès',
      loadFailed: 'Échec du chargement du profil',
      fieldRequired: 'Ce champ est obligatoire',
      uploadSuccess: 'Fichier téléchargé avec succès',
      uploadFailed: 'Échec du téléchargement du fichier',
      formChanged: 'Vous avez des modifications non enregistrées',
      sessionExpired: 'Votre session a expiré, veuillez vous reconnecter',
      profileUpdated: 'Votre profil a été mis à jour',
      profileIncomplete: 'Votre profil est incomplet'
    },

    // Form instructions and help text
    instructions: {
      fullNameHelp: 'Entrez votre nom complet légal tel qu\'il apparaît sur vos documents officiels',
      dobHelp: 'Entrez votre date de naissance au format JJ/MM/AAAA',
      uploadPhotoHelp: 'Téléchargez une photo récente. Le fichier doit être au format JPG, PNG ou GIF et inférieur à 2 Mo',
      passwordHelp: 'Le mot de passe doit comporter au moins 8 caractères avec une lettre majuscule, un chiffre et un caractère spécial',
      documentHelp: 'Formats acceptés : PDF, JPG, PNG (max 5 Mo)',
      requiredFields: 'Les champs marqués d\'un * sont obligatoires',
      selectFromList: 'Veuillez sélectionner une option dans la liste',
      nextTab: 'Continuer vers la section suivante',
      previousTab: 'Retourner à la section précédente',
      saveInstructions: 'Cliquez sur Enregistrer pour stocker vos informations',
      cancelInstructions: 'Cliquez sur Annuler pour abandonner les modifications'
    },

    // Section completion status
    completionStatus: {
      notStarted: 'Non Commencé',
      inProgress: 'En Cours',
      complete: 'Terminé',
      percentComplete: '{percent}% Complété',
      tabsCompleted: '{completed} sur {total} sections complétées'
    }
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
