const fs = require('fs');

// Mapping of locale files to update
const locales = ['bn', 'de', 'es', 'fr', 'id', 'pt', 'ru', 'sw', 'th', 'zh'];

locales.forEach(locale => {
  // Read from mobile app Dart file
  const dartPath = `mobile/genie_ai_mobile/lib/i18n/locales/${locale}.dart`;
  const vuePath = `components/gov-chat-frontend/src/i18n/locales/${locale}.js`;
  
  if (!fs.existsSync(dartPath) || !fs.existsSync(vuePath)) {
    console.log(`Skipping ${locale} - files not found`);
    return;
  }
  
  const dartContent = fs.readFileSync(dartPath, 'utf8');
  const vueContent = fs.readFileSync(vuePath, 'utf8');
  
  // Extract quickhelp section from Dart file
  const quickhelpMatch = dartContent.match(/"quickhelp": \{([\s\S]*?)\n  \},\n  "common":/);
  if (!quickhelpMatch) {
    console.log(`No quickhelp found in ${locale}.dart`);
    return;
  }
  
  const quickhelpContent = quickhelpMatch[0].replace('"quickhelp": {', 'quickhelp: {').replace('},\n  "common":', '\n  },');
  
  // Find and replace quickhelp section in Vue file
  const vueQuickhelpMatch = vueContent.match(/quickhelp: \{[\s\S]*?\n  \},\n  common:/);
  if (!vueQuickhelpMatch) {
    console.log(`No quickhelp found in ${locale}.js`);
    return;
  }
  
  const updatedVueContent = vueContent.replace(
    /quickhelp: \{[\s\S]*?\n  \},\n  common:/,
    quickhelpContent + ',\n  common:'
  );
  
  fs.writeFileSync(vuePath, updatedVueContent, 'utf8');
  console.log(`Updated ${locale}.js`);
});

console.log('Done!');
