(() => {
  const $ = id => document.getElementById(id);
  let player = null, busy = false, inGame = false, saving = null;
  const local = location.protocol === 'file:';
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const queueKey = id => 'boo-pending-' + id;
  const pending = () => player ? read(queueKey(player.id), []) : [];
  function status(text, error = false) { $('cloud-status').textContent = text; $('cloud-status').classList.toggle('error', error); }
  async function api(body) {
    const response = await fetch('/api/player', { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '雲端暫時無法連線。');
    return result;
  }
  function render() {
    $('player-name').textContent = player ? player.nickname : '訪客';
    $('player-change').textContent = player ? '切換玩家' : '登入記錄';
    $('player-change').disabled = inGame || busy || Boolean(saving);
    $('record-games').textContent = player?.total_games || 0;
    $('record-hits').textContent = player?.total_hits || 0;
    $('record-best').textContent = player?.best_score || 0;
    $('history-list').replaceChildren();
    for (const run of player?.runs || []) {
      const item = document.createElement('li');
      const when = document.createElement('time');
      when.dateTime = run.created_at;
      when.textContent = new Date(run.created_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const points = document.createElement('strong');
      points.textContent = `${run.score.toLocaleString()} 分`;
      const details = document.createElement('span');
      details.textContent = `捕捉 ${run.hits} · 誤擊 ${run.penalties}`;
      item.append(when, points, details); $('history-list').append(item);
    }
    $('history-empty').hidden = Boolean(player?.runs?.length);
    const best = player ? Math.max(player.best_score, 0, ...pending().map(run => run.score)) : null;
    window.dispatchEvent(new CustomEvent('boo-profile', { detail: { best } }));
  }
  function openLogin() {
    if (inGame || busy || saving) return;
    $('login-error').textContent = '';
    $('nickname').value = player?.nickname || read('boo-last-nickname', '');
    $('player-password').value = '';
    $('login-dialog').showModal();
    $('nickname').focus();
  }
  async function sync() {
    if (!player || saving) return saving;
    saving = (async () => {
      const id = player.id;
      while (player?.id === id) {
        const queue = read(queueKey(id), []);
        if (!queue.length) break;
        const result = await api({ action: 'save', ...queue[0] });
        // Read again so a just-finished game is never lost during a retry.
        write(queueKey(id), read(queueKey(id), []).filter(run => run.ticket !== queue[0].ticket));
        player = result.player; render();
      }
      status('已同步到 Supabase，下次回來紀錄還在');
    })().catch(error => { status(`尚有紀錄待同步：${error.message}`, true); }).finally(() => { saving = null; render(); });
    render();
    return saving;
  }
  $('player-change').onclick = openLogin;
  $('show-records').onclick = () => { render(); $('records-dialog').showModal(); };
  $('close-records').onclick = () => $('records-dialog').close();
  $('close-login').onclick = () => $('login-dialog').close();
  $('retry-sync').onclick = async () => {
    if (!player) { openLogin(); return; }
    try { status('正在同步…'); await sync(); } catch { status('雲端連線失敗，請稍後重試。', true); }
  };
  $('login-form').onsubmit = async event => {
    event.preventDefault();
    if (busy || inGame || saving) return;
    busy = true; $('login-submit').disabled = true; $('login-error').textContent = '';
    try {
      if (local) throw new Error('雲端紀錄請使用線上遊戲網址開啟。');
      // Password is intentionally not included in the request.
      const result = await api({ action: 'login', nickname: $('nickname').value });
      player = result.player; write('boo-last-nickname', player.nickname);
      $('player-password').value = ''; $('login-dialog').close(); render();
      status('玩家紀錄已載入'); await sync();
    } catch (error) { $('login-error').textContent = error.message; }
    finally { busy = false; $('login-submit').disabled = false; render(); }
  };
  $('start').disabled = true;
  const ready = (async () => {
    if (local) { status('本機遊玩模式；雲端紀錄請開啟線上版'); return; }
    try {
      const result = await api(); player = result.player; render();
      if (player) { status('歡迎回來，紀錄已恢復'); await sync(); }
      else status('登入暱稱，就能保存每次挑戰紀錄');
    } catch (error) { status(error.message, true); }
  })().finally(() => { $('start').disabled = false; });
  window.BooPlayers = {
    ready,
    begin() {
      inGame = true; render();
      if (!player || local) return Promise.resolve(null);
      const owner = player.id;
      // A rejected request is handled immediately to avoid unhandled promises mid-game.
      return api({ action: 'begin' }).then(result => ({ ticket: result.ticket, owner })).catch(() => { status('本局未連上雲端，成績只能保存在本機', true); return null; });
    },
    async finish(ticketPromise, data) {
      const run = await ticketPromise;
      inGame = false; render();
      if (!run || !player || run.owner !== player.id) { status('本局為訪客或離線挑戰，未存入雲端'); return; }
      const entry = { ticket: run.ticket, ...data };
      const queue = read(queueKey(run.owner), []);
      if (!queue.some(item => item.ticket === run.ticket)) queue.push(entry);
      if (!write(queueKey(run.owner), queue)) {
        try { const result = await api({ action: 'save', ...entry }); player = result.player; render(); status('已同步到 Supabase'); }
        catch { status('未能儲存這局，瀏覽器儲存空間與雲端皆無法使用', true); }
        return;
      }
      render(); status('正在保存本次挑戰…'); await sync();
    },
    best() { return player ? Math.max(player.best_score, 0, ...pending().map(run => run.score)) : null; }
  };
  window.addEventListener('online', () => { if (player) sync(); });
})();
