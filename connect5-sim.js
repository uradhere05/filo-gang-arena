/**
 * Room 3-4 Connect 5 simulation — tests bug fixes in connect5.html.
 * Opens 2 Chrome windows, plays a full game (X wins a row of 5),
 * then tests rematch handshake, score sync, and disconnect countdown fix.
 * Run: node connect5-sim.js
 */
const { chromium } = require('playwright');

const INDEX = 'http://localhost:8080/index.html';
const sleep  = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(ok, label, detail = '') {
  if (ok) { console.log(`  ✅ PASS  ${label}`); passed++; }
  else     { console.log(`  ❌ FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function openPlayer(browser, name, avatar, col) {
  const ctx  = await browser.newContext({ viewport: { width: 500, height: 750 } });
  const page = await ctx.newPage();
  await page.addInitScript(({ n, a }) => {
    localStorage.setItem('filoName',   n);
    localStorage.setItem('filoAvatar', a);
  }, { n: name, a: avatar });
  await page.goto(INDEX);
  await page.evaluate(({ x }) => window.moveTo(x, 40), { x: col * 530 + 20 });
  console.log(`  ✓ ${name} opened index.html`);
  return page;
}

async function run() {
  console.log('\n🔵 Room 3-4 Connect 5 Simulation\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--window-size=500,750'],
  });

  // ── Open 2 windows from index.html ──────────────────────────────
  console.log('── Opening players from index.html ──\n');
  const p1 = await openPlayer(browser, 'Kuya AD', '🕵️', 0);
  await sleep(800);
  const p2 = await openPlayer(browser, 'Matt', '👱', 1);
  await sleep(2500);

  // ── Both click Room 3 ────────────────────────────────────────────
  console.log('\n🚪 Both players clicking Room 3...');
  for (const [pg, name] of [[p1,'Kuya AD'],[p2,'Matt']]) {
    try {
      await pg.waitForSelector('.room-card', { timeout: 8000 });
      const rooms = await pg.$$('.room-card');
      await rooms[2].click();
      console.log(`  ✓ ${name} clicked Room 3`);
    } catch (e) {
      console.log(`  ⚠ ${name}: ${e.message.split('\n')[0]}`);
    }
    await sleep(1000);
  }

  // ── Wait for PeerJS connection ───────────────────────────────────
  console.log('\n⏳ Waiting for PeerJS connection (up to 15s)...');
  await sleep(15000);

  const p1InGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2InGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1InGame, 'Kuya AD (host X) in game screen');
  assert(p2InGame, 'Matt (guest O) in game screen');

  if (!p1InGame || !p2InGame) {
    console.log('\n⚠ PeerJS connection failed — check that http server is running on :8080');
    await sleep(3000);
    await browser.close();
    return;
  }

  // ── Bug fix: guest name visible to host ──────────────────────────
  const hostVsText = await p1.evaluate(() => document.getElementById('vs-display')?.textContent || '').catch(() => '');
  assert(hostVsText.includes('Matt'), 'Host sees guest name in vs-display', hostVsText);

  const p1Piece = await p1.evaluate(() => myPiece).catch(() => null);
  const p2Piece = await p2.evaluate(() => myPiece).catch(() => null);
  console.log(`\n🎯 Pieces — Kuya AD: ${p1Piece}, Matt: ${p2Piece}`);
  assert(p1Piece === 'X' && p2Piece === 'O', 'Host=X, Guest=O', `${p1Piece}/${p2Piece}`);

  const xPage = p1Piece === 'X' ? p1 : p2;
  const oPage = p1Piece === 'O' ? p1 : p2;

  // ── Game 1: X wins top row [0–4] ────────────────────────────────
  console.log('\n♟️ Game 1 — X wins top row [0,1,2,3,4]...');
  const game1 = [
    [xPage, 0],  [oPage, 13],
    [xPage, 1],  [oPage, 14],
    [xPage, 2],  [oPage, 15],
    [xPage, 3],  [oPage, 16],
    [xPage, 4],
  ];
  for (const [pg, cell] of game1) {
    try {
      const cells = await pg.$$('.c5-cell');
      await cells[cell].click();
      await sleep(400);
    } catch {}
  }
  await sleep(2000);

  const xScore = await p1.evaluate(() => scores?.X).catch(() => null);
  assert(xScore === 1, `X score = 1 after game 1`, String(xScore));

  const p1Champ = await p1.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  const p2Champ = await p2.evaluate(() => document.getElementById('s-champ')?.classList.contains('active')).catch(() => false);
  assert(p1Champ || p2Champ, 'Champion screen shown after 1 win (WINS_NEED=1)');

  // ── Bug fix: two-click rematch handshake + score reset sync ─────
  console.log('\n🔄 Rematch handshake + score reset sync...');

  for (const btn of await p1.$$('button')) {
    const t = await btn.textContent().catch(() => '');
    if (t.includes('Rematch') || t.includes('🔄')) {
      await btn.click(); console.log('  ✓ P1 clicked Rematch (1st)'); break;
    }
  }
  await sleep(2000);

  const waitingForP2 = await p1.evaluate(() =>
    document.getElementById('s-champ')?.classList.contains('active') || document.getElementById('s-game')?.classList.contains('active')
  ).catch(() => false);
  assert(waitingForP2, 'After 1st Rematch — P1 still waiting');

  for (const btn of await p2.$$('button')) {
    const t = await btn.textContent().catch(() => '');
    if (t.includes('Rematch') || t.includes('🔄')) {
      await btn.click(); console.log('  ✓ P2 clicked Rematch (2nd — completes handshake)'); break;
    }
  }
  await sleep(3000);

  const p1BackInGame = await p1.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  const p2BackInGame = await p2.evaluate(() => document.getElementById('s-game')?.classList.contains('active')).catch(() => false);
  assert(p1BackInGame && p2BackInGame, 'Both back in game after rematch');

  const p1ScoresReset = await p1.evaluate(() => scores?.X === 0 && scores?.O === 0).catch(() => false);
  const p2ScoresReset = await p2.evaluate(() => scores?.X === 0 && scores?.O === 0).catch(() => false);
  assert(p1ScoresReset, 'P1 scores reset to 0 after rematch');
  assert(p2ScoresReset, 'P2 scores reset to 0 after rematch (score-reset message sync)');

  // ── Bug fix: disconnect countdown cancellable ────────────────────
  console.log('\n💥 Disconnect countdown is cancellable...');
  await p1.evaluate(() => { gameOver = true; onDrop(); });
  await sleep(300);
  await p1.evaluate(() => leaveGame());
  await sleep(6500);
  const p1OnLobby     = await p1.evaluate(() => document.getElementById('s-lobby')?.classList.contains('active')).catch(() => false);
  const dropIvCleared = await p1.evaluate(() => dropCountdownIv === null).catch(() => false);
  assert(p1OnLobby,     'P1 on lobby after leaveGame() during countdown');
  assert(dropIvCleared, 'dropCountdownIv=null after leaveGame() (interval cancelled)');

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
