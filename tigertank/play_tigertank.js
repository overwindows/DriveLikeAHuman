// Play Tiger Tank via Playwright
const { chromium } = require('/import/ml-sc-scratch1/chenw/CodeGuru/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  console.log('Navigating to game...');
  await page.goto('https://www.youtube.com/playables/UgkxT_4qbVJ-z1W-AjrSIEJEAx8Smu4msgbf', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Try to find the game iframe
  const frames = page.frames();
  console.log('Frames:', frames.map(f => f.url()));

  // Take initial screenshot
  await page.screenshot({ path: '/tmp/tigertank_01_initial.png', fullPage: false });
  console.log('Saved initial screenshot');

  // Look for canvas / game elements
  const canvasInfo = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      width: c.width, height: c.height, id: c.id, className: c.className
    }));
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
    return { canvases, iframes, title: document.title, bodyText: document.body.innerText.slice(0, 500) };
  });
  console.log('Page info:', JSON.stringify(canvasInfo, null, 2));

  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
