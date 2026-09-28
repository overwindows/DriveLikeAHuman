// Play Tiger Tank - click START and play
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

  page.on('console', msg => {
    const t = msg.text();
    if (!t.includes('WebGL') && !t.includes('GPU stall') && !t.includes('willReadFrequently')) {
      console.log('[browser]', msg.type(), t);
    }
  });
  page.on('pageerror', err => console.log('[pageerror]', err.message));

  await page.route('**/game_api/v1*', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.gameApi = {
          saveData: function(d) { return Promise.resolve(); },
          loadData: function() { return Promise.resolve('{}'); },
          requestRewardedAd: function(id, onFinish, onError) { if(onFinish) onFinish(); },
          requestInterstitialAd: function(onEmpty) { if(onEmpty) onEmpty(); },
          isAudioEnabled: function() { return true; },
          applyAudioEnabled: function() {},
          isAvailable: function() { return false; }
        };
        window.YT = window.gameApi;
      `
    });
  });

  console.log('Loading game...');
  await page.goto('https://393088398809336751.playables.usercontent.goog/v/assets/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Click START button (center of canvas)
  console.log('Clicking START...');
  await page.mouse.click(640, 500);
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/tigertank_03_after_start.png' });
  console.log('Saved after-start screenshot');

  // Try clicking again to advance through menus
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(640, 500);
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: '/tmp/tigertank_04_in_game.png' });
  console.log('Saved in-game screenshot');

  // Now try to play - move and shoot
  console.log('Playing...');
  for (let frame = 0; frame < 20; frame++) {
    // Move in different directions
    const dx = Math.cos(frame * 0.3) * 100;
    const dy = Math.sin(frame * 0.3) * 100;
    await page.mouse.move(640 + dx, 500 + dy);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(200);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Space'); // shoot
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: '/tmp/tigertank_05_playing.png' });
  console.log('Saved playing screenshot');

  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
