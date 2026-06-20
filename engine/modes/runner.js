/* モード「runner」v2:操作型シューティング(宇宙×アメリカンポップ)。
   - 主人公は自動で奥へ前進(擬似3D)し、自動で弾を撃ち続ける
   - プレイヤーは画面ドラッグで主人公を左右に移動
   - 左右2枚のゲート(障害物)の正面側に弾が当たり、壊すと完全ポーズ
     → カード形式の回答UI(全質問タイプ統一)→ 回答で「GO!!」再開
   - ゲーム描画はcanvas(毎コマ描き直す高速方式)。60fps目標。
     HUD・カードUI・バナーはHTMLのまま(文字表示の品質のため)*/

(function () {
  'use strict';

  var $ = window.AIM_CORE.$;

  /* ゲームの手ざわりを決める数値(実機確認後に調整する想定) */
  var WORLD_SPEED = 14;     // 前進速度
  var GATE_DIST = 42;       // ゲートが出現する距離
  var STOP_Z = 6;           // ゲートが目の前で止まる距離(ゲームオーバーなし)
  var BULLET_SPEED = 46;    // 弾の速度
  var FIRE_MS = 240;        // 連射間隔(一定。強さは攻撃倍率で表現)
  var SEC_FIRST = 6;        // 1問目のゲート破壊目標秒数
  var SEC_LAST = 2.5;       // 最終問のゲート破壊目標秒数(後半ほどテンポUP)
  var FOCAL = 10;           // 擬似3Dの遠近の強さ
  var HERO_RANGE = 0.72;    // 主人公が左右に動ける範囲(道幅に対する割合)
  var ITEM_SIDE = 0.42;     // アイテムを置く左右の寄せ幅
  var ITEM_CATCH = 0.22;    // アイテムを拾える距離(先頭の主人公との左右差)
  var MAX_SQUAD = 12;       // 画面に表示する隊列人数の上限(性能対策。超過分は弾の威力へ)
  var BG_SRC = 'engine/themes/premium/bg-space.webp'; // 宇宙の背景画像(WebP・軽量化済み)

  /* 隊列の並び(先頭の後ろにV字で広がる)。[左右のずれ, 後ろへの距離px] */
  var SLOTS = [
    [-0.12, 26], [0.12, 26],
    [-0.24, 52], [0.24, 52],
    [0, 60],
    [-0.36, 78], [0.36, 78],
    [-0.12, 86], [0.12, 86],
    [-0.48, 104], [0.48, 104]
  ];

  /* 効果音(ファイル不要の簡易シンセ。端末がマナーモードのときは鳴らない) */
  var sound = (function () {
    var actx = null;
    function init() {
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
      }
      if (actx && actx.state === 'suspended') actx.resume();
    }
    function blip(freq, dur, vol, type) {
      if (!actx) return;
      try {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq, actx.currentTime);
        o.frequency.exponentialRampToValueAtTime(freq * 0.4, actx.currentTime + dur);
        g.gain.setValueAtTime(vol, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
        o.connect(g);
        g.connect(actx.destination);
        o.start();
        o.stop(actx.currentTime + dur);
      } catch (e) {}
    }
    return {
      init: init,
      shot: function (n) { blip(650 + Math.random() * 250, 0.06, Math.min(0.07, 0.015 + n * 0.005)); }, // 人数が多いほど少し賑やかに
      coin: function () { blip(1300, 0.18, 0.09, 'triangle'); },
      boom: function () { blip(110, 0.4, 0.16, 'sawtooth'); }
    };
  })();

  window.AIM_MODES = window.AIM_MODES || {};
  window.AIM_MODES.runner = {
    start: function (config) { new Runner(config).start(); }
  };

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function Runner(config) {
    this.config = config;
    this.idx = 0;            // いま何問目か
    this.answers = {};       // 回答の記録
    this.mult = 1;           // 攻撃力(=隊列の総人数。アイテム取得・回答で+1)
    this.members = [];       // 画面上の仲間(先頭を除く。最大 MAX_SQUAD-1 人)
    this.state = 'idle';     // run / exploding / paused / done
    this.traveled = 0;       // 進んだ距離
    this.speed = WORLD_SPEED;
    this.fx = 0;             // 主人公の左右位置(-1〜1。0が道の中央)
    this.bullets = [];
    this.gates = null;       // 迫ってくる左右ゲート(なければnull)
    this.item = null;        // コース上のパワーアップアイテム(なければnull)
    this.particles = [];
    this.stars = [];
    this.shootingStars = []; // 流れ星(たまに上空を横切る)
    this.shootTimer = 2;     // 次の流れ星までの秒数
    this.bgImg = null;       // 背景画像(読み込めるまではグラデーションで代用)
    this.bgReady = false;
    this.shake = 0;          // 画面振動の強さ
    this.flash = 0;          // 破壊時の白フラッシュ
    this.fireTimer = 0;
    this.spawnAt = 0;        // 次のゲートを出す距離
    this.itemAt = 0;         // 次のアイテムを出す距離
    this.lastTs = 0;
    this.dragging = false;
    this.dragX = 0;
  }

  /* ---------- 起動・画面 ---------- */

  Runner.prototype.start = function () {
    var self = this;
    this.colors = {
      main: cssVar('--main', '#5a3fd6'),
      accent: cssVar('--accent', '#ff5fa2')
    };
    // 背景画像を先読み(間に合わなくてもグラデーションで動くので安全)
    var img = new Image();
    img.onload = function () { self.bgReady = true; };
    img.src = BG_SRC;
    this.bgImg = img;
    this.buildHud();
    window.AIM_CORE.buildTitle(this.config, function () { self.enterGame(); });
  };

  Runner.prototype.buildHud = function () {
    var icons = $('#hud-icons');
    this.config.questions.forEach(function (q) {
      var s = document.createElement('span');
      s.textContent = q.event === 'boss' ? '🛸' : '👾';
      icons.appendChild(s);
    });
    this.updateHud();
  };

  Runner.prototype.updateHud = function () {
    $('#hud-count').textContent = this.idx + ' / ' + this.config.questions.length;
    var icons = $('#hud-icons').children;
    for (var i = 0; i < icons.length; i++) {
      if (i < this.idx && icons[i].className !== 'done') {
        icons[i].textContent = '✅';
        icons[i].className = 'done';
      }
    }
  };

  Runner.prototype.enterGame = function () {
    $('#screen-title').hidden = true;
    $('#screen-runner').hidden = false;
    $('#hud').hidden = false;
    sound.init(); // スタートボタンのタップ(ユーザー操作)を合図に音を有効化
    this.initCanvas();
    this.bindInput();
    this.itemAt = this.traveled + 12;
    this.spawnAt = this.traveled + 26;
    this.state = 'run';
    window.AIM_CORE.showBanner('ドラッグで いどう!⚡で なかまを ふやそう!');
    var self = this;
    this.lastTs = performance.now();
    requestAnimationFrame(function loop(ts) {
      self.frame(ts);
      if (self.state !== 'done') requestAnimationFrame(loop);
    });
    window.__aimRunner = this; // 動作確認用(本番動作には影響しない)
  };

  Runner.prototype.initCanvas = function () {
    this.canvas = $('#game-canvas');
    this.ctx = this.canvas.getContext('2d');
    var self = this;
    function resize() {
      var rect = self.canvas.parentElement.getBoundingClientRect();
      var dpr = Math.min(2, window.devicePixelRatio || 1); // 高精細画面でもぼやけない範囲で軽量に
      self.w = Math.round(rect.width);
      self.h = Math.round(rect.height);
      self.canvas.width = self.w * dpr;
      self.canvas.height = self.h * dpr;
      self.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      self.horizonY = self.h * 0.32;
      self.heroY = self.h - 120;
      self.roadHalf = self.w * 0.42;
      self.makeStars();
    }
    resize();
    window.addEventListener('resize', resize);
  };

  Runner.prototype.makeStars = function () {
    this.stars = [];
    var n = Math.min(48, Math.round(this.w * this.h / 5200)); // 端末性能対策で数を抑える
    var skyBottom = (this.horizonY || this.h * 0.32) * 1.05;  // 空の範囲(道の上)に限定
    for (var i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * skyBottom,
        r: Math.random() * 1.6 + 0.6,
        ph: Math.random() * Math.PI * 2
      });
    }
  };

  /* ドラッグ操作(指の動いた量に合わせた相対移動。スクロール競合対策込み) */
  Runner.prototype.bindInput = function () {
    var self = this;
    var c = this.canvas;
    c.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      self.dragging = true;
      self.dragX = e.clientX;
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', function (e) {
      if (!self.dragging) return;
      e.preventDefault();
      var dx = e.clientX - self.dragX;
      self.dragX = e.clientX;
      self.fx += dx / self.roadHalf;
      if (self.fx > HERO_RANGE) self.fx = HERO_RANGE;
      if (self.fx < -HERO_RANGE) self.fx = -HERO_RANGE;
    });
    function end() { self.dragging = false; }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  };

  /* ---------- ゲーム進行 ---------- */

  Runner.prototype.frame = function (ts) {
    var dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.updateAmbient(dt);  // 宇宙の動き(流れ星など)は回答ポーズ中も止めない
    if (this.state === 'run') this.update(dt);
    if (this.state === 'run' || this.state === 'exploding') this.updateFx(dt);
    this.draw(ts / 1000);
  };

  /* 宇宙のうごめき:流れ星を一定間隔でスポーンし、上空を横切らせる */
  Runner.prototype.updateAmbient = function (dt) {
    this.shootTimer -= dt;
    if (this.shootTimer <= 0 && this.shootingStars.length < 2) {
      this.shootTimer = 2.5 + Math.random() * 4; // 2.5〜6.5秒ごと
      var fromLeft = Math.random() < 0.5;
      var speed = (this.w * 0.9) + Math.random() * this.w * 0.5;
      this.shootingStars.push({
        x: fromLeft ? -40 : this.w + 40,
        y: Math.random() * this.horizonY * 0.8 + 8,
        vx: (fromLeft ? 1 : -1) * speed,
        vy: speed * (0.35 + Math.random() * 0.2), // 斜めに流れ落ちる
        life: 1
      });
    }
    for (var i = this.shootingStars.length - 1; i >= 0; i--) {
      var s = this.shootingStars[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt * 0.9;
      if (s.life <= 0 || s.x < -80 || s.x > this.w + 80 || s.y > this.h * 0.6) {
        this.shootingStars.splice(i, 1);
      }
    }
  };

  Runner.prototype.update = function (dt) {
    // ゲートが目の前まで来たら減速して止まる(撃ち続ければ必ず壊せる)
    var targetSpeed = WORLD_SPEED;
    if (this.gates) {
      var minZ = Math.min(this.gates[0].worldZ, this.gates[1].worldZ) - this.traveled;
      if (minZ < STOP_Z + 4) targetSpeed = 0;
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 5);
    this.traveled += this.speed * dt;

    // アイテム出現(ゲートとゲートの間に1個。左右どちらかに寄せる)
    if (!this.item && !this.gates && this.traveled >= this.itemAt && this.traveled < this.spawnAt - 8) {
      this.item = {
        worldZ: this.traveled + GATE_DIST * 0.6,
        fx: (Math.random() < 0.5 ? -1 : 1) * ITEM_SIDE
      };
    }

    // ゲート出現
    if (!this.gates && this.traveled >= this.spawnAt) this.spawnGates();

    // アイテムの接近と取得判定(取り逃してもペナルティなし)
    if (this.item) {
      var iz = this.item.worldZ - this.traveled;
      if (iz <= 1.4) {
        if (Math.abs(this.fx - this.item.fx) < ITEM_CATCH) this.collectItem();
        else if (iz < -1) this.item = null; // 通り過ぎた(そのまま消える)
      }
    }

    // 自動射撃:隊列全員が一斉に撃つ(発射本数=人数。減りが目に見えて速くなる)
    this.fireTimer -= dt * 1000;
    if (this.fireTimer <= 0) {
      this.fireTimer = FIRE_MS;
      this.fireVolley();
    }

    // 弾の前進と命中判定(照準は常に先頭が向いている側のゲート)
    for (var i = this.bullets.length - 1; i >= 0; i--) {
      var b = this.bullets[i];
      b.z += BULLET_SPEED * dt;
      var hit = false;
      if (this.gates) {
        var g = b.aim < 0 ? this.gates[0] : this.gates[1];
        var gz = g.worldZ - this.traveled;
        if (b.z >= gz - 0.5 && g.hp > 0) {
          g.hp -= b.dmg;
          hit = true;
          this.spark(g);
          if (g.hp <= 0) {
            this.destroyGate(g); // 弾リストはここで全消去されるため即座に抜ける
            break;
          }
        }
      }
      if (hit || b.z > 60) this.bullets.splice(i, 1);
    }
  };

  /* 一斉射撃。表示上限を超えた人数分は弾1発の威力に上乗せ(見た目は同じ) */
  Runner.prototype.fireVolley = function () {
    var visible = 1 + this.members.length;
    var dmg = this.mult / visible;
    var aim = this.fx < 0 ? -1 : 1; // 先頭の位置で狙う側を決める(判定基準は先頭だけ)
    var shooters = [{ fx: this.fx, y: this.heroY }];
    for (var i = 0; i < this.members.length; i++) {
      var pos = this.memberPos(this.members[i]);
      shooters.push({ fx: pos.fx, y: pos.y });
    }
    for (var s = 0; s < shooters.length; s++) {
      this.bullets.push({ z: 1.5, fx0: shooters[s].fx, aim: aim, aimFx: this.fx, dmg: dmg });
      // 発射の光(人数が増えるほど賑やかになる)
      this.particles.push({
        x: this.w / 2 + shooters[s].fx * this.roadHalf,
        y: shooters[s].y - 26,
        vx: 0, vy: -40, rot: 0, vr: 0,
        size: 5, life: 0.12, color: '#ffe14d'
      });
    }
    sound.shot(visible);
  };

  /* 仲間の現在位置(合流アニメ中は画面外からの走り込みを補間) */
  Runner.prototype.memberPos = function (m) {
    var slot = SLOTS[m.slot];
    var targetFx = Math.max(-0.95, Math.min(0.95, this.fx + slot[0]));
    var targetY = this.heroY + slot[1];
    if (m.t >= 1) return { fx: targetFx, y: targetY };
    var e = 1 - Math.pow(1 - m.t, 3); // 走り込みの緩急
    return {
      fx: m.fromFx + (targetFx - m.fromFx) * e,
      y: (targetY + 40) + (targetY - (targetY + 40)) * e
    };
  };

  /* 仲間を1人追加(画面外から走って合流+「+1!」ポップ) */
  Runner.prototype.addMember = function () {
    if (this.members.length >= MAX_SQUAD - 1) return; // 超過分は威力に反映済み
    this.members.push({
      slot: this.members.length,
      t: 0,
      fromFx: (Math.random() < 0.5 ? -1 : 1) * 1.5
    });
    this.particles.push({
      x: this.w / 2 + this.fx * this.roadHalf, y: this.heroY - 80,
      vx: 0, vy: -70, rot: 0, vr: 0,
      size: 32, life: 0.9, color: '#ffe14d', text: '+1!'
    });
  };

  /* アイテム取得:仲間+1(合流アニメ+「+1!」ポップ) */
  Runner.prototype.collectItem = function () {
    this.item = null;
    this.mult++;
    this.addMember();
    sound.coin();
    var hx = this.w / 2 + this.fx * this.roadHalf;
    for (var i = 0; i < 14; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = Math.random() * 220 + 60;
      this.particles.push({
        x: hx, y: this.heroY - 20,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80,
        rot: Math.random() * 6, vr: Math.random() * 12 - 6,
        size: Math.random() * 6 + 3, life: 0.5, color: '#ffe14d'
      });
    }
  };

  Runner.prototype.updateFx = function (dt) {
    // 仲間の合流アニメを進める
    for (var mi = 0; mi < this.members.length; mi++) {
      if (this.members[mi].t < 1) {
        this.members[mi].t = Math.min(1, this.members[mi].t + dt / 0.6);
      }
    }
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.text) p.vy += 420 * dt; // 文字ポップは落下させず浮かせる
      p.rot += p.vr * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  };

  Runner.prototype.spawnGates = function () {
    var isBoss = this.idx === this.config.questions.length - 1;
    /* 目標秒数を1問目→最終問で段階的に短縮し、後半ほどテンポを上げる。
       耐久値=その時点の倍率×目標秒数ぶん(アイテムを拾うと予定より早く壊せる)*/
    var total = this.config.questions.length;
    var ratio = total > 1 ? this.idx / (total - 1) : 1;
    var targetSec = SEC_FIRST + (SEC_LAST - SEC_FIRST) * ratio;
    var hp = Math.max(3, Math.round(targetSec * (1000 / FIRE_MS) * this.mult));
    // 出現位置をすでに通り過ぎている弾が遡って当たらないように消しておく
    this.bullets = this.bullets.filter(function (b) { return b.z < GATE_DIST - 2; });
    this.gates = [
      { side: -1, worldZ: this.traveled + GATE_DIST, hp: hp, maxHp: hp, core: isBoss ? '🛸' : '👾', boss: isBoss },
      { side: 1, worldZ: this.traveled + GATE_DIST, hp: hp, maxHp: hp, core: isBoss ? '🛸' : '👾', boss: isBoss }
    ];
    window.AIM_CORE.showBanner(isBoss ? 'ボスゲートだ!うちこわせ!' : 'ゲートが せまってきた!');
  };

  /* 命中の火花 */
  Runner.prototype.spark = function (gate) {
    var pos = this.gateCenter(gate);
    for (var i = 0; i < 3; i++) {
      this.particles.push({
        x: pos.x + (Math.random() * 30 - 15), y: pos.y + (Math.random() * 20 - 10),
        vx: Math.random() * 160 - 80, vy: -Math.random() * 120,
        rot: Math.random() * 6, vr: Math.random() * 10 - 5,
        size: 4, life: 0.3, color: '#ffe14d'
      });
    }
  };

  /* 破壊演出(パーティクル+画面振動+フラッシュ)→ 完全ポーズ → カードUI */
  Runner.prototype.destroyGate = function (gate) {
    var pos = this.gateCenter(gate);
    var colors = ['#ffe14d', '#62e0ff', this.colors.accent, '#ffffff', this.colors.main];
    for (var i = 0; i < 42; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = Math.random() * 380 + 80;
      this.particles.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 140,
        rot: Math.random() * 6, vr: Math.random() * 16 - 8,
        size: Math.random() * 8 + 4, life: Math.random() * 0.5 + 0.45,
        color: colors[i % colors.length]
      });
    }
    this.shake = 1;
    this.flash = 1;
    sound.boom();
    this.gates = null;
    this.item = null;
    this.bullets = [];
    this.state = 'exploding';
    var self = this;
    setTimeout(function () {
      self.state = 'paused'; // 完全ポーズ(回答するまで再開しない)
      self.openCards(self.config.questions[self.idx]);
    }, 700);
  };

  /* ---------- カード回答UI(全質問タイプ統一・世界観デザイン) ---------- */

  Runner.prototype.openCards = function (q) {
    var self = this;
    var wrap = $('#cards');
    wrap.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'cards-box';

    var chip = document.createElement('span');
    chip.className = 'cards-chip';
    chip.textContent = 'Q' + (this.idx + 1) + ' / ' + this.config.questions.length;
    box.appendChild(chip);

    var text = document.createElement('p');
    text.className = 'cards-question';
    text.textContent = q.text;
    box.appendChild(text);

    function finish(value) { self.onAnswer(q, value); }

    if (q.type === 'multi') {
      var selected = [];
      var confirmBtn = makeConfirm();
      (q.options || []).forEach(function (opt) {
        var card = makeCard(opt);
        card.addEventListener('click', function () {
          var i = selected.indexOf(opt);
          if (i >= 0) { selected.splice(i, 1); card.classList.remove('picked'); }
          else { selected.push(opt); card.classList.add('picked'); }
          confirmBtn.disabled = selected.length === 0;
        });
        box.appendChild(card);
      });
      confirmBtn.addEventListener('click', function () { finish(selected.slice()); });
      box.appendChild(confirmBtn);

    } else if (q.type === 'text') {
      var ta = document.createElement('textarea');
      ta.className = 'cards-textarea';
      ta.rows = 4;
      ta.placeholder = '自由にご記入ください';
      var confirmBtn2 = makeConfirm();
      ta.addEventListener('input', function () {
        confirmBtn2.disabled = ta.value.trim() === '';
      });
      confirmBtn2.addEventListener('click', function () { finish(ta.value.trim()); });
      box.appendChild(ta);
      box.appendChild(confirmBtn2);

    } else { // single(選択肢の数は問わない)
      (q.options || []).forEach(function (opt) {
        var card = makeCard(opt);
        card.addEventListener('click', function () {
          card.classList.add('picked');
          setTimeout(function () { finish(opt); }, 250); // 選んだ手応えを見せてから確定
        });
        box.appendChild(card);
      });
    }

    function makeCard(label) {
      var c = document.createElement('button');
      c.className = 'answer-card';
      c.textContent = label;
      return c;
    }
    function makeConfirm() {
      var b = document.createElement('button');
      b.className = 'btn-big cards-confirm';
      b.textContent = 'これで けってい!';
      b.disabled = true;
      return b;
    }

    wrap.appendChild(box);
    wrap.hidden = false;
  };

  Runner.prototype.onAnswer = function (q, value) {
    this.answers[q.id] = value;
    this.idx++;
    this.mult++; // 回答ボーナス:答える=仲間が増える(合流は再開時に見せる)
    this.updateHud();

    var self = this;
    var wrap = $('#cards');
    wrap.firstChild.classList.add('out'); // カード退場演出
    setTimeout(function () {
      wrap.hidden = true;
      wrap.innerHTML = '';
      if (self.idx >= self.config.questions.length) {
        self.state = 'done';
        window.AIM_CORE.showClear(self.config, 'GAME CLEAR!', self.answers);
      } else {
        self.resume();
      }
    }, 350);
  };

  /* 再開演出(なかま+1! + GO!!)→ 仲間が走り込んで合流 → 走行再開 */
  Runner.prototype.resume = function () {
    var go = $('#go-burst');
    go.innerHTML = 'なかま <span class="go-mult">+1!</span><small>GO!!</small>';
    go.hidden = false;
    this.addMember();
    this.lastTs = performance.now();
    this.state = 'run';
    this.itemAt = this.traveled + 12;
    this.spawnAt = this.traveled + 28;
    setTimeout(function () { go.hidden = true; }, 850);
  };

  /* ---------- 描画(canvas) ---------- */

  /* 距離z(奥行き)から画面上の位置と縮尺を計算する(擬似3D) */
  Runner.prototype.project = function (z) {
    var s = FOCAL / (FOCAL + Math.max(0, z));
    return {
      s: s,
      y: this.horizonY + (this.heroY - this.horizonY) * s,
      half: this.roadHalf * s
    };
  };

  Runner.prototype.gateCenter = function (gate) {
    var p = this.project(gate.worldZ - this.traveled);
    return { x: this.w / 2 + gate.side * p.half * 0.5, y: p.y - 60 * p.s };
  };

  Runner.prototype.draw = function (t) {
    var ctx = this.ctx;
    var w = this.w, h = this.h, cx = w / 2;

    // 背景:宇宙の画像(読み込み前はグラデーションで代用)
    this.drawBackground();

    // 星雲のゆっくりした脈動(位置は固定、光量だけ呼吸させる)
    this.drawNebulaPulse(t);

    // 星(またたき)— 空の範囲にだけ重ねる
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.5 + st.ph));
      ctx.fillStyle = '#fff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // 流れ星(たまに上空を横切る)
    this.drawShootingStars();

    // プレイ領域(画面下)を少し沈めて、ゲーム要素が背景に溶けないようにする
    this.drawPlayfieldDim();

    // 画面振動
    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() * 2 - 1) * this.shake * 10, (Math.random() * 2 - 1) * this.shake * 10);
    }

    // 道(台形)
    var near = this.project(0), far = this.project(70);
    ctx.beginPath();
    ctx.moveTo(cx - near.half, near.y + 60);
    ctx.lineTo(cx - far.half, far.y);
    ctx.lineTo(cx + far.half, far.y);
    ctx.lineTo(cx + near.half, near.y + 60);
    ctx.closePath();
    ctx.fillStyle = 'rgba(40, 28, 96, .92)';
    ctx.fill();
    ctx.strokeStyle = '#62e0ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // 横グリッド(奥→手前へ流れ落ちて疾走感を出す。手前ほど速く・はっきり見える)
    ctx.strokeStyle = '#62e0ff';
    ctx.lineWidth = 1.5;
    for (var gz = 6 - (this.traveled % 6); gz < 70; gz += 6) {
      var gp = this.project(gz);
      ctx.globalAlpha = 0.08 + 0.5 * gp.s;
      ctx.beginPath();
      ctx.moveTo(cx - gp.half, gp.y);
      ctx.lineTo(cx + gp.half, gp.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 中央の破線(走行感)
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (var z = 2 + (6 - this.traveled % 6); z < 60; z += 6) {
      var p1 = this.project(z), p2 = this.project(z + 2.2);
      ctx.fillRect(cx - 3 * p1.s, p2.y, 6 * p1.s, p1.y - p2.y);
    }

    // パワーアップアイテム(⚡の光る玉)
    if (this.item) {
      var ip = this.project(this.item.worldZ - this.traveled);
      var ix = cx + this.item.fx * ip.half;
      var iy = ip.y - 26 * ip.s;
      var ir = 22 * ip.s + 6;
      ctx.fillStyle = 'rgba(255, 225, 77, ' + (0.25 + 0.15 * Math.sin(t * 6)) + ')';
      ctx.beginPath();
      ctx.arc(ix, iy, ir * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(ix, iy, ir, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = Math.round(ir * 1.2) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1d1640';
      ctx.fillText('⚡', ix, iy + 1);
    }

    // ゲート(奥にあるものから)
    if (this.gates) {
      for (var gi = 0; gi < 2; gi++) this.drawGate(this.gates[gi], t);
    }

    // 弾(ネオン色の光弾。飛びながら先頭の照準へ収束する)
    ctx.fillStyle = this.colors.accent;
    for (var bi = 0; bi < this.bullets.length; bi++) {
      var b = this.bullets[bi];
      var bp = this.project(b.z);
      var conv = Math.min(1, b.z / 25);
      var bfx = b.fx0 + (b.aimFx - b.fx0) * conv;
      var bx = cx + bfx * bp.half;
      ctx.beginPath();
      ctx.arc(bx, bp.y - 30 * bp.s, Math.max(2, 5 * bp.s), 0, Math.PI * 2);
      ctx.fill();
    }

    // 仲間の隊列(先頭の後ろにV字。後ろの列から描く)
    ctx.font = '30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var mi = this.members.length - 1; mi >= 0; mi--) {
      var mp = this.memberPos(this.members[mi]);
      var mx = cx + mp.fx * this.roadHalf;
      ctx.fillText('🧑‍🚀', mx, mp.y - 6 + Math.sin(t * 9 + mi) * 2);
    }

    // 先頭の主人公(判定の基準。足元の光で目立たせる)
    var hx = cx + this.fx * this.roadHalf;
    ctx.fillStyle = 'rgba(98, 224, 255, .35)';
    ctx.beginPath();
    ctx.ellipse(hx, this.heroY + 16, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '40px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧑‍🚀', hx, this.heroY - 8 + Math.sin(t * 9) * 2);

    // パーティクル(破片・文字ポップ)
    for (var pi = 0; pi < this.particles.length; pi++) {
      var pt = this.particles[pi];
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot);
      ctx.globalAlpha = Math.min(1, pt.life * 2.5);
      ctx.fillStyle = pt.color;
      if (pt.text) {
        ctx.font = '900 italic ' + pt.size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#1d1640';
        ctx.lineWidth = 4;
        ctx.strokeText(pt.text, 0, 0);
        ctx.fillText(pt.text, 0, 0);
      } else {
        ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 破壊時の白フラッシュ
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.45) + ')';
      ctx.fillRect(0, 0, w, h);
    }
  };

  /* 背景画像を「画面を覆う」配置で描く(cover相当。比率を保ち中央寄せ)。
     読み込み前は従来の宇宙グラデーションで代用するので表示は壊れない */
  Runner.prototype.drawBackground = function () {
    var ctx = this.ctx, w = this.w, h = this.h;
    if (this.bgReady && this.bgImg) {
      var iw = this.bgImg.naturalWidth || this.bgImg.width;
      var ih = this.bgImg.naturalHeight || this.bgImg.height;
      var scale = Math.max(w / iw, h / ih);
      var dw = iw * scale, dh = ih * scale;
      ctx.drawImage(this.bgImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      var bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#070b26');
      bg.addColorStop(0.55, '#1b1450');
      bg.addColorStop(1, '#45207a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
  };

  /* 星雲の脈動:中央上の星雲・惑星まわりに、ゆっくり明滅する淡い光を重ねる。
     白飛び防止のため加算合成(lighter)+低い不透明度に抑える(screen合成は使わない) */
  Runner.prototype.drawNebulaPulse = function (t) {
    var ctx = this.ctx, w = this.w, h = this.h;
    var glows = [
      { cx: w * 0.56, cy: h * 0.28, col: '255,95,162', ph: 0.0, spd: 0.55 }, // マゼンタ
      { cx: w * 0.40, cy: h * 0.34, col: '98,224,255', ph: 1.9, spd: 0.42 }  // シアン
    ];
    var r = Math.max(w, h) * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < glows.length; i++) {
      var d = glows[i];
      var a = 0.05 + 0.05 * (0.5 + 0.5 * Math.sin(t * d.spd + d.ph)); // 0.05〜0.10
      var g = ctx.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, r);
      g.addColorStop(0, 'rgba(' + d.col + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + d.col + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  };

  /* 流れ星:尾を引く短い光の線。加算合成で上空だけを横切る */
  Runner.prototype.drawShootingStars = function () {
    var ctx = this.ctx;
    if (!this.shootingStars.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (var i = 0; i < this.shootingStars.length; i++) {
      var s = this.shootingStars[i];
      var len = 0.09; // 尾の長さ(速度に対する割合)
      var tx = s.x - s.vx * len, ty = s.y - s.vy * len;
      var a = Math.max(0, Math.min(1, s.life)) * 0.9;
      var grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      grad.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* プレイ領域(地平線から下)を少しずつ暗くして、
     隊列・ゲート・弾・アイテムが明るい背景に溶けないようにする */
  Runner.prototype.drawPlayfieldDim = function () {
    var ctx = this.ctx, w = this.w, h = this.h, top = this.horizonY;
    var g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, 'rgba(6,9,30,0)');
    g.addColorStop(1, 'rgba(6,9,30,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, w, h - top);
  };

  Runner.prototype.drawGate = function (gate, t) {
    var ctx = this.ctx;
    var z = gate.worldZ - this.traveled;
    var p = this.project(z);
    var cx = this.w / 2;
    var gw = p.half * 0.88;
    var gh = (130 + (gate.boss ? 50 : 0)) * p.s;
    var gx = cx + gate.side * p.half * 0.5 - gw / 2;
    var gy = p.y - gh;

    // エネルギーバリア(半透明パネル+ネオン枠)
    ctx.fillStyle = gate.boss ? 'rgba(255, 90, 90, .25)' : 'rgba(98, 224, 255, .18)';
    ctx.strokeStyle = gate.boss ? '#ff5fa2' : '#62e0ff';
    ctx.lineWidth = Math.max(1.5, 4 * p.s);
    roundRect(ctx, gx, gy, gw, gh, 10 * p.s);
    ctx.fill();
    ctx.stroke();

    // コア(エイリアン/ボスUFO)。背景と同化しないよう白い光彩を敷く
    var coreSize = Math.round((gate.boss ? 56 : 42) * p.s + 8);
    var coreY = gy + gh / 2 + Math.sin(t * 4 + gate.side) * 4 * p.s;
    ctx.fillStyle = 'rgba(255, 255, 255, .3)';
    ctx.beginPath();
    ctx.arc(gx + gw / 2, coreY, coreSize * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = coreSize + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(gate.core, gx + gw / 2, coreY);

    // 耐久値バッジ
    var label = String(gate.hp);
    ctx.font = 'bold ' + Math.round(13 * p.s + 8) + 'px sans-serif';
    var bw = ctx.measureText(label).width + 22 * p.s + 8;
    var bh = 20 * p.s + 10;
    var bx = gx + gw / 2 - bw / 2;
    var by = gy - bh - 6 * p.s;
    ctx.fillStyle = '#e8403a';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, gx + gw / 2, by + bh / 2 + 1);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
})();
