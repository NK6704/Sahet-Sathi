const puppeteer = require('puppeteer');

async function run() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Grant microphone permissions
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('http://localhost:3000', ['microphone']);
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));
  
  console.log('Navigating to assistant page...');
  await page.goto('http://localhost:3000/assistant', { waitUntil: 'networkidle2' });
  
  console.log('Waiting for MicButton...');
  // The mic button has onClick={handleToggleListening}. 
  // Let's click it!
  const btn = await page.waitForSelector('button[aria-label="Start live voice"], button[aria-label="लाइव आवाज़ शुरू करें"], button:has(svg.lucide-mic)');
  if (btn) {
    console.log('Clicking mic button...');
    await btn.click();
    
    // Wait a bit to see what happens
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log('Mic button not found!');
  }
  
  await browser.close();
}

run().catch(console.error);
