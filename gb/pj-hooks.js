'use strict';
/* PHOTO JIGSAW: GameBull hooks, loaded after the client's bgm.js (their files unchanged). Classic scripts share
 * globals, so their top-level functions (draw, startStage) can be wrapped and their lets read (stage, gameSession,
 * pieces, placed, campaign, started). What this adds, all for GameBull Stage Mode:
 *  - the clear report: their game marks a finished board only in this browser; when every piece is placed, the clear
 *    goes to GameBull (gb/pj-host.js completeStage) and their 次のステージへ shows once GameBull has it;
 *  - progress from the server: their stage list, START stage and progress bar follow GameBull's highestCleared /
 *    nextStage (their own localStorage campaign is rewritten from it, with their own persistCampaign/renderCampaign);
 *  - the attempt's time limit (GameBull requires one, at most 59 min): 残り m:ss in their life row; at 0 the board is
 *    saved, moves stop, and the player goes back to their TOP (the next START continues the board, 1 Life);
 *  - page dialogs for their alert() and confirm(): the GameBull app's game frame is sandboxed without allow-modals, so
 *    both are silently refused there (their やり直す confirm() returns false: the button would never work);
 *  - the all-clear voucher (stage 600, status from the server) in a dialog; its button closes the game into the
 *    GameBull app's coupon (gamebull:close + to: /coupons/<id>, relayed by the loading page; trap W18);
 *  - a launch that cannot play (Game Start, no launch data) says so, with a way back to GameBull;
 *  - the loading page signal once their TOP art is in, and audioSession "playback" on the first tap (trap W2);
 *  - the fit to the GameBull window (no scrolling, full width, scale 1): see PJFit below.
 */
(function () {
  const ENV = window.PJ_GB || {};
  const gb = () => window.PJGB;
  const log = (...a) => console.log('[PJ-GB]', ...a);
  const el = id => document.getElementById(id);
  log(`Build v${ENV.build} (${ENV.gameId}, API ${ENV.apiBase}).`);

  function closeToGameBull(to) {
    if (!gb().embedded) return false;
    const msg = { type: 'gamebull:close' }; if (to) msg.to = to;
    log('gamebull:close ' + JSON.stringify(msg) + ' (through the loading page relay).');
    window.parent.postMessage(msg, location.origin);
    return true;
  }

  /* ── styles for the few GameBull elements (scoped to .pjgb-*, trap W10; colours from their style.css) ── */
  const css = document.createElement('style');
  css.textContent = `
  .pjgb-time{white-space:nowrap;border:1px solid #d6dee5;border-radius:20px;padding:7px 12px;background:#fff;color:#45515e;font:11px system-ui,sans-serif;font-variant-numeric:tabular-nums}
  .pjgb-time[hidden]{display:none}
  .pjgb-time.pjgb-low{border-color:#d28b7c;color:#a8402c}
  .pjgb-clear{margin:4px 0;text-align:center;font:12px/1.6 system-ui,sans-serif;color:#526273}
  .pjgb-clear[hidden]{display:none}
  .pjgb-clear button{margin:6px auto 0;display:block;min-height:40px;padding:8px 18px;background:#fff;color:#343b43;border:1px solid #b9c2cb;border-radius:10px;box-shadow:none;font:13px system-ui,sans-serif}
  .pjgb-dialog p{white-space:pre-line}
  .pjgb-dialog .pjgb-secondary{display:block;width:100%;margin-top:10px;min-height:48px;background:#fff;color:#26272a;border:1px solid #b9c2cb;box-shadow:none;border-radius:12px}
  .pjgb-dialog img{display:block;max-width:100%;max-height:160px;margin:10px auto;border-radius:8px}
  .pjgb-dialog h2{margin-top:0}
  /* their dialogs (遊び方: four paragraphs) on short windows: tighter spacing so the whole dialog and its button fit,
     no scrolling inside it (their sizes above 700 px of height) */
  /* their dialogs (centred) stay clear of the GameBull app's Done / collapse buttons in its expanded view */
  dialog{max-height:calc(100dvh - 116px)!important}
  @media (max-height:700px){
    dialog{padding:16px 18px!important;max-height:calc(100dvh - 116px)!important}
    dialog h2{font-size:20px!important;margin:4px 0 10px!important}
    dialog p{font-size:13px!important;line-height:1.65!important;margin:8px 0!important}
    dialog label{margin:12px 0 6px!important}
    dialog .dialog-primary,dialog .pjgb-secondary{margin-top:12px!important;min-height:44px!important}}
  @media (max-height:460px){dialog p{font-size:12px!important;line-height:1.5!important;margin:5px 0!important}dialog h2{font-size:18px!important;margin:0 0 6px!important}}
  /* fixed window: PJFit fits their page to the window (scale 1); no scrollbar */
  html{overflow:hidden;scrollbar-width:none}
  html::-webkit-scrollbar{display:none}`;
  document.head.appendChild(css);

  /* ── page dialogs (their dialog look: their style.css styles every <dialog>, .dialog-primary) ── */
  const dialog = document.createElement('dialog');
  dialog.className = 'pjgb-dialog'; dialog.setAttribute('aria-live', 'assertive');
  document.body.appendChild(dialog);
  // buttons: [{label, primary, run}]; Esc closes like the first non-primary button (or the only one).
  function showDialog(nodes, buttons) {
    dialog.replaceChildren(...nodes);
    let onCancel = null;
    for (const b of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = b.primary ? 'dialog-primary' : 'pjgb-secondary'; button.textContent = b.label;
      button.onclick = () => { dialog.close(); if (b.run) b.run(); };
      dialog.append(button);
      if (!b.primary || buttons.length === 1) onCancel = onCancel || b.run || (() => {});
    }
    dialog.oncancel = e => { e.preventDefault(); dialog.close(); if (onCancel) onCancel(); };
    if (dialog.open) dialog.close();
    try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
  }
  const para = text => { const p = document.createElement('p'); p.textContent = text; return p; };
  function notice(text, then) {
    const buttons = [{ label: 'OK', primary: true, run: then }];
    showDialog([para(text)], buttons);
  }
  // Their alert() (start refusals, their own messages) becomes a page dialog: alert is refused in the app's frame.
  window.alert = message => { log('Message: ' + message); notice(String(message)); };

  // Their やり直す: the same question and the same action as their onclick, without confirm() (refused in the app).
  el('restart').onclick = () => {
    showDialog([para('1ライフを使用して最初からやり直しますか？')], [
      { label: 'やり直す', primary: true, run: () => startStage(stage, true) },
      { label: 'キャンセル' }
    ]);
  };

  /* ── progress from the server: their stage list and START follow GameBull ── */
  function syncCampaign(m) {
    const h = m.highestCleared;
    const before = JSON.stringify([campaign.unlocked, campaign.completed.length, campaign.current]);
    campaign.unlocked = Math.max(1, Math.min(600, h + 1));
    campaign.completed = Array.from({ length: h }, (_, i) => i + 1);
    // Their START is "続きのステージを始める": GameBull's next stage (stage 600 once all are cleared).
    if (stage === null) campaign.current = m.nextStage === null ? 600 : m.nextStage;
    persistCampaign(); renderCampaign();
    const after = JSON.stringify([campaign.unlocked, campaign.completed.length, campaign.current]);
    if (after !== before) log(`Their stage list follows GameBull: ${h} cleared, unlocked ${campaign.unlocked}, START ${campaign.current}.`);
  }
  addEventListener('pj-gb:context', e => { const m = e.detail && e.detail.stageMode; if (m) syncCampaign(m); });
  if (gb().context && gb().context.stageMode) syncCampaign(gb().context.stageMode);

  /* ── clear report: their board complete -> GameBull; their 次のステージへ once GameBull has it ── */
  const line = document.createElement('p');
  line.className = 'pjgb-clear'; line.hidden = true; line.setAttribute('role', 'status');
  el('message').after(line);
  function setLine(text, resend) {
    line.replaceChildren(document.createTextNode(text));
    if (resend) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'クリア記録を再送信';
      b.onclick = () => { if (report && report.state === 'failed') send(report); };
      line.append(b);
    }
    line.hidden = !text;
    PJFit();
  }
  let report = null; // { gameId, stage, state: sending | ok | failed | final }
  const complete = () => stage !== null && pieces.length > 0 && placed === pieces.length;
  async function send(r) {
    r.state = 'sending'; setLine('GameBullにクリアを記録しています…');
    const res = await gb().completeStage(r.gameId, r.stage);
    if (report !== r) return;
    if (res.ok) {
      const d = res.result;
      if (d.status === 'CLEARED' || d.status === 'ALREADY_CLEARED') {
        r.state = 'ok'; setLine('クリアをGameBullに記録しました（' + d.highestCleared + ' / 600）');
      } else if (d.status === 'REPLAY') {
        r.state = 'ok'; setLine('クリア済みステージの再挑戦です。GameBullの記録は変わりません。');
      } else {
        r.state = 'final'; setLine('制限時間を過ぎていたため、クリアとして記録されませんでした。TOPの「START」から、もう一度挑戦できます（ライフ1）。');
      }
      if (r.state === 'ok' && stage === r.stage) { el('nextStage').hidden = stage === 600; PJFit(); } // their own rule
      if (d.reward) showReward(d.reward);
    } else if (res.final) { r.state = 'final'; setLine(res.message); }
    else { r.state = 'failed'; setLine(res.message + ' 盤面はこの端末に保存されています。', true); }
  }
  const theirDraw = draw;
  draw = function () {
    theirDraw.apply(this, arguments);
    const s = gameSession;
    if (!complete() || !s || s.mode !== 'gamebull') { if (report && (stage === null || !complete())) { report = null; setLine(''); } return; }
    if (!report || report.gameId !== s.gameId) {
      // Their own count for the stage: tiers[] (30 tiers x 20 stages), every piece placed.
      const t = tiers[Math.floor((stage - 1) / 20)];
      if (pieces.length !== t[0] * t[1] || !pieces.every(p => p.done)) { log(`Stage ${stage}: finished board does not match the stage (${pieces.length} pieces); not reported.`); return; }
      report = { gameId: s.gameId, stage, state: '' };
      log(`Stage ${stage}: board complete (${pieces.length} pieces, ${elapsed} s on their clock); reporting the clear.`);
      send(report);
      PJFit();
    }
    if (report.state !== 'ok') el('nextStage').hidden = true;
  };

  /* ── time limit: 残り m:ss in their life row; at 0 the board is saved and the player goes back to TOP ── */
  const timer = document.createElement('span');
  timer.className = 'pjgb-time'; timer.hidden = true; timer.setAttribute('aria-live', 'off');
  const lifeBox = document.querySelector('.life-row [data-life-balance]'); if (lifeBox) lifeBox.after(timer);
  const fmt = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  let overGameId = null;
  const blocked = () => !!(gameSession && overGameId === gameSession.gameId && !complete());
  const theirDown = canvas.onpointerdown;
  canvas.onpointerdown = function (e) { if (blocked()) { e.preventDefault(); return; } return theirDown.call(this, e); };
  function timeUp(s) {
    overGameId = s.gameId;
    save(); gb().timeUp(s.gameId);
    log(`Stage ${stage}: attempt time limit reached; board saved, back to TOP.`);
    notice('制限時間になりました。盤面はこの端末に保存されています。\nTOPの「START」から、続きの盤面で新しい挑戦を始められます（ライフ1）。',
      () => { if (stage !== null && !el('game').hidden) el('back').click(); });
  }
  setInterval(() => {
    const s = gameSession, a = s && s.mode === 'gamebull' && gb().attempt(s.gameId);
    const on = !!(a && started && stage === a.stage && !el('game').hidden && !complete() && !a.clearBody);
    timer.hidden = !on;
    if (!on) return;
    const left = a.ended ? 0 : gb().remainingMs(s.gameId);
    timer.textContent = '残り ' + fmt(left);
    timer.classList.toggle('pjgb-low', left <= 60000);
    if (left <= 0 && overGameId !== s.gameId) timeUp(s);
  }, 250);

  /* ── the all-clear voucher (their <dialog> look; the dialog is in the top layer, trap W16) ── */
  const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; } };
  function showReward(reward) {
    log('All-clear reward: ' + reward.status + '.');
    if (reward.status === 'NONE_CONFIGURED') return;
    const text = { ISSUED: 'ギフト券が発行され、GameBullのクーポン一覧に入りました。', ALREADY_CLAIMED: 'この店舗の特典はすでに受け取り済みです。',
      OUT_OF_STOCK: '特典は一時的に在庫切れです。後でGameBullアプリのゲーム画面から受け取れます。' }[reward.status] ?? '特典の状態はGameBullでご確認ください。';
    const h = document.createElement('h2'); h.textContent = reward.title || '全ステージ達成特典';
    const nodes = [h, para('全600ステージ達成、おめでとうございます！'), para(text)];
    if (reward.benefit) nodes.push(para(reward.benefit));
    const img = safeUrl(reward.imageUrl);
    if (img) { const im = new Image(); im.alt = reward.title || '全ステージ達成特典'; im.referrerPolicy = 'no-referrer'; im.src = img.href; nodes.push(im); }
    const buttons = [];
    const redeem = reward.status === 'ISSUED' && safeUrl(reward.redeemUrl);
    if (redeem) buttons.push({ label: 'GameBullでギフト券を開く', primary: true, run: () => {
      // Inside the app the frame has no allow-popups: close the game and let the app open the coupon
      // (gamebull-whitelabel d85807c honours to: /coupons/<id>). Outside the app, open the wallet link. Not
      // window.open: their game.js declares a global function open() (their game screen), which replaces it.
      const m = /^\/coupons\/[^/?#]+$/.exec(redeem.pathname);
      if (closeToGameBull(m ? m[0] : undefined)) return;
      const a = document.createElement('a'); a.href = redeem.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    } });
    buttons.push({ label: '閉じる', primary: !redeem });
    showDialog(nodes, buttons);
  }

  /* ── start-up check: a launch that cannot play says so, with a way back to GameBull ── */
  gb().check().then(c => log(`Progress ${c.stageMode.highestCleared} / 600, ${gb().lives} Lives.`)).catch(e => {
    log('Start-up message: ' + e.message);
    if (e.code === 'network') return; // their START tries again
    const buttons = gb().embedded ? [{ label: 'GameBullに戻る', primary: true, run: () => closeToGameBull() }, { label: '閉じる' }] : [{ label: 'OK', primary: true }];
    showDialog([para(e.message)], buttons);
  });
  // A clear whose answer was lost before a reload is sent again now (same report), so their stage list is right.
  gb().check().then(() => gb().settlePendingClears()).catch(() => { /* their next START sends it again */ });

  /* ── fit to the GameBull window: no scrolling, full width, at scale 1 ──────────────────────────────────────────
   * Their page is a scrolling document: the TOP is one 9:16 picture at full width (941x1672, up to 620 px wide), the
   * game screen a brand header, stage bar, life row, toolbar, status and help line above a 1200x1450 canvas (the
   * frame on top, the piece tray below). Scaling the whole page (PONTE builds 3-4) squeezed it and left side bars in
   * the short GameBull window, so their page stays at the phone's width and only layout is set, by one stylesheet
   * of ours (their files unchanged), recomputed on every screen change and resize:
   *  - TOP: when the picture is taller than the window, it gets narrower (centred on their white paper), so START,
   *    ステージ選択 and 遊び方 (their buttons placed over the picture in %) stay on it;
   *  - game screen: when it does not fit, their brand header goes on one line, their toolbar on one row with their
   *    BGM button in a 4th slot, spacing gets tighter, then the canvas gets the height left above their footer (same
   *    1200:1450 shape, centred). Their canvas maps taps through its own getBoundingClientRect, so play follows;
   *  - a finished board: their 完成！ message, the GameBull clear line and their 次のステージへ sit over the empty piece
   *    tray of the canvas instead of below it.
   * The loading page (loader.ts) scales the frame only if something still cannot fit (e.g. a short landscape). */
  const fitStyle = document.createElement('style'); fitStyle.id = 'pjgb-fit'; document.head.appendChild(fitStyle);
  // BGM_ROW: their fixed BGM button (bottom right, 44 px) and their footer under the canvas, in their layout.
  const ART = 1672 / 941, BOARD = 1450 / 1200, BGM_ROW = 60, BGM_COL = innerWidth < 350 ? 64 : 78;
  // The GameBull app's expanded view (its "max" button) draws Done (top left) and its collapse button (top right) over
  // the game frame (gamebull-whitelabel game-overlay-controls.tsx ImmersiveControls: 44 px tall, 4 px from the top and
  // sides; Done about 62 px wide in English). The game is not told which view is on, so these two corners are kept
  // clear of their content in every view (QA IMG_6677 / IMG_6678: the signature, header and ライフ pill were under them).
  // Screen pixels: when loader.ts scales the frame (short landscape), the band is larger in their page's pixels.
  const APP_TOP = 54, APP_LEFT = 72, APP_RIGHT = 56;
  const frameScale = () => { try { const f = window.frameElement; return f && f.offsetWidth ? f.getBoundingClientRect().width / f.offsetWidth || 1 : 1; } catch { return 1; } };
  const appTop = () => Math.ceil(APP_TOP / frameScale()), appLeft = () => Math.ceil(APP_LEFT / frameScale());
  // Compact game screen (short windows): their brand header stacked small between the app's corners, one toolbar row with their BGM button in a
  // 4th slot (so the canvas can reach down to their footer), their help line on one line, tighter spacing.
  const COMPACT = () => `body:not(.at-home) .game-brand{min-height:${appTop()}px!important;box-sizing:border-box!important;padding:3px ${appLeft()}px 3px!important;gap:0!important;
    flex-direction:column!important;justify-content:center!important;align-items:center!important}
  body:not(.at-home) .signature{font-size:19px!important;line-height:1.2!important}
  body:not(.at-home) .game-brand .photography{font-size:8px!important;letter-spacing:2px!important}
  body:not(.at-home) .brand-rule{margin-top:0!important;font-size:8px!important;letter-spacing:2px!important}
  body:not(.at-home) .brand-rule::before,body:not(.at-home) .brand-rule::after{display:none!important}
  body:not(.at-home) main{margin-top:4px!important}
  .stagebar{padding:2px 0 6px!important;margin-bottom:6px!important;height:28px!important;box-sizing:border-box!important;flex-wrap:nowrap!important}
  .stagebar strong,.stagebar span{white-space:nowrap!important}
  .life-row{margin:4px 0 6px!important;height:32px!important;flex-wrap:nowrap!important}
  .life-row #saveStatus{line-height:1.2!important;max-height:28px!important;overflow:hidden!important}
  .toolbar{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr)) ${BGM_COL}px!important;padding:6px!important;gap:6px!important}
  .toolbar::after{content:'';grid-column:4;grid-row:1;min-height:40px}
  .toolbar #back{grid-column:1!important;grid-row:1!important}.toolbar #saveExit{grid-column:2!important;grid-row:1!important}
  .toolbar #restart{grid-column:3!important;grid-row:1!important}
  .toolbar button{min-height:40px!important;padding:6px 2px!important;font-size:clamp(10px,3.3vw,12px)!important;white-space:nowrap!important;letter-spacing:0!important}
  .status{margin-top:6px!important;padding:0 12px!important;height:36px!important;box-sizing:border-box!important;align-items:center!important}
  .help{margin:2px 0 6px!important;padding:2px 0!important;line-height:1.5!important;font-size:10px!important;letter-spacing:0!important}
  body:not(.at-home) footer{padding:3px 12px 4px!important;font-size:9px!important}`;
  // Below this canvas height the page is laid out taller than the window and loader.ts scales the frame (landscape).
  const MIN_BOARD_H = 220;
  const board = canvas;
  const visible = n => !!n && n.getClientRects().length > 0 && n.offsetHeight > 0;
  const pageHeight = () => document.documentElement.scrollHeight;
  // TOP: a band of their white paper above their picture, under the app's corners; their ライフ pill sits in its middle.
  const TOP_BAND = () => `body.at-home main{padding-top:${appTop()}px!important}
    body.at-home .home-lives{top:${-appTop() / 2}px!important;left:50%!important;right:auto!important;transform:translate(-50%,-50%)!important}`;
  function fitHome() {
    const art = document.querySelector('.home-art');
    if (!art) return '';
    // Their buttons over the picture hold transparent text that spills out of a short button (遊び方 at 2.6 % of the
    // picture's height) and made the page taller than the window in landscape: font-size 0, nothing visible changes
    // (the text stays their accessible name).
    let rule = 'body.at-home .art-control{font-size:0!important}' + TOP_BAND();
    fitStyle.textContent = rule;
    // Their picture at full width first; if the page is taller than the window, narrower by the overflow.
    for (let i = 0; i < 3 && pageHeight() > innerHeight + 0.5; i++) {
      const w = art.getBoundingClientRect().width, extra = pageHeight() - innerHeight;
      // Their progress text is sized from the window width (clamp(11px,2.7vw,16px)), which is the picture's width on
      // their full-width phone layout: on a narrowed picture it follows the picture instead, as they meant it.
      const nw = Math.max(200, Math.floor(w - extra / ART)), font = Math.min(16, Math.max(9, nw * 0.027));
      rule = `body.at-home .art-control{font-size:0!important}${TOP_BAND()}body.at-home main{max-width:${nw}px!important;margin:0 auto!important}
        body.at-home .home-progress{font-size:${font.toFixed(1)}px!important;letter-spacing:${nw < 300 ? 1 : 2}px!important;gap:${nw < 300 ? 3 : 6}px!important}
        body.at-home .home-lives{font-size:9px!important;padding:5px 8px!important}`; // their phone size of the ライフ pill
      fitStyle.textContent = rule;
    }
    return rule;
  }
  function fitGame() {
    // Their body keeps 65 px under the page for their fixed BGM button; the window is fixed, so it only makes the
    // page taller than the window. Their message line (画像を読み込んでいます… while a photo loads, 完成！ at the end),
    // the GameBull clear line and their 次のステージへ are laid over the canvas's empty piece tray, out of the flow,
    // before measuring: the canvas keeps one size through a stage (a loading line under it shrank it for a moment).
    // On the tray they sit on a light card in their paper colour, so they read over the picture on a small canvas.
    // (top:0 while measuring: out of the flow, but still part of the page height where they would sit.)
    let rule = `body:not(.at-home){padding-bottom:0!important}
      #game{position:relative}#message,.pjgb-clear,#nextStage{position:absolute!important;top:0;left:0;right:0;z-index:2;margin:0 auto!important;
        width:max-content!important;max-width:94%;box-sizing:border-box}
      #message:empty{display:none!important}
      #message,.pjgb-clear{background:#fafcfdeb;border-radius:10px;padding:2px 12px!important;box-shadow:0 2px 10px #30475d14}
      #message{font-size:clamp(14px,4.6vw,20px)!important;text-align:center}`;
    fitStyle.textContent = rule;
    // Their layout fits when the whole page is in the window and their BGM button (fixed, bottom right) is below the canvas.
    if (pageHeight() > innerHeight + 0.5 || board.getBoundingClientRect().bottom + BGM_ROW > innerHeight + 0.5) {
      rule += COMPACT(); fitStyle.textContent = rule;
      const t = document.querySelector('.toolbar').getBoundingClientRect();
      rule += `.bgm-toggle{position:fixed!important;left:${Math.round(t.right - 6 - BGM_COL)}px!important;top:${Math.round(t.top + 6)}px!important;right:auto!important;bottom:auto!important;
        width:${BGM_COL}px!important;height:${Math.round(t.height - 12)}px!important;min-height:0!important;padding:0 2px!important;font-size:${BGM_COL < 78 ? 10 : 11}px!important;
        white-space:nowrap!important;letter-spacing:0!important;border-radius:10px!important;box-shadow:none!important}`;
      // The canvas takes the height left above what follows it (their footer), same 1200:1450 shape, centred.
      const c = board.getBoundingClientRect(), after = pageHeight() - (c.bottom + scrollY);
      const h = Math.max(MIN_BOARD_H, Math.floor(innerHeight - c.top - after - 1));
      if (h < c.height) rule += `#board{width:${Math.floor(h / BOARD)}px!important;margin:0 auto!important}`;
      fitStyle.textContent = rule;
    }
    {
      // Over the empty piece tray (their tray starts at 935 of 1450): the lines shown, stacked and centred in it; on a
      // small canvas they start higher, so they end inside the canvas. Lines that appear later start at the tray top.
      const game = el('game').getBoundingClientRect(), c = board.getBoundingClientRect();
      const parts = [el('message'), line, el('nextStage')].filter(visible), gap = 6;
      const total = parts.reduce((a, p) => a + p.offsetHeight, 0) + gap * Math.max(0, parts.length - 1);
      const trayTop = c.top - game.top + c.height * 935 / 1450, tray = c.height * (1 - 935 / 1450);
      rule += `#message,.pjgb-clear,#nextStage{top:${Math.round(trayTop + 6)}px}`;
      let y = Math.round(total <= tray - 8 ? trayTop + (tray - total) / 2 : c.bottom - game.top - total - 6);
      for (const p of parts) { rule += `${p.id ? '#' + p.id : '.pjgb-clear'}{top:${y}px}`; y += p.offsetHeight + gap; }
    }
    return rule;
  }
  let lastFit = '';
  function PJFit() {
    fitStyle.textContent = '';                                   // their own layout first, then measure it
    const rule = document.body.classList.contains('at-home') || el('game').hidden ? fitHome() : fitGame();
    fitStyle.textContent = rule;
    if (rule === lastFit) return;
    lastFit = rule;
    const w = /max-width:(\d+)px/.exec(rule), b = /#board\{width:(\d+)px/.exec(rule);
    log(`Fit ${innerWidth}x${innerHeight}: ${w ? `TOP picture ${w[1]} px wide` : b ? `canvas ${b[1]}x${Math.round(b[1] * BOARD)}` : 'their layout'}` +
      `${rule.includes('game-brand') ? ', compact header and toolbar' : ''}${complete() ? ', finished-board lines over the tray' : ''}.`);
  }
  window.PJFit = PJFit;                                          // also called by loader.ts before it measures
  addEventListener('resize', PJFit);
  new MutationObserver(() => PJFit()).observe(el('game'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(() => PJFit()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  PJFit();

  /* ── loading page down once their TOP picture is in ── */
  const progress = p => { try { window.parent.gbLoaderProgress && window.parent.gbLoaderProgress(p); } catch { /* not in our frame */ } };
  let signalled = false;
  const done = () => { if (signalled) return; signalled = true; PJFit(); try { window.parent.gbLoaderDone && window.parent.gbLoaderDone(); } catch { /* not in our frame */ } };
  const art = document.querySelector('.home-art');
  if (!art || (art.complete && art.naturalWidth)) { progress(1); done(); }
  else { art.addEventListener('load', () => { progress(1); done(); }, { once: true }); art.addEventListener('error', done, { once: true }); }
  setTimeout(done, 15000); // never keep the loading page up on a picture that will not come

  /* ── iPhone: Web Audio plays with the silent switch on (trap W2); their bgm.js starts on the same tap ── */
  document.addEventListener('pointerdown', () => { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* n/a */ } }, { capture: true, once: true });

  /* ── their music on from the first tap anywhere (QA: "music should not be off by default"), one-language label ──
   * Their bgm.js is ON by default but starts only on START / 次のステージへ / ステージで遊ぶ or their BGM button, so the
   * TOP stayed silent under 「♫ BGM 待機」. Browsers allow sound only inside a tap, so on the player's first tap
   * anywhere their own BGM button is pressed for them (their start(), their label, their saved choice). Not when the
   * player turned it off (their 「BGM OFF」, saved by their code), not when it already plays, and not when the tap is on
   * their BGM button itself (their own click does it). pointerup / touchend / keydown: the events browsers count as
   * a tap for audio (a touch pointerdown is not one on iPhone). */
  const bgm = el('bgmToggle');
  /* Their button label mixes languages: 「♫ BGM 待機」 (Japanese: on, waiting for a tap) until their music plays, then
   * 「♫ BGM ON」 / 「♫ BGM OFF」 (QA: "Japanese at first, English as soon as the game starts"). Their music now starts
   * on any first tap, so 待機 only means "on, about to play": their own 「♫ BGM ON」 is shown for it (and for their
   * 「♫ タップしてBGM」, the same state after a refused start). A tap on the button in that state starts the music in
   * their code (enabled, not active), the same as ON should. Their label() writes button.textContent: this instance
   * property shows the mapped text and keeps their real label for the checks below. */
  const NATIVE = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  let theirLabel = bgm ? bgm.textContent : '';
  const shown = v => /待機|タップしてBGM/.test(v) ? '♫ BGM ON' : v;
  if (bgm && NATIVE) {
    Object.defineProperty(bgm, 'textContent', { configurable: true, get() { return NATIVE.get.call(this); },
      set(v) { theirLabel = String(v); NATIVE.set.call(this, shown(theirLabel)); } });
    bgm.textContent = theirLabel;
  }
  const waiting = () => /待機|タップしてBGM/.test(theirLabel); // their setting ON, their music not playing yet
  let pressedAt = 0;
  // On every tap (also after the app comes back from the background, when a browser may hold their music until a
  // tap): if their setting is ON and their music is not playing, their own button is pressed inside that tap.
  const startMusic = e => {
    if (!bgm || !waiting() || (e && e.target && e.target.closest && e.target.closest('#bgmToggle'))) return;
    // One touch sends touchend and pointerup; their start() is async, so a second press would turn it off again.
    if (Date.now() - pressedAt < 2000) return;
    pressedAt = Date.now();
    log('Tap: their BGM starts (setting ON, not playing yet).');
    bgm.click();
  };
  for (const t of ['pointerup', 'touchend', 'keydown']) document.addEventListener(t, startMusic, true);
})();
