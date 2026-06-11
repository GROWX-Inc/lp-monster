/* AI MONSTER engine 共通部分
   config読込・タイトル/クリア画面・お知らせ表示(バナー)・モード/テーマの
   読み込みを担当する。クライアント固有の情報は一切持たず、すべて
   configs/○○.json(URLの ?config= で指定)から読み込む。

   モード = 遊び方の仕組み(engine/modes/○○.js)
     - quest : 横スクロールRPG風(タップで前進)
     - runner: 縦スクロール群衆ランナー風(自動走行+2択ゲート)
   テーマ = 見た目(engine/themes/○○.js。questモードで使用)*/

(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    var params = new URLSearchParams(location.search);
    var name = params.get('config');
    if (!name || !/^[\w-]+$/.test(name)) return showGuide('');
    var config;
    try {
      var res = await fetch('configs/' + name + '.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      config = await res.json();
    } catch (e) {
      return showGuide(name);
    }
    applyBrandColors(config);
    /* ?mode=○○ で遊び方だけ差し替えて確認できる(動作確認用プレビュー) */
    var modeName = params.get('mode') || config.mode || 'quest';
    var mode;
    try {
      mode = await loadMode(modeName);
    } catch (e) {
      mode = await loadMode('quest'); // モードが見つからない場合の予備
    }
    mode.start(config, params);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* モードは engine/modes/○○.js を後から読み込む方式 */
  async function loadMode(name) {
    window.AIM_MODES = window.AIM_MODES || {};
    if (window.AIM_MODES[name]) return window.AIM_MODES[name];
    if (!/^[\w-]+$/.test(name)) throw new Error('bad mode name');
    await loadScript('engine/modes/' + name + '.js');
    if (!window.AIM_MODES[name]) throw new Error('mode not registered: ' + name);
    return window.AIM_MODES[name];
  }

  /* テーマは engine/themes/○○.js を後から読み込む方式。
     テーマ追加時も engine 本体は無修正で済む */
  async function loadTheme(name) {
    window.AIM_THEMES = window.AIM_THEMES || {};
    if (window.AIM_THEMES[name]) return window.AIM_THEMES[name];
    if (!/^[\w-]+$/.test(name)) throw new Error('bad theme name');
    await loadScript('engine/themes/' + name + '.js');
    if (!window.AIM_THEMES[name]) throw new Error('theme not registered: ' + name);
    return window.AIM_THEMES[name];
  }

  function applyBrandColors(config) {
    var b = config.brand || {};
    var root = document.documentElement.style;
    if (b.mainColor) root.setProperty('--main', b.mainColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);
    document.title = (b.name ? b.name + ' | ' : '') + 'AI MONSTER';
  }

  /* config未指定・読み込み失敗時の案内画面 */
  function showGuide(missing) {
    $('#title-logo').innerHTML = '<span class="logo-text">AI MONSTER</span>';
    $('#title-heading').textContent = 'ゲーム化アンケートLP';
    $('#title-sub').textContent = missing
      ? '設定「' + missing + '」が見つかりませんでした。URLをご確認ください。'
      : 'URLの末尾で表示する設定を指定してください。';
    var guide = $('#guide');
    guide.innerHTML =
      '<p>例:<code>?config=cafe</code> のように指定します。</p>' +
      '<p>デモ:</p>' +
      '<ul class="demo-links">' +
      '<li><a href="?config=cafe">飲食店(カフェ)デモ</a></li>' +
      '<li><a href="?config=hotel">ホテルデモ</a></li>' +
      '<li><a href="?config=cafe-runner">カフェ・ランナー版デモ(宇宙)</a></li>' +
      '</ul>';
    guide.hidden = false;
  }

  function buildTitle(config, onStart) {
    var b = config.brand || {};
    var t = config.title || {};
    var logo = $('#title-logo');
    if (b.logoUrl) {
      var img = document.createElement('img');
      img.src = b.logoUrl;
      img.alt = b.name || '';
      logo.appendChild(img);
    } else {
      var span = document.createElement('span');
      span.className = 'logo-text';
      span.textContent = b.name || 'AI MONSTER';
      logo.appendChild(span);
    }
    $('#title-heading').textContent = t.heading || 'アンケートクエスト';
    $('#title-sub').textContent = t.subheading || '';
    var btn = $('#btn-start');
    btn.textContent = t.startLabel || 'スタート';
    btn.hidden = false;
    btn.addEventListener('click', onStart);
  }

  var bannerTimer = null;
  function showBanner(text) {
    var banner = $('#banner');
    banner.textContent = text;
    banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { banner.hidden = true; }, 1600);
  }

  function showClear(config, clearTitle, answers) {
    var c = config.clear || {};
    $('#hud').hidden = true;
    $('#screen-game').hidden = true;
    $('#screen-runner').hidden = true;
    $('#clear-fx').textContent = '🎉✨🏆✨🎉';
    $('#clear-title').textContent = clearTitle || 'GAME CLEAR!';
    $('#clear-message').textContent = c.message || 'ご協力ありがとうございました!';
    var cta = $('#clear-cta');
    cta.textContent = c.ctaLabel || 'とくてんを うけとる';
    cta.href = c.ctaUrl || '#';
    $('#screen-clear').hidden = false;

    window.AIM_SUBMIT.send(config, answers).then(function (result) {
      $('#submit-note').textContent = result.sent
        ? '回答を送信しました。'
        : '※送信先が仮設定のため、回答の送信はスキップしました(デモ動作)。';
    });
  }

  window.AIM_CORE = {
    $: $,
    loadTheme: loadTheme,
    buildTitle: buildTitle,
    showBanner: showBanner,
    showClear: showClear
  };
})();
