// src/i18n.js

import { createI18n } from 'vue-i18n'

const messages = {
  // ----------------------------------------------------------------
  // ENGLISH (complete)
  en: {
    brandName: 'Kenya eGovernment AI Services for Citizens',
    nav: {
      menu: 'Menu',
      analytics: 'Analytics',
      userProfile: 'User Profile'
    },
    sidebar: {
      governmentServices: 'Government Services',
      chatHistory: 'Chat History'
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
          'Driver’s licenses and vehicle registration',
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
      usageStats: 'Usage Stats',
      feedbackSamples: 'User Feedback Samples',
      close: 'Close'
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
        // Tab 1: Personal Identification
        fullName: 'Full name (including aliases)',
        dob: 'Date of birth',
        gender: 'Gender',
        nationality: 'Nationality',
        maritalStatus: 'Marital status',
        photograph: 'Photograph',
        biometric: 'Fingerprints / Biometric data',
        // Tab 2: Civil Registration
        birthCert: 'Birth certificate',
        deathCert: 'Death certificate',
        marriageDivorce: 'Marriage / Divorce records',
        adoption: 'Adoption records',
        citizenship: 'Citizenship / Naturalization documents',
        immigration: 'Immigration & visa history',
        // Tab 3: Address & Residency
        currentAddress: 'Current residential address',
        previousAddresses: 'Previous addresses',
        homeOrRental: 'Homeownership or rental details',
        utilityBills: 'Utility bills linked to the address',
        landRecords: 'Land and property ownership records',
        // Tab 4: Identity & Travel
        idCard: 'National ID card number',
        passport: 'Passport details',
        driversLicense: 'Driver’s license',
        voterId: 'Voter ID',
        ssn: 'Social Security / National Insurance Number',
        militaryRecords: 'Military service records',
        // Tab 5: Health & Medical
        medicalHistory: 'Medical history and health conditions',
        vaccinations: 'Vaccination records',
        insuranceDetails: 'Health insurance details',
        disability: 'Disability status',
        organDonor: 'Organ donor status',
        prescriptions: 'Prescriptions and treatments received',
        mentalHealth: 'Mental health history',
        // Tab 6: Employment & Economic
        eHistory: 'Employment history',
        currentEmployer: 'Current employer details',
        workPermits: 'Work permits and labor contracts',
        certifications: 'Professional certifications and licenses',
        unemployment: 'Unemployment status and benefits received',
        tin: 'Taxpayer identification number (TIN)',
        businessAffiliations: 'Business ownership and company affiliations',
        // Tab 7: Education & Academic
        schools: 'School and university attended',
        diplomas: 'Diplomas, degrees, and certifications',
        performance: 'Academic performance and test scores',
        scholarships: 'Scholarships and financial aid received',
        // Tab 8: Financial & Tax
        incomeTax: 'Income tax records',
        bankAccounts: 'Banking and financial accounts',
        propertyTax: 'Property tax payments',
        businessTax: 'Business tax filings',
        pensionContrib: 'Pension contributions and withdrawals',
        loanAid: 'Loan and government aid records',
        // Tab 9: Social Security & Welfare
        pensionStatus: 'Pension status and contributions',
        childcare: 'Childcare support',
        foodAssistance: 'Food assistance / welfare programs',
        housingAssistance: 'Housing assistance',
        // We also had "unemployment" & "disability" but those appear in other tabs, so it’s optional if repeated
        // Tab 10: Criminal & Legal
        policeRecords: 'Police records (criminal history, arrests, charges)',
        courtCases: 'Court case history',
        finesPenalties: 'Fines and penalties',
        paroleProbation: 'Parole or probation status',
        citizenshipRevocation: 'Citizenship revocation (if applicable)',
        // Tab 11: Transportation & Mobility
        vehicleReg: 'Vehicle registration details',
        trafficViolations: 'Traffic violations and fines',
        licenseHistory: 'Driving license history and endorsements',
        publicTransportCard: 'Public transport card usage',
        // Tab 12: Civic & Political
        voterRegistration: 'Voter registration details',
        electionHistory: 'Election participation history',
        partyMembership: 'Political party membership',
        militaryStatus: 'Military service or conscription status',
        publicServiceRoles: 'Public service roles'
      },
      actions: {
        cancel: 'Cancel',
        save: 'Save Profile'
      }
    },
    chatbot: {
      placeholder: 'Type your query here...',
      sendButton: 'Send',
      fileReceived: 'File received successfully.',
      fileUploadError: 'Error uploading file.',
      processingError: 'Error processing your request.'
    }
  },

  // ----------------------------------------------------------------
  // FRENCH (complete, approximate)
  fr: {
    brandName: 'Services IA du eGouvernement du Kenya pour les Citoyens',
    nav: {
      menu: 'Menu',
      analytics: 'Analytique',
      userProfile: 'Profil Utilisateur'
    },
    sidebar: {
      governmentServices: 'Services gouvernementaux',
      chatHistory: 'Historique de conversation'
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
          'Ressources d’apprentissage en ligne'
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
          'Police et services d’urgence',
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
          "Services d’eau et d’électricité",
          'Gestion des déchets et recyclage',
          'Réglementations environnementales',
          'Initiatives d’énergie renouvelable'
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
          'Retour d’information et plaintes des citoyens',
          'Bénévolat et programmes communautaires',
          'Participation au gouvernement local'
        ]
      }
    },
    analytics: {
      title: 'Analyses & Informations',
      note: 'Voici des statistiques d’utilisation et des retours utilisateurs.',
      usageStats: 'Statistiques d’utilisation',
      feedbackSamples: 'Exemples de commentaires',
      close: 'Fermer'
    },
    userProfile: {
      title: 'Profil Utilisateur',
      privacyInfo:
        "En fournissant plus d’informations, vous obtiendrez des réponses plus précises. Veuillez consulter notre",
      privacyPolicyLink: 'Politique de Confidentialité',
      tabs: {
        tab1: '1. Données d’identification personnelle',
        tab2: '2. Enregistrement civil & Documentation',
        tab3: '3. Adresse & Résidence',
        tab4: '4. Documents d’identité & Voyage',
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
        marriageDivorce: 'Documents de mariage / divorce',
        adoption: 'Documents d’adoption',
        citizenship: 'Citoyenneté / Naturalisation',
        immigration: 'Historique d’immigration & visas',
        // Tab 3
        currentAddress: 'Adresse de résidence actuelle',
        previousAddresses: 'Adresses précédentes',
        homeOrRental: 'Détails de propriété ou location',
        utilityBills: 'Factures de services publics',
        landRecords: 'Documents de propriété foncière',
        // Tab 4
        idCard: 'Numéro de carte d’identité nationale',
        passport: 'Détails du passeport',
        driversLicense: 'Permis de conduire',
        voterId: 'Carte d’électeur',
        ssn: 'Numéro de Sécurité Sociale',
        militaryRecords: 'Documents de service militaire',
        // Tab 5
        medicalHistory: 'Antécédents médicaux',
        vaccinations: 'Carnet de vaccination',
        insuranceDetails: 'Détails de l’assurance maladie',
        disability: 'Statut d’invalidité',
        organDonor: 'Statut de donneur d’organes',
        prescriptions: 'Ordonnances et traitements reçus',
        mentalHealth: 'Antécédents de santé mentale',
        // Tab 6
        eHistory: 'Historique d’emploi',
        currentEmployer: 'Détails de l’employeur actuel',
        workPermits: 'Permis de travail et contrats',
        certifications: 'Certifications & licences professionnelles',
        unemployment: 'Statut de chômage et allocations',
        tin: 'Numéro d’identification fiscale (TIN)',
        businessAffiliations: 'Possession d’entreprise & affiliations',
        // Tab 7
        schools: 'Écoles & universités fréquentées',
        diplomas: 'Diplômes, grades & certifications',
        performance: 'Performance académique & résultats',
        scholarships: 'Bourses & aides financières',
        // Tab 8
        incomeTax: 'Dossiers d’impôts sur le revenu',
        bankAccounts: 'Comptes bancaires & financiers',
        propertyTax: 'Paiements de taxes foncières',
        businessTax: 'Déclarations fiscales d’entreprise',
        pensionContrib: 'Contributions & retraits de pension',
        loanAid: 'Prêts & aides gouvernementales',
        // Tab 9
        pensionStatus: 'Statut de pension & contributions',
        childcare: 'Soutien à la garde d’enfants',
        foodAssistance: 'Aide alimentaire / programmes sociaux',
        housingAssistance: 'Aide au logement',
        // Tab 10
        policeRecords: 'Casier policier (antécédents, arrestations)',
        courtCases: 'Historique des affaires judiciaires',
        finesPenalties: 'Amendes et pénalités',
        paroleProbation: 'Libération conditionnelle ou probation',
        citizenshipRevocation: 'Révocation de citoyenneté (si applicable)',
        // Tab 11
        vehicleReg: 'Détails d’immatriculation de véhicule',
        trafficViolations: 'Infractions routières & amendes',
        licenseHistory: 'Historique du permis de conduire',
        publicTransportCard: 'Utilisation de la carte de transport public',
        // Tab 12
        voterRegistration: 'Détails d’inscription électorale',
        electionHistory: 'Historique de participation électorale',
        partyMembership: 'Adhésion à un parti politique',
        militaryStatus: 'Statut de service ou conscription',
        publicServiceRoles: 'Rôles de service public'
      },
      actions: {
        cancel: 'Annuler',
        save: 'Enregistrer'
      }
    },
    chatbot: {
      placeholder: 'Tapez votre requête ici...',
      sendButton: 'Envoyer',
      fileReceived: 'Fichier reçu avec succès.',
      fileUploadError: 'Erreur lors du téléversement du fichier.',
      processingError: 'Erreur lors du traitement de votre demande.'
    }
  },

  // ----------------------------------------------------------------
  // SWAHILI (complete, approximate)
  sw: {
    brandName: 'Huduma za Kenya eGovernment AI kwa Wananchi',
    nav: {
      menu: 'Menyu',
      analytics: 'Takwimu',
      userProfile: 'Profaili'
    },
    sidebar: {
      governmentServices: 'Huduma za Serikali',
      chatHistory: 'Historia ya Gumzo'
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
      title: 'Takwimu & Maarifa',
      note: 'Hapa kuna takwimu za utumiaji na maoni ya watumiaji.',
      usageStats: 'Takwimu za Matumizi',
      feedbackSamples: 'Mifano ya Maoni ya Watumiaji',
      close: 'Funga'
    },
    userProfile: {
      title: 'Profaili ya Mtumiaji',
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
        fullName: 'Jina kamili (pamoja na majina mengine)',
        dob: 'Tarehe ya kuzaliwa',
        gender: 'Jinsia',
        nationality: 'Uraia',
        maritalStatus: 'Hali ya ndoa',
        photograph: 'Picha',
        biometric: 'Data ya kibayometriki',
        // Tab 2
        birthCert: 'Cheti cha kuzaliwa',
        deathCert: 'Cheti cha kifo',
        marriageDivorce: 'Nyaraka za ndoa / talaka',
        adoption: 'Nyaraka za kuasili',
        citizenship: 'Uraia / Hati za Uraia',
        immigration: 'Historia ya uhamiaji & visa',
        // Tab 3
        currentAddress: 'Anwani ya makazi ya sasa',
        previousAddresses: 'Anwani za awali',
        homeOrRental: 'Umiliki wa nyumba au kukodisha',
        utilityBills: 'Ankara za huduma (maji, umeme)',
        landRecords: 'Rekodi za ardhi na mali',
        // Tab 4
        idCard: 'Namba ya kitambulisho cha taifa',
        passport: 'Maelezo ya pasipoti',
        driversLicense: 'Leseni ya udereva',
        voterId: 'Kitambulisho cha mpiga kura',
        ssn: 'Namba ya Hifadhi ya Jamii',
        militaryRecords: 'Rekodi za huduma ya kijeshi',
        // Tab 5
        medicalHistory: 'Historia ya matibabu na hali ya afya',
        vaccinations: 'Rekodi za chanjo',
        insuranceDetails: 'Maelezo ya bima ya afya',
        disability: 'Hali ya ulemavu',
        organDonor: 'Hali ya utoaji viungo',
        prescriptions: 'Prescriptions na matibabu uliyopokea',
        mentalHealth: 'Historia ya afya ya akili',
        // Tab 6
        eHistory: 'Historia ya ajira',
        currentEmployer: 'Maelezo ya mwajiri wa sasa',
        workPermits: 'Vibali vya kazi na mikataba',
        certifications: 'Vyeti na leseni za kitaaluma',
        unemployment: 'Hali ya ukosefu wa ajira na malipo',
        tin: 'Namba ya utambulisho wa mlipa kodi (TIN)',
        businessAffiliations: 'Umiliki wa biashara na uhusiano',
        // Tab 7
        schools: 'Shule na vyuo ulivyohudhuria',
        diplomas: 'Diploma, shahada, na vyeti',
        performance: 'Matokeo ya kitaaluma na mitihani',
        scholarships: 'Misaada na ufadhili wa wanafunzi',
        // Tab 8
        incomeTax: 'Rekodi za kodi ya mapato',
        bankAccounts: 'Akaunti za benki na fedha',
        propertyTax: 'Malipo ya kodi ya mali',
        businessTax: 'Uwasilishaji wa kodi za biashara',
        pensionContrib: 'Michango na uondoaji wa pensheni',
        loanAid: 'Rekodi za mikopo na misaada ya serikali',
        // Tab 9
        pensionStatus: 'Hali ya pensheni na michango',
        childcare: 'Msaada wa kulea watoto',
        foodAssistance: 'Msaada wa chakula / ustawi',
        housingAssistance: 'Msaada wa makazi',
        // Tab 10
        policeRecords: 'Rekodi za polisi (historia ya jinai, kukamatwa)',
        courtCases: 'Historia ya kesi mahakamani',
        finesPenalties: 'Faini na adhabu',
        paroleProbation: 'Parole au probation',
        citizenshipRevocation: 'Kufutwa kwa uraia (kama inafaa)',
        // Tab 11
        vehicleReg: 'Maelezo ya usajili wa gari',
        trafficViolations: 'Makosa ya trafiki na faini',
        licenseHistory: 'Historia ya leseni ya udereva',
        publicTransportCard: 'Matumizi ya kadi ya usafiri wa umma',
        // Tab 12
        voterRegistration: 'Maelezo ya usajili wa wapiga kura',
        electionHistory: 'Historia ya ushiriki katika uchaguzi',
        partyMembership: 'Uanachama wa chama cha siasa',
        militaryStatus: 'Hali ya huduma ya kijeshi au ulazima',
        publicServiceRoles: 'Nafasi katika huduma ya umma'
      },
      actions: {
        cancel: 'Ghairi',
        save: 'Hifadhi Profaili'
      }
    },
    chatbot: {
      placeholder: 'Andika swali lako hapa...',
      sendButton: 'Tuma',
      fileReceived: 'Faili imepokelewa.',
      fileUploadError: 'Hitilafu katika kupakia faili.',
      processingError: 'Hitilafu katika kushughulikia ombi lako.'
    }
  }
}

export default createI18n({
  // If you want Swahili by default, set this to 'sw'; otherwise 'en'.
  locale: 'sw',
  fallbackLocale: 'en',
  messages
})

