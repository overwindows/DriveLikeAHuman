// Load Tiger Tank game directly, bypassing YouTube auth
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

  // Intercept the YouTube game_api request and stub it
  await page.route('**/game_api/v1*', route => {
    console.log('Intercepted game_api request');
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.gameApi = {
          saveData: function(d) { console.log('saveData', d); return Promise.resolve(); },
          loadData: function() { console.log('loadData'); return Promise.resolve('{}'); },
          requestRewardedAd: function(id, onFinish, onError) { console.log('requestRewardedAd', id); if(onFinish) onFinish(); },
          requestInterstitialAd: function(onEmpty) { console.log('requestInterstitialAd'); if(onEmpty) onEmpty(); },
          isAudioEnabled: function() { return true; },
          applyAudioEnabled: function() {},
          isAvailable: function() { return false; }
        };
        window.YT = window.gameApi;
      `
    });
  });

  console.log('Loading game directly...');
  await page.goto('https://393088398809336751.playables.usercontent.goog/v/assets/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: '/tmp/tigertank_02_direct.png', fullPage: false });
  console.log('Saved direct screenshot');

  const info = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      width: c.width, height: c.height, id: c.id
    }));
    return { canvases, title: document.title, bodyText: document.body.innerText.slice(0, 500) };
  });
  console.log('Direct load info:', JSON.stringify(info, null, 2));

  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
