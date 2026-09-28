// Play Tiger Tank - dismiss pause, use mouse controls
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
    if (!t.includes('WebGL') && !t.includes('GPU stall') && !t.includes('willReadFrequently') && !t.includes('AudioContext')) {
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

  // Click START button
  console.log('Clicking START...');
  await page.mouse.click(640, 500);
  await page.waitForTimeout(2000);

  // Click again to advance past title
  await page.mouse.click(640, 500);
  await page.waitForTimeout(2000);

  // Try pressing Escape/P to dismiss any pause dialog
  console.log('Trying to dismiss pause...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('p');
  await page.waitForTimeout(500);

  // Click outside the pause dialog (top-left corner area)
  await page.mouse.click(100, 100);
  await page.waitForTimeout(500);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);

  await page.screenshot({ path: '/tmp/tigertank_06_after_dismiss.png' });
  console.log('Saved after-dismiss screenshot');

  // Inspect what's on screen
  const info = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({
      width: c.width, height: c.height
    }));
    return { canvases, bodyText: document.body.innerText.slice(0, 300) };
  });
  console.log('Page info:', JSON.stringify(info, null, 2));

  // Try mouse-based play: hold mouse down to move, click to shoot
  console.log('Playing with mouse...');
  for (let frame = 0; frame < 30; frame++) {
    // Move mouse in a circle around center to simulate aiming/moving
    const angle = frame * 0.2;
    const radius = 150 + Math.sin(frame * 0.1) * 50;
    const mx = 640 + Math.cos(angle) * radius;
    const my = 400 + Math.sin(angle) * radius;

    await page.mouse.move(mx, my);
    await page.waitForTimeout(100);

    // Click to shoot every few frames
    if (frame % 3 === 0) {
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
    }

    // Periodically screenshot
    if (frame % 10 === 0) {
      await page.screenshot({ path: `/tmp/tigertank_07_frame_${frame}.png` });
      console.log(`Frame ${frame} screenshot saved`);
    }

    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: '/tmp/tigertank_08_final.png' });
  console.log('Saved final screenshot');

  await browser.close();
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
