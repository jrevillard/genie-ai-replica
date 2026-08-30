/**
 * seed-synthetic-data.js
 *
 * Generates synthetic data for frontend visual testing:
 *   - Knowledge: serviceCategories, services, categoryServices edges, translations
 *   - Chat: conversations, messages, userConversations edges
 *   - Analytics: events, analytics (aggregated)
 *   - Documents: files, labels
 *
 * Usage:
 *   node seed-synthetic-data.js              # insert all sections
 *   node seed-synthetic-data.js --knowledge   # knowledge only
 *   node seed-synthetic-data.js --chat        # chat only
 *   node seed-synthetic-data.js --analytics   # analytics only
 *   node seed-synthetic-data.js --documents   # documents only
 *   node seed-synthetic-data.js --dry-run     # print counts, do not insert
 *
 * Environment variables (from .env):
 *   ARANGO_URL, ARANGO_DB, ARANGO_USER, ARANGO_PASSWORD
 */

const { Database, aql } = require('arangojs');
const cryptoModule = require('crypto');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_CONFIG = {
  url: process.env.ARANGO_URL || 'http://localhost:8529',
  databaseName: process.env.ARANGO_DB || 'genie-ai',
  auth: {
    username: process.env.ARANGO_USER || 'root',
    password: process.env.ARANGO_PASSWORD || 'arangopwd'
  }
};

const PARSE_ARGS = () => {
  const args = process.argv.slice(2);
  return {
    knowledge: args.includes('--knowledge') || args.length === 0,
    chat: args.includes('--chat') || args.length === 0,
    analytics: args.includes('--analytics') || args.length === 0,
    documents: args.includes('--documents') || args.length === 0,
    dryRun: args.includes('--dry-run')
  };
};

// ---------------------------------------------------------------------------
// Synthetic data generators
// ---------------------------------------------------------------------------

const NOW = new Date();
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();

// --- Knowledge ---

const CATEGORIES = [
  {
    nameEN: 'Healthcare & Social Services',
    nameFR: 'Santé et Services Sociaux',
    nameSW: 'Afya na Huduma za Jamii',
    catCode: 'HEALTH',
    services: [
      'Find a Doctor',
      'Book a Hospital Appointment',
      'Apply for Social Assistance',
      'Health Insurance Enrollment',
      'Mental Health Support',
      'Vaccination Records'
    ]
  },
  {
    nameEN: 'Education & Training',
    nameFR: 'Éducation et Formation',
    nameSW: 'Elimu na Mafunzo',
    catCode: 'EDU',
    services: [
      'School Enrollment',
      'University Admissions',
      'Scholarship Applications',
      'Adult Literacy Programs',
      'Vocational Training',
      'Student Loan Information'
    ]
  },
  {
    nameEN: 'Civil Registration & Identity',
    nameFR: 'État Civil et Identité',
    nameSW: 'Usajili wa Raia na Utambulisho',
    catCode: 'CIVIL',
    services: [
      'Birth Certificate',
      'National ID Card',
      'Passport Application',
      'Marriage Registration',
      'Death Certificate',
      'Change of Address'
    ]
  },
  {
    nameEN: 'Tax & Revenue',
    nameFR: 'Impôts et Revenus',
    nameSW: 'Ushuru na Mapato',
    catCode: 'TAX',
    services: [
      'Income Tax Filing',
      'Property Tax Payment',
      'Business Registration',
      'Tax Certificate Request',
      'VAT Registration',
      'Customs Declaration'
    ]
  },
  {
    nameEN: 'Justice & Legal Affairs',
    nameFR: 'Justice et Affaires Légales',
    nameSW: 'Haki na Masuala ya Kisheria',
    catCode: 'JUST',
    services: [
      'Court Case Status',
      'Legal Aid Application',
      'Notary Services',
      'File a Complaint',
      'Criminal Record Check',
      'Land Dispute Resolution'
    ]
  },
  {
    nameEN: 'Transport & Infrastructure',
    nameFR: 'Transport et Infrastructure',
    nameSW: 'Usafiri na Miundombinu',
    catCode: 'TRANS',
    services: [
      'Driver License Renewal',
      'Vehicle Registration',
      'Public Transit Pass',
      'Road Condition Reports',
      'Building Permits',
      'Utility Connections'
    ]
  },
  {
    nameEN: 'Environment & Agriculture',
    nameFR: 'Environnement et Agriculture',
    nameSW: 'Mazingira na Kilimo',
    catCode: 'ENV',
    services: [
      'Environmental Permits',
      'Waste Management',
      'Water Quality Reports',
      'Agricultural Subsidies',
      'Fishing Licenses',
      'Forestry Permits'
    ]
  },
  {
    nameEN: 'Employment & Labor',
    nameFR: 'Emploi et Travail',
    nameSW: 'Kazi na Ajira',
    catCode: 'LABOR',
    services: [
      'Job Search Portal',
      'Unemployment Benefits',
      'Work Permit Application',
      'Labor Rights Information',
      'Workplace Safety Report',
      'Pension Information'
    ]
  }
];

// --- Chat conversations (realistic public-sector Q&A) ---

const CONVERSATIONS = [
  {
    title: 'How to apply for a national ID card',
    category: 'Civil Registration & Identity',
    tags: ['identity', 'documentation'],
    messages: [
      {
        sender: 'user',
        content:
          'I recently moved to the country and need to get a national ID card. What documents do I need to prepare?'
      },
      {
        sender: 'assistant',
        content:
          'To apply for a national ID card, you will need the following documents:\n\n1. **Valid passport** or travel document\n2. **Proof of residence** (utility bill or rental agreement)\n3. **Birth certificate** (original or certified copy)\n4. **Two passport-sized photos** (taken within the last 6 months)\n5. **Completed application form** (available at any civil registration office or online)\n\nYou can schedule an appointment at your nearest civil registration office through our online portal or by calling the helpline.'
      },
      { sender: 'user', content: 'How long does the process take? And is there a fee?' },
      {
        sender: 'assistant',
        content:
          'The standard processing time is **5-10 business days** for first-time applicants. There is an expedited service available for an additional fee that reduces this to 2-3 business days.\n\n**Standard fee:** 500 local currency units\n**Expedited fee:** 1,200 local currency units\n\nPayment can be made at the registration office (cash or card) or online via the government payment portal.'
      },
      { sender: 'user', content: 'Can I track my application status online?' },
      {
        sender: 'assistant',
        content:
          'Yes, you can track your application status online. After submitting your application, you will receive a **reference number**. Use this number on the civil registration portal under "Track Application" to see real-time status updates.\n\nYou will also receive SMS notifications at each stage: received, under review, approved, and ready for collection.'
      }
    ]
  },
  {
    title: 'School enrollment procedures for my children',
    category: 'Education & Training',
    tags: ['education', 'enrollment'],
    messages: [
      {
        sender: 'user',
        content: 'I have two children, ages 6 and 11. We just relocated. How do I enroll them in public schools?'
      },
      {
        sender: 'assistant',
        content:
          "Welcome! Here is the enrollment process for public schools:\n\n**For your 6-year-old (Primary School):**\n- Visit your local primary school with the child's birth certificate\n- Provide proof of residence in the school district\n- Complete the enrollment form\n- The school will assign a class within 3 business days\n\n**For your 11-year-old (Secondary School):**\n- Same documents as above, plus the child's most recent school report/transcript\n- Placement may involve a brief assessment test\n\n**Key dates:** The main enrollment period runs from January 15 to March 30 for the following academic year. Late enrollment is possible but subject to available spaces."
      },
      { sender: 'user', content: 'Are there any scholarship programs we should know about?' },
      {
        sender: 'assistant',
        content:
          "Yes, several programs are available:\n\n1. **Merit-Based Scholarships** — For students with excellent academic records (covers tuition + supplies)\n2. **Need-Based Financial Aid** — Income-tested, covers partial to full tuition\n3. **Community Scholarships** — Offered by local organizations and NGOs\n\nApplications for financial aid are typically due by April 30. You can apply through the Ministry of Education's online portal."
      }
    ]
  },
  {
    title: 'Tax filing deadline and procedures',
    category: 'Tax & Revenue',
    tags: ['tax', 'filing', 'deadline'],
    messages: [
      { sender: 'user', content: 'When is the income tax filing deadline for this year? I am a salaried employee.' },
      {
        sender: 'assistant',
        content:
          'The income tax filing deadline for salaried employees is **June 30th** of each year.\n\nAs a salaried employee, your employer likely withholds tax monthly (PAYE). However, you still need to file an annual return to:\n- Claim any eligible deductions\n- Report additional income sources\n- Receive a refund if you were over-taxed\n\nYou can file online through the Tax Portal or visit any tax office for assistance.'
      },
      { sender: 'user', content: 'What deductions can I claim?' },
      {
        sender: 'assistant',
        content:
          'Common deductions for salaried employees include:\n\n- **Mortgage interest** (up to a cap of 15,000 per year)\n- **Medical expenses** (exceeding 5% of gross income)\n- **Education expenses** for yourself or dependents\n- **Charitable donations** to registered organizations (up to 10% of taxable income)\n- **Retirement contributions** to approved pension schemes\n\nKeep all receipts and supporting documents for at least 5 years in case of an audit.'
      },
      { sender: 'user', content: 'What happens if I file late?' },
      {
        sender: 'assistant',
        content:
          'Late filing penalties are structured as follows:\n\n- **1-30 days late:** 5% surcharge on outstanding tax\n- **31-90 days late:** 10% surcharge\n- **Over 90 days late:** 20% surcharge + possible legal action\n\nInterest accrues monthly at the rate of 1.5% on any unpaid balance. If you cannot meet the deadline, you can request an extension (up to 3 months) by submitting Form EXT-01 before June 30th.'
      }
    ]
  },
  {
    title: 'Driver license renewal process',
    category: 'Transport & Infrastructure',
    tags: ['license', 'renewal', 'transport'],
    messages: [
      { sender: 'user', content: 'My driver license expires next month. How do I renew it?' },
      {
        sender: 'assistant',
        content:
          'You can renew your driver license through any of these channels:\n\n**Online (recommended):**\n1. Log into the Transport Portal with your national ID\n2. Navigate to "License Services" → "Renew License"\n3. Upload a recent photo and pay the renewal fee\n4. Your new license will be mailed within 5-7 business days\n\n**In-person:**\nVisit any licensing office with your expiring license, national ID, and one passport photo. Renewal is processed same-day.\n\n**Renewal fee:** 350 local currency units\n**Validity:** 5 years (standard) or 10 years (premium option at 600)'
      },
      { sender: 'user', content: 'Do I need to take a driving test again?' },
      {
        sender: 'assistant',
        content:
          'No, you do not need to retake the driving test for a standard renewal. However:\n\n- If your license has been **expired for more than 2 years**, you will need to pass a practical driving test\n- If you have any **medical conditions** that may affect driving, a medical certificate is required\n- For **senior drivers (65+)**, an annual medical fitness certificate is mandatory\n\nThe online renewal system will automatically flag if any additional requirements apply to your case.'
      }
    ]
  },
  {
    title: 'How to file a workplace safety complaint',
    category: 'Employment & Labor',
    tags: ['labor', 'safety', 'complaint'],
    messages: [
      {
        sender: 'user',
        content:
          'My workplace has unsafe conditions and my employer is not addressing them. How can I file a formal complaint?'
      },
      {
        sender: 'assistant',
        content:
          'You have the right to a safe workplace. Here is how to file a complaint:\n\n**Option 1: Online Portal**\nVisit the Labor Inspectorate website and submit Form WS-COMP with details of the hazard.\n\n**Option 2: Phone Hotline**\nCall the Workplace Safety Hotline at the number listed on the Labor Ministry website (available Mon-Fri, 8am-5pm).\n\n**Option 3: In-person**\nVisit your nearest Labor Inspectorate office. Walk-ins are accepted.\n\n**Your complaint will be treated confidentially.** By law, employers cannot retaliate against employees who report safety concerns. Retaliation itself is a separate violation that carries additional penalties.'
      },
      { sender: 'user', content: 'What information should I include in the complaint?' },
      {
        sender: 'assistant',
        content:
          'Include the following for an effective complaint:\n\n1. **Your details** (name, contact, employer name and address)\n2. **Description of the hazard** (be specific — e.g., "broken guardrail on 3rd floor staircase")\n3. **When it was first observed**\n4. **Any previous reports** to your employer and their response\n5. **Photos or evidence** if available (upload with online form or bring copies in-person)\n6. **Number of affected workers**\n\nThe inspectorate aims to acknowledge complaints within 48 hours and conduct an on-site inspection within 10 business days.'
      }
    ]
  },
  {
    title: 'Vaccination records request',
    category: 'Healthcare & Social Services',
    tags: ['health', 'vaccination', 'records'],
    messages: [
      {
        sender: 'user',
        content: 'I need to get my vaccination records for a visa application. How can I obtain them?'
      },
      {
        sender: 'assistant',
        content:
          'You can obtain your vaccination records through the following methods:\n\n**Online (fastest):**\n1. Access the National Health Portal with your national ID\n2. Navigate to "Health Records" → "Vaccination History"\n3. Download or print your certified vaccination record\n\n**In-person:**\nVisit any public health clinic or the hospital where you received your vaccinations. Bring your national ID.\n\n**By mail:**\nSubmit a written request to the Ministry of Health Records Division. Processing takes 10-15 business days.\n\nThe online record includes all vaccinations administered at public health facilities. If you received vaccinations at private clinics, contact those facilities directly.'
      },
      { sender: 'user', content: 'What if some of my vaccinations were given in another country?' },
      {
        sender: 'assistant',
        content:
          'If you received vaccinations abroad:\n\n1. **Submit your foreign vaccination records** to any public health clinic for entry into the national system\n2. Bring the **original documents** (and translations if not in English/French)\n3. A health officer will verify and add them to your national health record\n\nThis process typically takes 3-5 business days. Once added, the records will appear in your online health portal.'
      }
    ]
  },
  {
    title: 'Building permit application process',
    category: 'Transport & Infrastructure',
    tags: ['permit', 'construction', 'building'],
    messages: [
      { sender: 'user', content: 'I want to build an extension on my house. Do I need a building permit?' },
      {
        sender: 'assistant',
        content:
          'Yes, a building permit is required for most construction work, including house extensions. Here is the process:\n\n**Step 1: Prepare documents**\n- Site plan (drawn by a licensed architect)\n- Structural engineering plans\n- Proof of land ownership\n- Neighbor consent forms (if the extension affects shared walls/boundaries)\n\n**Step 2: Submit application**\nApply online through the Urban Planning Portal or in-person at your municipal office.\n\n**Step 3: Review**\nThe municipality reviews the application for zoning compliance, structural safety, and environmental impact. This takes 15-30 business days.\n\n**Step 4: Approval & Fees**\nIf approved, pay the permit fee (calculated based on project value and size) and receive your permit.\n\n**Note:** Minor repairs (painting, flooring, fixture replacement) generally do not require a permit.'
      }
    ]
  },
  {
    title: 'How to register a new business',
    category: 'Tax & Revenue',
    tags: ['business', 'registration', 'startup'],
    messages: [
      { sender: 'user', content: 'I want to start a small retail business. What are the steps to register it?' },
      {
        sender: 'assistant',
        content:
          'Here are the steps to register a small business:\n\n**1. Choose a business structure**\n- Sole proprietorship (simplest, for individuals)\n- Limited Liability Company (LLC) — recommended for liability protection\n\n**2. Register with the Business Registry**\n- Submit the registration form online or at the Business Registry office\n- Provide: business name, address, owner details, business activity description\n- Fee: 200 local currency units\n\n**3. Obtain a Tax Identification Number (TIN)**\n- Automatic upon business registration\n\n**4. Register for VAT** (if annual turnover exceeds the threshold)\n\n**5. Obtain necessary licenses** (depends on your business type)\n\nThe entire process can be completed online in 2-3 business days.'
      },
      { sender: 'user', content: 'Are there any tax incentives for new small businesses?' },
      {
        sender: 'assistant',
        content:
          'Yes! The government offers several incentives for new small businesses:\n\n1. **Tax Holiday:** No corporate tax for the first 2 years (businesses with annual turnover under 500,000)\n2. **Reduced VAT Rate:** 5% instead of the standard 15% for the first 3 years\n3. **Employment Incentive:** Tax credit for each employee hired (up to 5 employees)\n4. **Simplified Bookkeeping:** Exempt from full audit requirements if turnover is under 1,000,000\n\nThese incentives are automatic — no separate application needed. Just ensure your business is properly registered and filing returns on time.'
      }
    ]
  },
  {
    title: 'Social assistance application for elderly parent',
    category: 'Healthcare & Social Services',
    tags: ['social', 'assistance', 'elderly'],
    messages: [
      {
        sender: 'user',
        content:
          'My elderly mother lives alone and has limited income. Is there a social assistance program she can apply for?'
      },
      {
        sender: 'assistant',
        content:
          'Yes, there are several programs for elderly citizens with limited income:\n\n**1. Old Age Social Pension**\n- For citizens aged 60+ with monthly income below 15,000\n- Monthly benefit: 5,000\n- Apply at any Social Services office\n\n**2. Elderly Care Subsidy**\n- Covers home care services, medical supplies, and transport to medical appointments\n- Means-tested (income and assets assessment)\n\n**3. Utility Subsidy**\n- 50% reduction on water and electricity bills\n- For households with only elderly residents and low income\n\nTo apply, your mother will need: national ID, proof of income (pension statement or affidavit), and proof of residence. You can apply on her behalf with a signed authorization letter.'
      },
      { sender: 'user', content: 'How long does the application process take?' },
      {
        sender: 'assistant',
        content:
          'Typical processing times:\n\n- **Old Age Social Pension:** 15-30 business days\n- **Elderly Care Subsidy:** 30-45 business days (includes home assessment visit)\n- **Utility Subsidy:** 10-15 business days\n\nIf approved, benefits are paid monthly through bank transfer or mobile money. Your mother can check application status through the Social Services online portal or by calling the helpline.\n\nTip: Apply as early as possible, as there may be a processing queue. Submit all required documents upfront to avoid delays.'
      }
    ]
  },
  {
    title: 'Environmental permit for small farm',
    category: 'Environment & Agriculture',
    tags: ['environment', 'farming', 'permit'],
    messages: [
      { sender: 'user', content: 'I am starting a small organic farm. Do I need any environmental permits?' },
      {
        sender: 'assistant',
        content:
          'For a small organic farm, the requirements depend on the scale and type of activities:\n\n**Generally required:**\n- **Land Use Permit** — from your local municipality\n- **Water Use Permit** — if you plan to draw water from a river, well, or borehole\n\n**May be required:**\n- **Environmental Impact Assessment (EIA)** — only for farms above 5 hectares or using irrigation systems\n- **Pesticide Application License** — even for organic-approved pesticides\n\n**Not required for small-scale:**\n- Rainwater harvesting\n- Small-scale composting\n- Manual farming tools\n\nOrganic certification is voluntary but can help with market access. Contact the National Organic Certification Board for details.'
      }
    ]
  },
  {
    title: 'Legal aid for family dispute',
    category: 'Justice & Legal Affairs',
    tags: ['legal', 'aid', 'family'],
    messages: [
      {
        sender: 'user',
        content: 'I am going through a custody dispute and cannot afford a lawyer. Is legal aid available?'
      },
      {
        sender: 'assistant',
        content:
          'Yes, legal aid is available for family law matters including custody disputes:\n\n**Eligibility:**\n- Monthly income below 25,000\n- The case must have merit (not frivolous)\n- Priority is given to cases involving children\n\n**How to apply:**\n1. Visit the Legal Aid Office at your local courthouse\n2. Bring: national ID, proof of income, and case documents\n3. Fill out the Legal Aid Application Form\n4. A legal aid officer will assess your case within 5 business days\n\n**What you get:**\n- A court-appointed lawyer at no cost\n- Assistance with document preparation\n- Representation at court hearings\n\nIf your application is denied, you can appeal the decision within 14 days.'
      }
    ]
  },
  {
    title: 'Public transit pass options',
    category: 'Transport & Infrastructure',
    tags: ['transit', 'pass', 'transport'],
    messages: [
      { sender: 'user', content: 'What public transit pass options are available? I commute daily to work.' },
      {
        sender: 'assistant',
        content:
          'Here are the public transit pass options:\n\n**1. Monthly Pass (Most Popular)**\n- Unlimited rides on buses and metro within the city\n- Cost: 2,500/month\n- Includes 50% discount on inter-city buses\n\n**2. Weekly Pass**\n- Unlimited rides for 7 consecutive days\n- Cost: 800\n\n**3. Annual Pass**\n- Best value: 25,000/year (saves 5,000 vs monthly)\n- Can be paid in monthly installments\n- Includes free parking at transit hubs\n\n**4. Senior/Student Pass**\n- 50% discount on all passes\n- Requires valid student ID or proof of age (60+)\n\nPasses can be purchased at transit stations, online, or through the mobile app. The mobile app also provides real-time schedules and trip planning.'
      },
      { sender: 'user', content: 'Can I use the same pass on both buses and the metro?' },
      {
        sender: 'assistant',
        content:
          'Yes, all standard passes (monthly, weekly, annual) are valid on both **buses and the metro** within the city network.\n\nHowever, inter-city express buses require either:\n- The 50% discount included with monthly/annual passes (you pay the remaining 50%)\n- A separate inter-city pass (1,500/month for unlimited inter-city travel)\n\nThe mobile app shows which zones and modes are covered by your specific pass when you tap your card or scan the QR code.'
      }
    ]
  }
];

// --- Analytics event types ---

const EVENT_TYPES = [
  'page_view',
  'chat_query',
  'chat_feedback',
  'document_upload',
  'document_view',
  'search',
  'login',
  'logout',
  'category_click',
  'service_click',
  'conversation_create',
  'conversation_archive',
  'conversation_star',
  'language_change',
  'export',
  'admin_login'
];

// --- Document files ---

const DOCUMENT_FILES = [
  { file_name: 'Annual Health Report 2025.pdf', file_type: 'application/pdf', file_size: 2458624, language: 'en' },
  { file_name: 'Education Policy Framework.pdf', file_type: 'application/pdf', file_size: 1832944, language: 'en' },
  { file_name: 'Tax Regulations Guide 2025.pdf', file_type: 'application/pdf', file_size: 3124576, language: 'en' },
  { file_name: 'Guide de la Santé Publique.pdf', file_type: 'application/pdf', file_size: 1567890, language: 'fr' },
  { file_name: 'Mwongozo wa Elimu 2025.pdf', file_type: 'application/pdf', file_size: 987654, language: 'sw' },
  {
    file_name: 'Infrastructure Master Plan.xlsx',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size: 543210,
    language: 'en'
  },
  {
    file_name: 'Environmental Impact Assessment Template.docx',
    file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 234567,
    language: 'en'
  },
  { file_name: 'Labor Law Reference Manual.pdf', file_type: 'application/pdf', file_size: 4123456, language: 'en' },
  { file_name: 'Citizen Services Charter.pdf', file_type: 'application/pdf', file_size: 876543, language: 'en' },
  {
    file_name: 'Agricultural Subsidy Program Details.pdf',
    file_type: 'application/pdf',
    file_size: 1654321,
    language: 'en'
  },
  { file_name: 'Budget Report Q4 2024.pdf', file_type: 'application/pdf', file_size: 3456789, language: 'en' },
  { file_name: 'Rapport Annuel Justice 2024.pdf', file_type: 'application/pdf', file_size: 2876543, language: 'fr' },
  {
    file_name: 'Digital Transformation Strategy.pdf',
    file_type: 'application/pdf',
    file_size: 1928374,
    language: 'en'
  },
  { file_name: 'Public Procurement Guidelines.pdf', file_type: 'application/pdf', file_size: 1234567, language: 'en' },
  {
    file_name: 'National ID Registration Statistics.xlsx',
    file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size: 456789,
    language: 'en'
  }
];

// ---------------------------------------------------------------------------
// Seeding logic
// ---------------------------------------------------------------------------

class SeedRunner {
  constructor(db, opts) {
    this.db = db;
    this.opts = opts;
    this.stats = { knowledge: 0, chat: 0, analytics: 0, documents: 0 };
    this.userId = null;
  }

  async getUserId() {
    if (this.userId) return this.userId;
    const cursor = await this.db.query(aql`
      FOR u IN users LIMIT 1 RETURN u._key
    `);
    const user = await cursor.next();
    this.userId = user || 'seed-user';
    if (!user) {
      console.log('  ! No users found — will use placeholder "seed-user" for edges');
    }
    return this.userId;
  }

  // --- Knowledge ---

  async seedKnowledge() {
    console.log('\n=== Seeding Knowledge ===');
    const cats = this.db.collection('serviceCategories');
    const svcs = this.db.collection('services');
    const edges = this.db.collection('categoryServices');
    const catTrans = this.db.collection('serviceCategoryTranslations');
    const svcTrans = this.db.collection('serviceTranslations');
    const catTransEdge = this.db.collection('serviceCategoryTranslationsEdge');
    const svcTransEdge = this.db.collection('serviceTranslationsEdge');

    // Determine next keys
    const lastCat = await this.db
      .query(aql`FOR d IN serviceCategories SORT TO_NUMBER(d._key) DESC LIMIT 1 RETURN d`)
      .then((c) => c.next());
    const lastSvc = await this.db
      .query(aql`FOR d IN services SORT TO_NUMBER(d._key) DESC LIMIT 1 RETURN d`)
      .then((c) => c.next());
    let catKey = lastCat ? parseInt(lastCat._key) + 1 : 1;
    let svcKey = lastSvc ? parseInt(lastSvc._key) + 1 : 101;
    let catOrder = lastCat ? lastCat.order + 1 : 1;

    for (const cat of CATEGORIES) {
      // Check for duplicate
      const exists = await this.db
        .query(
          aql`
        FOR d IN serviceCategories FILTER d.nameEN == ${cat.nameEN} LIMIT 1 RETURN d._key
      `
        )
        .then((c) => c.next());

      let currentCatKey;
      if (exists) {
        currentCatKey = exists;
        console.log(`  - Skip existing category: "${cat.nameEN}"`);
      } else {
        currentCatKey = String(catKey);
        await cats.save({
          _key: currentCatKey,
          nameEN: cat.nameEN,
          nameFR: cat.nameFR,
          nameSW: cat.nameSW,
          order: catOrder,
          catCode: cat.catCode,
          createdAt: daysAgo(60),
          updatedAt: daysAgo(2)
        });
        this.stats.knowledge++;
        catKey++;
        catOrder++;
        console.log(`  + Category: "${cat.nameEN}"`);
      }

      // Translations (EN, FR, SW)
      for (const [lang, field] of [
        ['en', 'nameEN'],
        ['fr', 'nameFR'],
        ['sw', 'nameSW']
      ]) {
        const tKey = `${currentCatKey}_${lang}`;
        const tExists = await this.db
          .query(
            aql`
          FOR d IN serviceCategoryTranslations FILTER d._key == ${tKey} LIMIT 1 RETURN d._key
        `
          )
          .then((c) => c.next());
        if (!tExists && cat[field]) {
          await catTrans.save({
            _key: tKey,
            serviceCategoryId: currentCatKey,
            languageCode: lang,
            translation: cat[field],
            isActive: true,
            createdAt: daysAgo(55)
          });
          await catTransEdge.save({
            _from: `serviceCategories/${currentCatKey}`,
            _to: `serviceCategoryTranslations/${tKey}`,
            createdAt: daysAgo(55)
          });
          this.stats.knowledge++;
        }
      }

      // Services
      let svcOrder = 1;
      for (const svcName of cat.services) {
        const svcExists = await this.db
          .query(
            aql`
          FOR d IN services FILTER d.nameEN == ${svcName} AND d.categoryId == ${currentCatKey} LIMIT 1 RETURN d._key
        `
          )
          .then((c) => c.next());

        if (svcExists) {
          console.log(`    - Skip existing service: "${svcName}"`);
          continue;
        }

        const svcId = String(svcKey);
        await svcs.save({
          _key: svcId,
          categoryId: currentCatKey,
          nameEN: svcName,
          order: svcOrder,
          createdAt: daysAgo(58),
          updatedAt: daysAgo(5)
        });
        await edges.save({
          _from: `serviceCategories/${currentCatKey}`,
          _to: `services/${svcId}`,
          createdAt: daysAgo(58)
        });
        this.stats.knowledge += 2;
        svcKey++;
        svcOrder++;
        console.log(`    + Service: "${svcName}"`);
      }
    }

    // Service translations (FR/SW for all services)
    const allServices = await this.db.query(aql`FOR d IN services RETURN d`).then((c) => c.all());
    const frTranslations = {
      'Find a Doctor': 'Trouver un Médecin',
      'Book a Hospital Appointment': "Prendre Rendez-vous à l'Hôpital",
      'Apply for Social Assistance': "Demander l'Aide Sociale",
      'Health Insurance Enrollment': "Inscription à l'Assurance Santé",
      'Mental Health Support': 'Soutien en Santé Mentale',
      'Vaccination Records': 'Dossiers de Vaccination',
      'School Enrollment': 'Inscription Scolaire',
      'University Admissions': 'Admissions Universitaires',
      'Scholarship Applications': 'Demandes de Bourse',
      'Adult Literacy Programs': "Programmes d'Alphabétisation pour Adultes",
      'Vocational Training': 'Formation Professionnelle',
      'Student Loan Information': 'Informations sur les Prêts Étudiants',
      'Birth Certificate': 'Acte de Naissance',
      'National ID Card': "Carte d'Identité Nationale",
      'Passport Application': 'Demande de Passeport',
      'Marriage Registration': 'Enregistrement de Mariage',
      'Death Certificate': 'Acte de Décès',
      'Change of Address': "Changement d'Adresse",
      'Income Tax Filing': "Déclaration d'Impôt sur le Revenu",
      'Property Tax Payment': 'Paiement de la Taxe Foncière',
      'Business Registration': "Enregistrement d'Entreprise",
      'Tax Certificate Request': 'Demande de Certificat Fiscal',
      'VAT Registration': 'Enregistrement TVA',
      'Customs Declaration': 'Déclaration en Douane',
      'Court Case Status': "Statut d'Affaire Judiciaire",
      'Legal Aid Application': "Demande d'Aide Juridique",
      'Notary Services': 'Services de Notaire',
      'File a Complaint': 'Déposer une Plainte',
      'Criminal Record Check': 'Vérification du Casier Judiciaire',
      'Land Dispute Resolution': 'Résolution des Litiges Fonciers',
      'Driver License Renewal': 'Renouvellement du Permis de Conduire',
      'Vehicle Registration': 'Immatriculation de Véhicule',
      'Public Transit Pass': 'Pass de Transport en Commun',
      'Road Condition Reports': "Rapports sur l'État des Routes",
      'Building Permits': 'Permis de Construire',
      'Utility Connections': 'Raccordements aux Services Publics',
      'Environmental Permits': 'Permis Environnementaux',
      'Waste Management': 'Gestion des Déchets',
      'Water Quality Reports': "Rapports sur la Qualité de l'Eau",
      'Agricultural Subsidies': 'Subventions Agricoles',
      'Fishing Licenses': 'Permis de Pêche',
      'Forestry Permits': 'Permis Forestiers',
      'Job Search Portal': "Portail de Recherche d'Emploi",
      'Unemployment Benefits': 'Allocations Chômage',
      'Work Permit Application': 'Demande de Permis de Travail',
      'Labor Rights Information': 'Informations sur les Droits du Travail',
      'Workplace Safety Report': 'Rapport de Sécurité au Travail',
      'Pension Information': 'Informations sur les Retraites'
    };
    const swTranslations = {
      'Find a Doctor': 'Tafuta Daktari',
      'Book a Hospital Appointment': 'Pata Ratiba ya Hospitali',
      'Apply for Social Assistance': 'Omba Msaada wa Jamii',
      'Health Insurance Enrollment': 'Usajili wa Bima ya Afya',
      'Mental Health Support': 'Msaada wa Afya ya Akili',
      'Vaccination Records': 'Rekodi za Chanjo',
      'School Enrollment': 'Usajili wa Shule',
      'University Admissions': 'Kuingia Chuo Kikuu',
      'Scholarship Applications': 'Maombi ya Ufadhili',
      'Adult Literacy Programs': 'Programu za Elimu ya Watu Wazima',
      'Vocational Training': 'Mafunzo ya Ufundi',
      'Student Loan Information': 'Taarifa za Mikopo ya Wanafunzi',
      'Birth Certificate': 'Cheti cha Kuzaliwa',
      'National ID Card': 'Kadi ya Kitambulisho',
      'Passport Application': 'Maombi ya Pasipoti',
      'Marriage Registration': 'Usajili wa Ndoa',
      'Death Certificate': 'Cheti cha Kifo',
      'Change of Address': 'Badilisha Anwani',
      'Income Tax Filing': 'Kujisajili Kodi ya Mapato',
      'Property Tax Payment': 'Malipo ya Kodi ya Mali',
      'Business Registration': 'Usajili wa Biashara',
      'Tax Certificate Request': 'Omba Cheti cha Kodi',
      'VAT Registration': 'Usajili wa VAT',
      'Customs Declaration': 'Tamko la Forodha',
      'Court Case Status': 'Hali ya Kesi Mahakamani',
      'Legal Aid Application': 'Omba Msaada wa Kisheria',
      'Notary Services': 'Huduma za Notari',
      'File a Complaint': 'Wasilisha Malalamiko',
      'Criminal Record Check': 'Ukaguzi wa Rekodi za Kriminal',
      'Land Dispute Resolution': 'Utatuzi wa Migogoro ya Ardhi',
      'Driver License Renewal': 'Kusasisha Leseni ya Udereva',
      'Vehicle Registration': 'Usajili wa Gari',
      'Public Transit Pass': 'Passi ya Usafiri wa Umma',
      'Road Condition Reports': 'Ripoti za Hali ya Barabara',
      'Building Permits': 'Ruhusa za Ujenzi',
      'Utility Connections': 'Miunganisho ya Huduma',
      'Environmental Permits': 'Ruhusa za Mazingira',
      'Waste Management': 'Usimamizi wa Taka',
      'Water Quality Reports': 'Ripoti za Ubora wa Maji',
      'Agricultural Subsidies': 'Ruzuku za Kilimo',
      'Fishing Licenses': 'Leseni za Uvuvi',
      'Forestry Permits': 'Ruhusa za Misitu',
      'Job Search Portal': 'Lango la Kutafuta Kazi',
      'Unemployment Benefits': 'Faida ya Umaskini',
      'Work Permit Application': 'Maombi ya Kibali cha Kazi',
      'Labor Rights Information': 'Taarifa za Haki za Kazi',
      'Workplace Safety Report': 'Ripoti ya Usalama Kazini',
      'Pension Information': 'Taarifa za Pensheni'
    };

    for (const svc of allServices) {
      for (const [lang, translations] of [
        ['en', null],
        ['fr', frTranslations],
        ['sw', swTranslations]
      ]) {
        const tKey = `${svc._key}_${lang}`;
        const tExists = await this.db
          .query(
            aql`
          FOR d IN serviceTranslations FILTER d._key == ${tKey} LIMIT 1 RETURN d._key
        `
          )
          .then((c) => c.next());
        if (!tExists) {
          const translation = translations ? translations[svc.nameEN] : svc.nameEN;
          if (translation) {
            await svcTrans.save({
              _key: tKey,
              serviceId: svc._key,
              languageCode: lang,
              translation,
              isActive: true,
              createdAt: daysAgo(50)
            });
            await svcTransEdge.save({
              _from: `services/${svc._key}`,
              _to: `serviceTranslations/${tKey}`,
              createdAt: daysAgo(50)
            });
            this.stats.knowledge += 2;
          }
        }
      }
    }

    console.log(`  Total knowledge documents inserted: ${this.stats.knowledge}`);
  }

  // --- Chat ---

  async seedChat() {
    console.log('\n=== Seeding Chat ===');
    const convs = this.db.collection('conversations');
    const msgs = this.db.collection('messages');
    const userConvs = this.db.collection('userConversations');
    const convCats = this.db.collection('conversationCategories');
    const userId = await this.getUserId();

    for (let i = 0; i < CONVERSATIONS.length; i++) {
      const conv = CONVERSATIONS[i];
      const convKey = `seed_conv_${i + 1}`;
      const created = daysAgo(30 - i * 2);
      const lastMsg = conv.messages[conv.messages.length - 1].content;

      // Check existing
      const exists = await this.db
        .query(aql`FOR d IN conversations FILTER d._key == ${convKey} LIMIT 1 RETURN d._key`)
        .then((c) => c.next());
      if (exists) {
        console.log(`  - Skip conversation: "${conv.title}"`);
        continue;
      }

      // Insert conversation
      await convs.save({
        _key: convKey,
        title: conv.title,
        lastMessage: lastMsg.substring(0, 100),
        created,
        updated: hoursAgo(i * 3),
        messageCount: conv.messages.length,
        isStarred: i === 0 || i === 3,
        isArchived: i === 7,
        category: conv.category,
        tags: conv.tags
      });
      this.stats.chat++;

      // User edge
      if (userId && userId !== 'seed-user') {
        await userConvs.save({
          _from: `users/${userId}`,
          _to: `conversations/${convKey}`,
          role: 'owner',
          lastViewedAt: hoursAgo(i * 2),
          createdAt: created
        });
        this.stats.chat++;
      }

      // Category edge
      const catMatch = await this.db
        .query(
          aql`
        FOR d IN serviceCategories FILTER d.nameEN == ${conv.category} LIMIT 1 RETURN d._key
      `
        )
        .then((c) => c.next());
      if (catMatch) {
        await convCats.save({
          _from: `conversations/${convKey}`,
          _to: `serviceCategories/${catMatch}`,
          relevanceScore: Math.round((0.6 + Math.random() * 0.4) * 100) / 100,
          createdAt: created
        });
        this.stats.chat++;
      }

      // Messages
      for (let j = 0; j < conv.messages.length; j++) {
        const msg = conv.messages[j];
        await msgs.save({
          _key: `${convKey}_msg_${j + 1}`,
          conversationId: convKey,
          content: msg.content,
          timestamp: new Date(new Date(created).getTime() + j * 120000 + Math.random() * 60000).toISOString(),
          sender: msg.sender,
          sequence: j + 1,
          readStatus: true
        });
        this.stats.chat++;
      }

      console.log(`  + Conversation: "${conv.title}" (${conv.messages.length} messages)`);
    }

    console.log(`  Total chat documents inserted: ${this.stats.chat}`);
  }

  // --- Analytics ---

  async seedAnalytics() {
    console.log('\n=== Seeding Analytics ===');
    const events = this.db.collection('events');
    const analyticsColl = this.db.collection('analytics');
    const queriesColl = this.db.collection('queries');
    const userId = await this.getUserId();

    // Fetch real category keys
    const categories = await this.db
      .query(
        aql`
      FOR c IN serviceCategories SORT c.order ASC RETURN { _key: c._key, nameEN: c.nameEN }
    `
      )
      .then((c) => c.all());
    if (categories.length === 0) {
      console.log('  ! No categories found — skipping analytics');
      return;
    }

    // Realistic query texts per category
    const QUERY_TEXTS = {
      'Healthcare & Social Services': [
        'How do I find a doctor near me?',
        'How to apply for social assistance?',
        'What health insurance options are available?',
        'Where can I get vaccinated?',
        'How to access mental health support?'
      ],
      'Education & Training': [
        'How to enroll my child in school?',
        'University admission requirements?',
        'Are there scholarship programs available?',
        'Adult literacy classes near me?',
        'Student loan application process'
      ],
      'Civil Registration & Identity': [
        'How to apply for a national ID?',
        'Birth certificate application',
        'Passport renewal process',
        'How to register a marriage?',
        'Change of address procedure'
      ],
      'Tax & Revenue': [
        'Income tax filing deadline',
        'How to pay property tax?',
        'Business registration process',
        'How to get a tax certificate?',
        'VAT registration requirements'
      ],
      'Justice & Legal Affairs': [
        'How to check court case status?',
        'Legal aid application process',
        'How to file a complaint?',
        'Criminal record check procedure',
        'Land dispute resolution process'
      ],
      'Transport & Infrastructure': [
        'Driver license renewal',
        'Vehicle registration process',
        'Public transit pass options',
        'How to get a building permit?',
        'Road condition reports'
      ],
      'Environment & Agriculture': [
        'How to get an environmental permit?',
        'Waste management guidelines',
        'Water quality reports',
        'Agricultural subsidy programs',
        'Fishing license requirements'
      ],
      'Employment & Labor': [
        'Job search portal',
        'Unemployment benefits application',
        'Work permit for foreigners',
        'Workplace safety report',
        'Pension information'
      ]
    };

    const users = [userId || 'seed-user', 'seed-user-2', 'seed-user-3'];
    const sessionIds = Array.from({ length: 5 }, (_, i) => `session-${i + 1}`);

    // --- 1. Populate `queries` collection (used by Usage Trends + Satisfaction) ---
    // Generate ~300 queries over the last 30 days
    const NUM_QUERIES = 300;
    for (let i = 0; i < NUM_QUERIES; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const queryTexts = QUERY_TEXTS[cat.nameEN] || ['General query'];
      const text = queryTexts[Math.floor(Math.random() * queryTexts.length)];
      const timestamp = new Date(NOW.getTime() - Math.random() * 30 * 86400000);
      const user = users[Math.floor(Math.random() * users.length)];
      const sessionId = sessionIds[Math.floor(Math.random() * sessionIds.length)];
      const responseTime = Math.round((0.5 + Math.random() * 3.0) * 100) / 100;

      // ~60% of queries get feedback
      const hasFeedback = Math.random() < 0.6;
      const rating = hasFeedback ? Math.floor(Math.random() * 3) + 3 : null; // 3-5 rating (mostly positive)

      const queryDoc = {
        _key: `seed_q_${i + 1}`,
        text,
        categoryId: cat._key,
        userId: user,
        sessionId,
        responseTime,
        isAnswered: true,
        timestamp: timestamp.toISOString()
      };

      if (hasFeedback && rating) {
        queryDoc.userFeedback = { rating, comment: '' };
      }

      await queriesColl.save(queryDoc);
      this.stats.analytics++;
    }

    // --- 2. Populate `analytics` collection (used by Dashboard + Category Distribution + Top Queries) ---
    // Same ~300 queries mirrored as analytics type='query'
    for (let i = 0; i < NUM_QUERIES; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const queryTexts = QUERY_TEXTS[cat.nameEN] || ['General query'];
      const text = queryTexts[Math.floor(Math.random() * queryTexts.length)];
      const timestamp = new Date(NOW.getTime() - Math.random() * 30 * 86400000);
      const user = users[Math.floor(Math.random() * users.length)];
      const sessionId = sessionIds[Math.floor(Math.random() * sessionIds.length)];
      const responseTime = Math.round((0.5 + Math.random() * 3.0) * 100) / 100;

      await analyticsColl.save({
        _key: `seed_aq_${i + 1}`,
        type: 'query',
        queryId: `seed_q_${i + 1}`,
        userId: user,
        sessionId,
        timestamp: timestamp.toISOString(),
        data: {
          text,
          categoryId: cat._key,
          responseTime,
          isAnswered: true
        }
      });
      this.stats.analytics++;
    }

    // --- 3. Populate `analytics` with feedback records (used by Satisfaction metrics) ---
    const NUM_FEEDBACK = 180;
    for (let i = 0; i < NUM_FEEDBACK; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
      const timestamp = new Date(NOW.getTime() - Math.random() * 30 * 86400000);
      const user = users[Math.floor(Math.random() * users.length)];
      // Skewed positive: 50% rating 5, 25% rating 4, 15% rating 3, 10% rating 2
      const rand = Math.random();
      const rating = rand < 0.5 ? 5 : rand < 0.75 ? 4 : rand < 0.9 ? 3 : 2;

      await analyticsColl.save({
        _key: `seed_af_${i + 1}`,
        type: 'feedback',
        userId: user,
        timestamp: timestamp.toISOString(),
        data: {
          rating,
          categoryId: cat._key,
          queryId: `seed_q_${Math.floor(Math.random() * NUM_QUERIES) + 1}`
        }
      });
      this.stats.analytics++;
    }

    // --- 4. Populate `events` collection (200 events) ---
    for (let i = 0; i < 200; i++) {
      const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
      const timestamp = new Date(NOW.getTime() - Math.random() * 30 * 86400000);
      const user = users[Math.floor(Math.random() * users.length)];

      let details = {};
      if (eventType === 'page_view') details = { page: '/dashboard', duration: Math.floor(Math.random() * 300) };
      else if (eventType === 'chat_query')
        details = { query: `Sample query ${i + 1}`, responseTime: Math.floor(Math.random() * 3000) + 500 };
      else if (eventType === 'chat_feedback')
        details = {
          conversationId: `seed_conv_${Math.floor(Math.random() * 12) + 1}`,
          rating: Math.floor(Math.random() * 5) + 1
        };
      else if (eventType === 'document_upload')
        details = {
          fileName: DOCUMENT_FILES[Math.floor(Math.random() * DOCUMENT_FILES.length)].file_name,
          fileSize: Math.floor(Math.random() * 5000000)
        };
      else if (eventType === 'search')
        details = { query: `search term ${i}`, resultsCount: Math.floor(Math.random() * 20) };
      else if (eventType === 'category_click')
        details = { category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].nameEN };

      await events.save({
        _key: `seed_evt_${i + 1}`,
        userId: user,
        eventType,
        timestamp: timestamp.toISOString(),
        details
      });
      this.stats.analytics++;
    }

    console.log(`  Total analytics documents inserted: ${this.stats.analytics}`);
    console.log(
      `    queries: ${NUM_QUERIES}, analytics (query): ${NUM_QUERIES}, analytics (feedback): ${NUM_FEEDBACK}, events: 200`
    );
  }

  // --- Documents ---

  async seedDocuments() {
    console.log('\n=== Seeding Documents ===');
    const files = this.db.collection('files');
    const labels = this.db.collection('labels');

    // Create labels matching categories
    const labelMap = {};
    for (const cat of CATEGORIES) {
      const labelKey = `seed_label_${cat.catCode.toLowerCase()}`;
      const exists = await this.db
        .query(aql`FOR d IN labels FILTER d._key == ${labelKey} LIMIT 1 RETURN d._key`)
        .then((c) => c.next());
      if (!exists) {
        await labels.save({
          _key: labelKey,
          name: cat.nameEN,
          level: 'category',
          status: 'active',
          parentId: null,
          publish: true
        });
        labelMap[cat.nameEN] = labelKey;
        this.stats.documents++;
        console.log(`  + Label: "${cat.nameEN}"`);
      } else {
        labelMap[cat.nameEN] = labelKey;
      }
    }

    // Insert files
    for (let i = 0; i < DOCUMENT_FILES.length; i++) {
      const f = DOCUMENT_FILES[i];
      const fileKey = `seed_file_${i + 1}`;
      const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      const uploadedDaysAgo = Math.floor(Math.random() * 60);

      // Assign relevant labels based on filename keywords
      const fileLabels = [];
      for (const [catName, labelKey] of Object.entries(labelMap)) {
        const keywords = catName
          .toLowerCase()
          .split(/[\s&]+/)
          .filter((w) => w.length > 3);
        if (keywords.some((kw) => f.file_name.toLowerCase().includes(kw))) {
          fileLabels.push(labelKey);
        }
      }

      const statuses = ['ingested', 'ingested', 'ingested', 'Pending', 'retracted'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const chunkCount = status === 'ingested' ? Math.floor(Math.random() * 50) + 5 : 0;

      await files.save({
        _key: fileKey,
        file_id: fileId,
        file_name: f.file_name,
        file_size: f.file_size,
        file_type: f.file_type,
        file_hash: cryptoModule.createHash('sha256').update(f.file_name).digest('hex'),
        storage_path: `/data/uploads/${fileId}/${f.file_name}`,
        labels: fileLabels,
        author: [
          'ITU Department',
          'Ministry of Health',
          'Ministry of Education',
          'National Statistics Office',
          'Treasury Department'
        ][i % 5],
        language: f.language,
        uploaded_date: daysAgo(uploadedDaysAgo),
        created_date: daysAgo(uploadedDaysAgo + 30),
        chunk_count: chunkCount,
        dataprep: {
          status,
          ingest_date: status === 'ingested' ? daysAgo(uploadedDaysAgo - 1) : '',
          retract_date: status === 'retracted' ? daysAgo(2) : ''
        }
      });
      this.stats.documents++;
      console.log(`  + File: "${f.file_name}" [${status}, ${chunkCount} chunks]`);
    }

    console.log(`  Total document records inserted: ${this.stats.documents}`);
  }

  // --- Main ---

  async run() {
    console.log('=== GENIE.AI Synthetic Data Seeding ===');
    console.log(`Database: ${DB_CONFIG.databaseName} at ${DB_CONFIG.url}`);

    try {
      await this.db.get();
      console.log('Connected to ArangoDB successfully.');
    } catch (err) {
      console.error(`Failed to connect to ArangoDB: ${err.message}`);
      process.exit(1);
    }

    if (this.opts.knowledge) await this.seedKnowledge();
    if (this.opts.chat) await this.seedChat();
    if (this.opts.analytics) await this.seedAnalytics();
    if (this.opts.documents) await this.seedDocuments();

    console.log('\n=== Summary ===');
    console.log(`Knowledge: ${this.stats.knowledge} documents`);
    console.log(`Chat:      ${this.stats.chat} documents`);
    console.log(`Analytics: ${this.stats.analytics} documents`);
    console.log(`Documents: ${this.stats.documents} documents`);
    console.log(
      `TOTAL:     ${this.stats.knowledge + this.stats.chat + this.stats.analytics + this.stats.documents} documents`
    );
    console.log('\nDone.');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts = PARSE_ARGS();

  if (opts.dryRun) {
    console.log('=== Dry Run ===');
    console.log(
      `Knowledge: ${CATEGORIES.reduce((n, c) => n + 1 + c.services.length * 4, 0)} documents (categories + services + translations + edges)`
    );
    console.log(
      `Chat: ${CONVERSATIONS.reduce((n, c) => n + 1 + c.messages.length + 2, 0)} documents (conversations + messages + edges)`
    );
    console.log(`Analytics: 206 documents (200 events + 6 aggregated)`);
    console.log(`Documents: ${DOCUMENT_FILES.length + CATEGORIES.length} documents (files + labels)`);
    console.log('\nNo data was inserted. Remove --dry-run to seed.');
    return;
  }

  const db = new Database(DB_CONFIG);
  const runner = new SeedRunner(db, opts);
  await runner.run();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
