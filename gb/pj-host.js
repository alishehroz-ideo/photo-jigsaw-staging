'use strict';
/* PHOTO JIGSAW: window.GameBullBridge on the real GameBull Stage Mode API.
 *
 * The client's own host boundary (their GameBull引き継ぎ仕様.txt): their gamebull.js, in mode 'gamebull', calls
 * window.GameBullBridge.getLives() and beginGame({game, stage, version, requestId, resumeGameId}) and checks every
 * answer ({lives}, {gameId, lives}). Their contract was a proposal, not a GameBull API, so this file maps it onto the
 * API the other Stage Mode games use (gamebull-whitelabel ADR-0086, contracts/stage-mode.ts; the Stance, Himi Kiju,
 * Yukiya and PONTE ports):
 *
 *   getLives        GET  /play/games/{gameId}/context?tenantSlug   (Bearer bootToken) -> lives.count
 *   beginGame       POST /play/plays {bootToken, stage}            1 Life on the server (PAID: the next stage, also
 *                                                                   for their やり直す); a cleared stage is a
 *                                                                   FREE_REPLAY when the admin allows it
 *     resumeGameId  the running attempt is reused, no Life (their rule: resuming a saved board is free)
 *   (clear)         their game reports a finished board to nobody; gb/pj-hooks.js calls completeStage below:
 *                   POST /play/stage-clears {sessionToken, playTimeMs} -> status, progress, the all-clear reward
 *   saveProgress    not defined: GameBull has no endpoint for it; their own code then keeps the board in this browser
 *
 * Their config ships mode:'demo' (5 test lives in the browser). Their spec says to switch it to 'gamebull'; this file
 * does that by setting window.GAMEBULL_CONFIG after their gamebull-config.js (their file unchanged).
 *
 * What their contract asks that the API does not have, and what this file does instead:
 *  - idempotent beginGame per requestId: the API has no idempotency key. Each answer is kept per requestId in
 *    sessionStorage (with its play token, never in their storage), so a resend of the same requestId gets the same
 *    attempt with no Life; a call still in flight is awaited, not sent again. A start whose answer was lost (network /
 *    5xx) is never re-sent: the player is told a Life may have been used, and their next START is a new entry;
 *  - free resume at any time: GameBull requires a time per attempt (maxAttemptSeconds, at most 3540 s) and the play
 *    token lives 1 h. A saved board whose attempt is over (time limit, another tab or device) stays on their board,
 *    but playing it again is a new attempt (1 Life); the player is told before that Life is used;
 *  - server checks of lives, stage, gameId: the server owns them (lives.count, nextStage, the play token).
 * Lives are never counted here: the balance is the server's (/context lives.count).
 */
(function () {
  const ENV = window.PJ_GB || {};
  const TOTAL = 600; // their game: game.js hard-codes 600 stages (30 tiers x 20)
  const log = (...a) => console.log('[PJ-GB]', ...a);

  // Their spec: "本番では mode: 'gamebull' に変更します". Their file stays as delivered; their gamebull.js reads this.
  window.GAMEBULL_CONFIG = Object.assign({}, window.GAMEBULL_CONFIG, { mode: 'gamebull' });

  const q = new URLSearchParams(location.search);
  // The GameBull app launches with ?tenantSlug&bootToken&gameId&returnUrl&apiBase (use-launch-game.ts); the other
  // ports' SDK also accepts sessionToken / token, in that order (playbook section 2).
  const token = q.get('bootToken') || q.get('sessionToken') || q.get('token') || '';
  const tenant = q.get('tenantSlug') || '';
  const api = ((ENV.dev && q.get('devApi')) || ENV.apiBase || '').replace(/\/+$/, '');
  const jwtPayload = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
  const player = (jwtPayload(token) || {}).globalUserId || 'unknown';
  const KEY = 'pj-gb:v1:' + tenant + ':' + ENV.gameId + ':' + player;

  class StageError extends Error { constructor(code, message) { super(message); this.name = 'StageError'; this.code = code; } }
  // Server codes -> Japanese for their alert (shown by gb/pj-hooks.js in a page dialog). Their own wording where they
  // have one (gamebull.js: 'テスト用ライフがありません。'), else the wording of the other Stage Mode screens.
  const MESSAGES = {
    'play.no_lives': 'ライフがありません。GameBullでライフをご確認ください。',
    'stage.daily_limit_reached': '本日の挑戦回数の上限に達しました。進行状況はGameBullに保存されています。',
    'stage.stage_not_playable': 'このステージはまだ遊べません。TOPの「START」から続きのステージを始めてください。',
    'stage.all_cleared': '全600ステージ達成済みです。特典はGameBullでご確認ください。',
    'stage.stage_required': 'ステージ番号の送信に問題があります。開発者へお問い合わせください。',
    'stage.play_token_required': '参加情報を確認できません。もう一度「START」を押してください。',
    'play.session_token_expired': '参加の有効期限が切れました。もう一度「START」を押してください。',
    'play.session_token_invalid': 'GameBullへの接続に失敗しました。GameBullのゲーム画面から開き直してください。',
    'guest.session_invalid': 'GameBullへの接続に失敗しました。GameBullのゲーム画面から開き直してください。',
    'stage.score_not_accepted': 'クリア報告の設定に問題があります。開発者へお問い合わせください。',
    'play.mode_not_enabled': 'このゲームのステージモードをGameBull側で有効にしてください。'
  };
  const fail = (code, message) => new StageError(code, message || MESSAGES[code] || 'GameBullへの接続に失敗しました。');

  /* ── storage (sessionStorage, this tab only; the play token never goes into their storage) ── */
  const blank = () => ({ attempts: {}, starts: {}, renew: {} });
  let store = blank();
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && s.attempts && s.starts) store = Object.assign(blank(), s); } catch { /* private mode */ }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };

  /* ── server ── */
  let n = 0, ctx = null;
  async function request(path, { method = 'GET', body, bearer } = {}) {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 15000);
    const headers = { Accept: 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (body) headers['Content-Type'] = 'application/json';
    // GETs are cache-busted with a unique URL (a cached /context showed lives one play behind, playbook section 3).
    const url = api + path + (method === 'GET' ? (path.includes('?') ? '&' : '?') + '_ts=' + Date.now() + '-' + (++n) : '');
    let response, data;
    try {
      response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: abort.signal,
        cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    } catch { throw fail('network', '通信結果を確認できませんでした。接続を確認してください。'); }
    finally { clearTimeout(timeout); }
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      // Codes arrive nested ({error:{code}}) or top-level ({code}) (playbook section 3, error shapes).
      const code = (data && data.error && data.error.code) || (data && typeof data.code === 'string' && data.code) || 'http_' + response.status;
      const e = fail(code, MESSAGES[code] || (response.status >= 500 ? 'GameBullへの接続に失敗しました。時間をおいてお試しください。' : 'GameBullへの接続に失敗しました。'));
      e.httpStatus = response.status; throw e;
    }
    if (!data || typeof data !== 'object') throw fail('bad_response', 'GameBullからの応答を確認できませんでした。');
    return data;
  }

  async function refresh() {
    if (!api) throw fail('not_configured', 'GameBullの接続先が未設定です。開発者に接続設定を依頼してください。');
    if (!token || !tenant) throw fail('launch_required', 'GameBullのゲーム画面から開いてください。');
    const data = await request('/play/games/' + encodeURIComponent(ENV.gameId) + '/context?tenantSlug=' + encodeURIComponent(tenant), { bearer: token });
    const m = data.stageMode;
    // stageMode is sent only for a "Play Stage Mode" launch (boot token mode STAGE_CLEAR); "Game Start" gets null.
    if (!m) throw fail('stage_mode_required', 'このゲームはステージモードで遊べます。GameBullのゲーム画面の「Play Stage Mode」から開いてください。');
    const h = m.highestCleared;
    if (m.totalStages !== TOTAL) throw fail('bad_context', 'GameBullのステージ数が600ではありません（' + m.totalStages + '）。管理者に確認してください。');
    if (!Number.isInteger(h) || h < 0 || h > TOTAL || (h >= TOTAL ? m.nextStage !== null : m.nextStage !== h + 1) || !(m.maxAttemptSeconds > 0))
      throw fail('bad_context', 'ステージ情報がゲームと一致しません。管理者に確認してください。');
    const first = !ctx;
    ctx = data;
    if (first) log(`Build v${ENV.build}. /context has stageMode (cleared ${h}/${m.totalStages}, next ${m.nextStage}, ` +
      `${m.maxAttemptSeconds} s per attempt, free replays ${m.freeReplays ? 'on' : 'off'}, daily limit ${m.dailyAttemptLimit ?? 'none'}), ${lives()} Lives.`);
    dispatchEvent(new CustomEvent('pj-gb:context', { detail: data }));
    return data;
  }
  const lives = () => { const c = ctx && ctx.lives && ctx.lives.count; return Number.isInteger(c) && c >= 0 ? c : 0; };

  /* ── attempts ── */
  function live(a) {
    if (!a || a.ended || a.result || a.clearBody) return false;
    const exp = jwtPayload(a.token);
    return !!exp && exp.exp * 1000 > Date.now() && Date.now() < a.deadline;
  }
  function close(a, why) {
    if (!a || a.ended) return;
    a.ended = true; save(); log(`Attempt ${a.attemptId} (stage ${a.stage}) closed (${why}).`);
  }
  function prune() {
    const ids = Object.keys(store.attempts).sort((x, y) => store.attempts[x].startedAt - store.attempts[y].startedAt);
    for (const id of ids.slice(0, Math.max(0, ids.length - 30))) delete store.attempts[id];
    const keys = Object.keys(store.starts); for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete store.starts[k];
    const renew = Object.keys(store.renew); for (const k of renew.slice(0, Math.max(0, renew.length - 50))) delete store.renew[k];
  }
  const receipt = a => ({ gameId: a.attemptId, lives: lives() });

  // A clear the server has not confirmed yet (lost answer) is sent again before anything else: their own page has
  // already moved on to the next stage locally (their draw() unlocks it), so the server must catch up first.
  async function settlePendingClears() {
    for (const a of Object.values(store.attempts)) {
      if (!a.clearBody || a.result) continue;
      const r = await sendClear(a);
      if (!r.ok) throw fail(r.code || 'clear_pending', 'ステージ' + a.stage + 'のクリア記録をGameBullに送信できませんでした。通信を確認して、もう一度お試しください。');
    }
  }

  const inflight = new Map();
  function beginGame(input) {
    const key = input && input.requestId;
    if (typeof key !== 'string' || !key) return Promise.reject(fail('bad_request', '開始情報を確認できません。'));
    if (inflight.has(key)) return inflight.get(key);
    const p = begin(input).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function begin({ stage, requestId, resumeGameId }) {
    if (!Number.isInteger(stage) || stage < 1 || stage > TOTAL) throw fail('bad_request', '開始情報を確認できません。');
    await refresh();
    await settlePendingClears();
    const m = ctx.stageMode;

    // Their rule: resuming a saved board is free. The same running attempt is reused (no Life): by gameId (their
    // saved session) or by requestId (the same start sent again).
    const byGame = resumeGameId && store.attempts[resumeGameId];
    const prior = store.starts[requestId], byRequest = prior && prior.attemptId && store.attempts[prior.attemptId];
    for (const a of [byGame, byRequest]) if (a && a.stage === stage && live(a)) {
      store.starts[requestId] = { attemptId: a.attemptId }; save();
      log(`Stage ${stage}: running attempt ${a.attemptId} reused (no Life), ${Math.round((a.deadline - Date.now()) / 1000)} s left.`);
      return receipt(a);
    }
    const replay = m.nextStage === null || stage < m.nextStage;
    if (!replay && stage > m.nextStage) throw fail('stage.stage_not_playable');
    if (replay && !m.freeReplays) throw fail('replay_off', m.nextStage === null ? MESSAGES['stage.all_cleared']
      : 'ステージ' + stage + 'はクリア済みです。GameBullのステージモードでは、クリア済みステージは遊べません。TOPの「START」から続きのステージ' + m.nextStage + 'へ進んでください。');

    // A saved board whose attempt is over (time limit, token expired, another tab or device): the board stays, but a
    // new attempt costs a Life. Told once; the next START (same saved game) is the new entry.
    if (resumeGameId && !replay && !store.renew[resumeGameId]) {
      store.renew[resumeGameId] = true; prune(); save();
      log(`Stage ${stage}: saved game ${resumeGameId} has no running attempt here; the player is asked before a new entry.`);
      throw fail('attempt_over', 'この盤面の挑戦時間は終了しています。もう一度「START」を押すと、保存した盤面の続きから新しい挑戦を始めます（ライフ1）。');
    }

    // A requestId whose earlier answer was lost (store.starts[key].lost) gets a new entry here: the player was told.
    let data;
    try { data = await request('/play/plays', { method: 'POST', body: { bootToken: token, stage } }); }
    catch (e) {
      if (e.code === 'network' || e.httpStatus >= 500) {
        // No idempotency key on this call: an unknown answer is never re-sent. Their next START is a new entry.
        store.starts[requestId] = { lost: true }; prune(); save();
        try { await refresh(); } catch { /* keep the message below */ }
        log(`Stage ${stage} entry answer lost (${e.code}); not re-sent.`);
        throw fail('entry_lost', '開始結果を確認できませんでした。ライフが使われた可能性があります（残りライフ ' + lives() + '）。もう一度「START」を押すと、新しい挑戦になります（ライフ1）。');
      }
      if (e.code === 'play.no_lives') { try { await refresh(); } catch { /* shown below */ } }
      log(`Stage ${stage} entry refused: ${e.code}.`);
      throw e;
    }
    const sm = data.stageMode, deadline = Date.parse(sm && sm.deadlineAt), expires = Date.parse(data.expiresAt);
    if (typeof data.playToken !== 'string' || !data.playToken || data.mode !== 'STAGE_CLEAR' || !sm || sm.stage !== stage
      || !['PAID', 'FREE_REPLAY'].includes(sm.kind) || !Number.isFinite(deadline) || !(sm.maxAttemptSeconds > 0))
      throw fail('bad_response', 'GameBullから正しい開始情報を取得できませんでした。');
    const startedAt = Date.now();
    const a = { attemptId: 'gb-' + data.playToken.slice(-12) + '-' + startedAt.toString(36), stage, token: data.playToken, kind: sm.kind,
      startedAt, limitSeconds: sm.maxAttemptSeconds,
      deadline: Math.min(deadline, Number.isFinite(expires) ? expires : Infinity, startedAt + sm.maxAttemptSeconds * 1000),
      ended: false, clearBody: null, result: null };
    // One running attempt per stage: an older one for this stage (their やり直す) is over.
    for (const o of Object.values(store.attempts)) if (o.stage === stage && !o.clearBody) close(o, 'replaced by a new attempt');
    store.attempts[a.attemptId] = a; store.starts[requestId] = { attemptId: a.attemptId };
    prune(); save();
    log(`Stage ${stage} entered (${sm.kind}${sm.kind === 'PAID' ? ', 1 Life on the server' : ', free'}), limit ${sm.maxAttemptSeconds} s.`);
    try { await refresh(); } catch { /* the entry stands; lives refresh on the next call */ }
    return receipt(a);
  }

  /* ── clear report ── */
  async function sendClear(a) {
    let data;
    try { data = await request('/play/stage-clears', { method: 'POST', body: a.clearBody }); }
    catch (e) {
      // Safe resend: the same play token and playTimeMs (the server answers a repeat with its stored verdict).
      log(`Stage ${a.stage} clear not confirmed (${e.code}); it is sent again with the same report.`);
      if (e.code === 'play.session_token_expired' || e.code === 'stage.play_token_required') {
        a.result = { status: 'TOKEN_REFUSED', stage: a.stage }; close(a, 'token refused'); return { ok: false, code: e.code, message: e.message, final: true };
      }
      return { ok: false, code: e.code, message: e.message };
    }
    if (!['CLEARED', 'ALREADY_CLEARED', 'REPLAY', 'TIME_EXCEEDED'].includes(data.status) || data.stage !== a.stage)
      return { ok: false, code: 'bad_response', message: 'クリア判定を確認できませんでした。' };
    a.result = data; close(a, 'clear ' + data.status);
    log(`Stage ${a.stage} clear: ${data.status} (${data.highestCleared}/${data.totalStages} cleared${data.reward ? ', reward ' + data.reward.status : ''}).`);
    try { await refresh(); } catch { /* the clear answer is authoritative */ }
    dispatchEvent(new CustomEvent('pj-gb:clear', { detail: data }));
    return { ok: true, result: data };
  }

  // Called by gb/pj-hooks.js when their board is complete (every piece placed). Returns
  // { ok, result } or { ok:false, message, final } (final: no resend can help).
  async function completeStage(gameId, stage) {
    const a = store.attempts[gameId];
    if (!a || a.stage !== stage) return { ok: false, final: true, message: 'この盤面はGameBullの挑戦として記録できませんでした。' };
    if (a.result) return a.result.status === 'TOKEN_REFUSED' ? { ok: false, final: true, message: MESSAGES['play.session_token_expired'] } : { ok: true, result: a.result };
    if (!a.clearBody) {
      if (a.ended) return { ok: false, final: true, message: 'この挑戦は終了しています。' };
      a.clearBody = { sessionToken: a.token, playTimeMs: Math.max(0, Date.now() - a.startedAt) };
      save();
    }
    return sendClear(a);
  }

  window.GameBullBridge = {
    async getLives() { await refresh(); return { lives: lives() }; },
    beginGame
    // saveProgress: not offered (no GameBull endpoint); their 保存して終了 keeps the board in this browser.
  };

  // Read by gb/pj-hooks.js (progress sync, clear report, attempt timer).
  window.PJGB = {
    get context() { return ctx; },
    get lives() { return lives(); },
    embedded: window.parent !== window,
    check: refresh,
    attempt(gameId) { return store.attempts[gameId] || null; },
    live(gameId) { return live(store.attempts[gameId]); },
    remainingMs(gameId) { const a = store.attempts[gameId]; return a ? Math.max(0, a.deadline - Date.now()) : 0; },
    // Time limit reached on screen: the next START of this saved board is a new entry straight away (the player was
    // told in the time-up dialog).
    timeUp(gameId) { const a = store.attempts[gameId]; if (a && !a.clearBody) { close(a, 'time limit'); store.renew[gameId] = true; save(); } },
    completeStage,
    settlePendingClears
  };
})();
