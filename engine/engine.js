/* AI MONSTER engine 本体
   ゲーム進行・画面切替を担当する。クライアント固有の情報は一切持たず、
   すべて configs/○○.json(URLの ?config= で指定)から読み込む */

(function () {
  'use strict';

  var TAPS_PER_EVENT = 3; // 何タップ進むとイベントが起きるか
  var STEP_PX = 110;      // 1タップで進む距離(px)
  var WALK_MS = 420;      // 1歩の移動アニメーション時間(style.cssのtransitionと合わせる)

  function $(sel) { return document.querySelector(sel); }

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    var name = new URLSearchParams(location.search).get('config');
    if (!name || !/^[\w-]+$/.test(name)) return showGuide('');
    var config;
    try {
      var res = await fetch('configs/' + name + '.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      config = await res.json();
    } catch (e) {
      return showGuide(name);
    }
    var theme;
    try {
      theme = await loadTheme(config.theme);
    } catch (e) {
      theme = await loadTheme('adventure'); // テーマが見つからない場合の予備
    }
    new Game(config, theme).start();
  }

  /* テーマは engine/themes/○○.js を後から読み込む方式。
     テーマ追加時も engine 本体は無修正で済む */
  function loadTheme(name) {
    return new Promise(function (resolve, reject) {
      window.AIM_THEMES = window.AIM_THEMES || {};
      if (window.AIM_THEMES[name]) return resolve(window.AIM_THEMES[name]);
      var s = document.createElement('script');
      s.src = 'engine/themes/' + name + '.js';
      s.onload = function () {
        if (window.AIM_THEMES[name]) resolve(window.AIM_THEMES[name]);
        else reject(new Error('theme not registered: ' + name));
      };
      s.onerror = function () { reject(new Error('theme load failed: ' + name)); };
      document.head.appendChild(s);
    });
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
      '<li><a href="?config=salon">美容室デモ</a></li>' +
      '</ul>';
    guide.hidden = false;
  }

  function Game(config, theme) {
    this.config = config;
    this.theme = theme;
    this.idx = 0;        // いま何問目か
    this.taps = 0;       // 次のイベントまでのタップ数
    this.distance = 0;   // 進んだ距離(px)
    this.answers = {};   // 回答の記録 { 質問id: 回答 }
    this.busy = false;   // 演出中はタップを受け付けない
    this.sprite = null;
  }

  Game.prototype.start = function () {
    this.applyBranding();
    this.buildTitle();
    this.buildHud();
    this.buildField();
    var self = this;
    $('#btn-start').addEventListener('click', function () { self.enterGame(); });
    $('#field').addEventListener('pointerdown', function (e) {
      e.preventDefault(); // 長押しメニュー・選択動作の抑制
      self.onTap();
    });
  };

  Game.prototype.applyBranding = function () {
    var b = this.config.brand || {};
    var root = document.documentElement.style;
    if (b.mainColor) root.setProperty('--main', b.mainColor);
    if (b.accentColor) root.setProperty('--accent', b.accentColor);
    document.title = (b.name ? b.name + ' | ' : '') + 'AI MONSTER';
    $('#field').style.background = this.theme.fieldBackground;
  };

  Game.prototype.buildTitle = function () {
    var b = this.config.brand || {};
    var t = this.config.title || {};
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
  };

  /* 質問ごとのイベントアイコンを先に決めておく(HUDとフィールドで同じ絵を使う) */
  Game.prototype.iconFor = function (i) {
    var q = this.config.questions[i];
    var sp = this.theme.sprites;
    if (q.event === 'chest') return sp.chest;
    if (q.event === 'boss') return sp.boss;
    return sp.enemy[i % sp.enemy.length];
  };

  Game.prototype.buildHud = function () {
    var icons = $('#hud-icons');
    for (var i = 0; i < this.config.questions.length; i++) {
      var s = document.createElement('span');
      s.textContent = this.iconFor(i);
      icons.appendChild(s);
    }
    this.updateHud();
  };

  Game.prototype.updateHud = function () {
    var total = this.config.questions.length;
    $('#hud-count').textContent = this.idx + ' / ' + total;
    var icons = $('#hud-icons').children;
    for (var i = 0; i < icons.length; i++) {
      if (i < this.idx) {
        icons[i].textContent = '✅';
        icons[i].className = 'done';
      }
    }
  };

  /* フィールドの飾り(木・岩など)をあらかじめ敷き詰めておく */
  Game.prototype.buildField = function () {
    var world = $('#world');
    var decos = this.theme.fieldDecorations;
    var totalPx = (this.config.questions.length * TAPS_PER_EVENT + 4) * STEP_PX + 800;
    for (var x = 120; x < totalPx; x += 100 + Math.floor(Math.random() * 120)) {
      var d = document.createElement('span');
      d.className = 'deco';
      d.textContent = decos[Math.floor(Math.random() * decos.length)];
      d.style.left = x + 'px';
      world.appendChild(d);
    }
    $('#hero').textContent = this.theme.hero;
  };

  Game.prototype.enterGame = function () {
    $('#screen-title').hidden = true;
    $('#screen-game').hidden = false;
    $('#hud').hidden = false;
  };

  Game.prototype.onTap = function () {
    if (this.busy || this.idx >= this.config.questions.length) return;
    this.busy = true;
    $('#tap-hint').hidden = true;
    this.taps++;
    this.distance += STEP_PX;
    $('#world').style.transform = 'translateX(' + (-this.distance) + 'px)';
    var hero = $('#hero');
    hero.classList.add('walking');
    var self = this;
    setTimeout(function () {
      hero.classList.remove('walking');
      if (self.taps >= TAPS_PER_EVENT) {
        self.taps = 0;
        self.encounter();
      } else {
        self.busy = false;
      }
    }, WALK_MS);
  };

  /* イベント発生:敵・宝箱が現れて質問モーダルを開く */
  Game.prototype.encounter = function () {
    var q = this.config.questions[this.idx];
    var sprite = document.createElement('div');
    sprite.className = 'sprite';
    sprite.textContent = this.iconFor(this.idx);
    $('#field').appendChild(sprite);
    this.sprite = sprite;

    var msgs = this.theme.messages.encounter;
    this.showBanner(msgs[q.event] || msgs.enemy);

    var self = this;
    setTimeout(function () {
      window.AIM_QUESTIONS.open(q, self.idx + 1, self.config.questions.length, function (value) {
        self.onAnswer(q, value);
      });
    }, 900);
  };

  Game.prototype.onAnswer = function (q, value) {
    this.answers[q.id] = value;
    this.idx++;
    this.updateHud();

    var msgs = this.theme.messages.resolve;
    this.showBanner(msgs[q.event] || msgs.enemy);

    var sprite = this.sprite;
    if (q.event === 'chest') {
      sprite.textContent = '✨';
      sprite.classList.add('opened');
    } else {
      sprite.classList.add('resolved');
    }

    var self = this;
    setTimeout(function () {
      if (sprite.parentNode) sprite.parentNode.removeChild(sprite);
      self.sprite = null;
      if (self.idx >= self.config.questions.length) {
        self.showClear();
      } else {
        self.busy = false;
      }
    }, 1100);
  };

  Game.prototype.showBanner = function (text) {
    var banner = $('#banner');
    banner.textContent = text;
    banner.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(function () { banner.hidden = true; }, 1600);
  };

  Game.prototype.showClear = function () {
    var c = this.config.clear || {};
    $('#hud').hidden = true;
    $('#screen-game').hidden = true;
    $('#clear-fx').textContent = '🎉✨🏆✨🎉';
    $('#clear-title').textContent = this.theme.messages.clearTitle;
    $('#clear-message').textContent = c.message || 'ご協力ありがとうございました!';
    var cta = $('#clear-cta');
    cta.textContent = c.ctaLabel || 'とくてんを うけとる';
    cta.href = c.ctaUrl || '#';
    $('#screen-clear').hidden = false;

    window.AIM_SUBMIT.send(this.config, this.answers).then(function (result) {
      $('#submit-note').textContent = result.sent
        ? '回答を送信しました。'
        : '※送信先が仮設定のため、回答の送信はスキップしました(デモ動作)。';
    });
  };
})();
