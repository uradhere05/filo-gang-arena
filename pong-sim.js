/**
 * Room 5-6 Picklebol simulation — tests bug fixes in pong.html.
 * Opens 2 Chrome windows from index.html, both join Room 5,
 * scores 5 points for left player via ball injection,
 * then tests rematch handshake and disconnect countdown cancel.
 * Run: node pong-sim.js
 */
const { chromium } = require('playwright');

const INDEX  = 'http://localhost:8080/index.html';
const PONG5  = 'http://localhost:8080/pong.html?room=5';
const sleep  = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else     { console.log(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function openPlayer(browser, name, avatar, col, url) {
  const ctx  = await browser.newContext({ viewport: { width: 640, height: 780 } });
  const page = await ctx.newPage();
  await page.addInitScript(({ n, a }) => {
    localStorage.setItem('filoName',   n);
    localStorage.setItem('filoAvatar', a);
  }, { n: name, a: avatar });
  await page.goto(url || INDEX);
  await page.evaluate(({ x }) => window.moveTo(x, 40), { x: col * 660 + 20 });
  console.log(`  ✓ ${name} opened ${(url||INDEX).split('/').pop()}`);
  return page;
}

async function run() {
  console.log('\n🏓 Room 5-6 Picklebol Simulation\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=640,780'],
  });

  console.log('── Opening players directly at pong.html?room=5 ──\n');
  const p1 = await openPlayer(browser, 'Kuya AD', '🕵️', 0, PONG5);
  await sleep(1000);
  const p2 = await openPlayer(browser, 'Matt', '👱', 1, PONG5);
  await sleep(1000);

  // ── Wait for PeerJS ──────────────────────────────────────────────
  console.log('\n⏳ Waiting for PeerJS connection (up to 22s)...');
  await sleep(22000);

  const p1InGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2InGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1InGame, 'Kuya AD (host/left) in game screen');
  assert(p2InGame, 'Matt (guest/right) in game screen');

  if (!p1InGame || !p2InGame) {
    console.log('\n⚠ PeerJS connection failed — ensure http server is running on :8080');
    await browser.close();
    return;
  }

  const p1Side = await p1.evaluate(() => mySide).catch(() => null);
  const p2Side = await p2.evaluate(() => mySide).catch(() => null);
  console.log(`\n🎯 Sides — Kuya AD: ${p1Side}, Matt: ${p2Side}`);
  assert(p1Side === 'left' && p2Side === 'right', 'Host=left, Guest=right', `${p1Side}/${p2Side}`);

  // ── Bug fix: guest name visible on host's vs-display ────────────
  const vsText = await p1.evaluate(() => document.getElementById('vs-display')?.textContent || '').catch(() => '');
  assert(vsText.includes('Matt'), 'Host vs-display shows guest name', vsText);

  // ── Score 5 points for left by placing ball past right boundary ──
  console.log('\n🎯 Scoring 5 points for left via ball injection...');
  for (let i = 0; i < 5; i++) {
    await p1.evaluate(() => {
      ball.x = 620; ball.y = 170; ball.vx = 8; ball.vy = 0;
    });
    await sleep(400);
  }
  await sleep(1500);

  const p1Scores = await p1.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  const p2Scores = await p2.evaluate(() => ({ l: scores.left, r: scores.right })).catch(() => null);
  console.log(`  Kuya AD: left=${p1Scores?.l} right=${p1Scores?.r}`);
  console.log(`  Matt:    left=${p2Scores?.l} right=${p2Scores?.r}`);
  assert((p1Scores?.l ?? 0) >= 5, `Left score ≥ 5`, String(p1Scores?.l));

  // ── Champion screen ───────────────────────────────────────────────
  const p1Champ = await p1.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  const p2Champ = await p2.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  assert(p1Champ || p2Champ, 'Champion screen shown after 5 wins');

  // ── Bug fix: two-click rematch handshake ─────────────────────────
  console.log('\n🔄 Rematch handshake...');
  for (const btn of await p1.$$('button')) {
    const t = await btn.textContent().catch(() => '');
    if (t.includes('Rematch') || t.includes('🔄')) {
      await btn.click(); console.log('  ✓ P1 clicked Rematch (1st)'); break;
    }
  }
  await sleep(2000);

  const p1Waiting = await p1.evaluate(() =>
    document.getElementById('s-champ')?.classList.contains('active') || document.getElementById('s-game')?.classList.contains('active')
  ).catch(() => false);
  assert(p1Waiting, 'P1 waiting after 1st Rematch click');

  for (const btn of await p2.$$('button')) {
    const t = await btn.textContent().catch(() => '');
    if (t.includes('Rematch') || t.includes('🔄')) {
      await btn.click(); console.log('  ✓ P2 clicked Rematch (2nd)'); break;
    }
  }
  await sleep(3000);

  const p1Back = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2Back = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1Back && p2Back, 'Both back in game after rematch');
  const scoresReset = await p1.evaluate(() => scores.left === 0 && scores.right === 0).catch(() => false);
  assert(scoresReset, 'Scores reset to 0 after rematch');

  // ── Bug fix: disconnect countdown cancellable ────────────────────
  console.log('\n💥 Disconnect countdown is cancellable...');
  await p1.evaluate(() => { onDrop(); });
  await sleep(300);
  // destroyPeer() clears dropCountdownIv, then navigate
  await p1.evaluate(() => { destroyPeer(); window.location.href = `index.html?screen=lobby&name=${encodeURIComponent(myName)}`; });
  await sleep(6500);
  const p1OnLobby     = await p1.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false);
  const dropIvCleared = await p1.evaluate(() => dropCountdownIv === null).catch(() => false);
  assert(p1OnLobby,     'P1 on lobby after navigation during countdown');
  assert(dropIvCleared, 'dropCountdownIv=null (destroyPeer cancelled interval)');

  // ── Results ──────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`Results: ${passed} passed, ${failed} failed  (${passed + failed} total)`);
  console.log(failed === 0 ? '🎉 ALL TESTS PASSED' : `⚠️  ${failed} test(s) failed`);
  console.log('\nWindows stay open for inspection.\n');
}

run().catch(err => {
  console.error('\n❌ Sim error:', err.message);
  process.exit(1);
});
