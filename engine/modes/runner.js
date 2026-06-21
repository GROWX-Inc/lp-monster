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
  var SPRITE_DIR = 'engine/themes/premium/runner/';   // キャラのドット絵(透過WebP)
  var SPRITE_NAMES = ['hero', 'ally', 'enemy-a', 'enemy-b', 'boss', 'item'];

  /* ===== 背景演出の強さ調整(ここの数値だけで「派手/地味」を変えられる) =====
     初期値は「初見で疾走感がはっきり分かる」やや強めに設定。下げたいときは各値を小さく。*/
  var FX = {
    // 1) 道路グリッドの高速スクロール(疾走感の主役)
    grid:     { baseSpeed: 28, squadBoost: 0.22, spacing: 4.0, width: 2.6, intensity: 1.0, color: '#8af6ff' },
    // 2) 両サイドの光の粒
    side:     { rate: 30, max: 110, speedMul: 1.2, size: 3.4, intensity: 1.0, colors: ['#8af6ff', '#ff8fd6', '#ffffff'] },
    // 3) 星のワープ(ハイパースペース・控えめ常時)
    warp:     { count: 1.0, speed: 0.95, intensity: 0.7 },
    // 4) 星雲の脈動(はっきり)
    nebula:   { base: 0.07, amp: 0.17, breath: 0.10, speed: 0.6 },
    // 5) 流れ星(頻度UP)
    shooting: { minGap: 0.45, maxGap: 1.5, max: 5 },
    // 6) 地平線のネオン帯(ピンクの脈動・明滅)
    horizon:  { height: 84, base: 0.10, amp: 0.18, speed: 1.7, flicker: 0.14, core: 1.3 },
    // 7) 戦闘エフェクト(撃つ・当たる・壊す)
    hit:      { sparks: 7, sparkSpeed: 340, flashR: 16, ring: 1, ringSpeed: 260 },
    muzzle:   { glow: 11 },
    destroy:  { shards: 30, rings: 2, flash: 0.6, shake: 1.25 },
    numReact: { ms: 0.24, shake: 5 },
    // 8) ボス戦の特別演出(最終問)
    boss:     { fxMul: 1.9, telopMs: 1.4, slowmoScale: 0.32, introSlowmoMs: 0.5,
                gaugeH: 20, defeatShards: 100, defeatRings: 5, defeatFlash: 0.9,
                defeatShake: 1.8, defeatSlowmoMs: 0.7, defeatMs: 1200 }
  };
  var MAX_PARTICLES = 240;   // パーティクル総数の上限(重い端末でのカクつき対策)

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
    this.shootingStars = []; // 流れ星(上空を横切る)
    this.shootTimer = 1.2;   // 次の流れ星までの秒数
    this.warpStars = [];     // ワープ星(中央収束点から手前へ放射)
    this.sideParticles = []; // 道の両サイドを後方へ流れる光の粒
    this.sideSpawnAcc = 0;   // 光の粒スポーンの端数
    this.gridScroll = 0;     // 道路グリッドのスクロール量(疾走感)
    this.fxScale = 1;        // 演出の品質係数(重いと自動で下げる:0.4〜1.0)
    this.fpsAvg = 60;        // 推定FPS(自動間引きの判断用)
    this.bgImg = null;       // 背景画像(読み込めるまではグラデーションで代用)
    this.bgReady = false;
    this.shake = 0;          // 画面振動の強さ
    this.flash = 0;          // 破壊時の白フラッシュ
    this.timeScale = 1;      // スローモーション用の時間倍率(1=通常)
    this.slowmo = 0;         // スロー残り秒数(ボス出現・撃破の“タメ”)
    this.telop = null;       // 中央テロップ(FINAL! など)
    this.bossGauge = 1;      // ボスHPゲージの表示値(なめらかに追従)
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
    img.onerror = function () { self.bgReady = false; }; // 失敗時はグラデーションのまま継続
    img.src = BG_SRC;
    this.bgImg = img;
    // キャラのドット絵を先読み(読み込めるまでは絵文字に自動フォールバック)
    this.sprites = {};
    SPRITE_NAMES.forEach(function (nm) {
      var im = new Image();
      im.onload = function () { im._ready = true; };
      im.src = SPRITE_DIR + nm + '.webp';
      self.sprites[nm] = im;
    });
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
      self.makeWarpStars();
    }
    resize();
    window.addEventListener('resize', resize);
  };

  /* ワープ星:中央収束点(道の消失点)から放射状に並べる。手前に来るほど速く・線状に伸びる */
  Runner.prototype.makeWarpStars = function () {
    this.warpStars = [];
    var n = Math.round(this.w * this.h / 9000 * FX.warp.count); // 控えめな密度
    var maxR = Math.hypot(this.w, this.h) * 0.62;
    for (var i = 0; i < n; i++) {
      this.warpStars.push({
        ang: Math.random() * Math.PI * 2,
        rad: Math.random() * maxR + 4,
        prev: 0,
        spd: 0.6 + Math.random() * 0.9
      });
    }
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
    var realDt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    // 実機60fps維持:FPSを推定し、重いと判定したら演出の品質係数を自動で下げる
    if (realDt > 0.0005) {
      this.fpsAvg += (1 / realDt - this.fpsAvg) * 0.05;
      if (this.fpsAvg < 50 && this.fxScale > 0.4) this.fxScale = Math.max(0.4, this.fxScale - realDt * 0.6);
      else if (this.fpsAvg > 57 && this.fxScale < 1) this.fxScale = Math.min(1, this.fxScale + realDt * 0.25);
    }
    // スローモーション(ボス出現・撃破の“タメ”)。時間倍率をなめらかに補間
    this.slowmo = Math.max(0, this.slowmo - realDt);
    var tsTarget = this.slowmo > 0 ? FX.boss.slowmoScale : 1;
    this.timeScale += (tsTarget - this.timeScale) * Math.min(1, realDt * 8);
    var dt = realDt * this.timeScale;
    // 中央テロップは実時間で進める(スローの影響を受けない)
    if (this.telop) { this.telop.life -= realDt; if (this.telop.life <= 0) this.telop = null; }
    this.updateAmbient(realDt);  // 宇宙の動き(ワープ星・流れ星など)は通常速度のまま
    if (this.state === 'run') this.update(dt);
    if (this.state === 'run' || this.state === 'exploding') this.updateFx(dt);
    this.draw(ts / 1000);
  };

  /* グリッド・光の粒の流れる速さ。隊列が増えるほど速くする(進行連動) */
  Runner.prototype.flowSpeed = function () {
    var squad = 1 + this.members.length;
    return FX.grid.baseSpeed * (1 + (squad - 1) * FX.grid.squadBoost);
  };

  /* 宇宙のうごめき:ワープ星・流れ星・両サイドの光の粒・グリッドスクロールをまとめて進める */
  Runner.prototype.updateAmbient = function (dt) {
    var moving = Math.max(0, Math.min(1, this.speed / WORLD_SPEED)); // 走行中=1、ゲート停止=0
    var fs = this.flowSpeed();

    // 道路グリッドのスクロール(停止中は止まる=ゲート前で減速する手触りに連動)
    this.gridScroll += fs * (0.15 + 0.85 * moving) * dt;

    // 流れ星(頻度UP・複数同時)
    this.shootTimer -= dt;
    if (this.shootTimer <= 0 && this.shootingStars.length < FX.shooting.max) {
      this.shootTimer = FX.shooting.minGap + Math.random() * (FX.shooting.maxGap - FX.shooting.minGap);
      var fromLeft = Math.random() < 0.5;
      var sp = (this.w * 0.9) + Math.random() * this.w * 0.7;
      this.shootingStars.push({
        x: fromLeft ? -40 : this.w + 40,
        y: Math.random() * this.horizonY * 0.9 + 6,
        vx: (fromLeft ? 1 : -1) * sp,
        vy: sp * (0.3 + Math.random() * 0.25),
        w: 1.6 + Math.random() * 1.6,           // 太さのばらつき
        len: 0.07 + Math.random() * 0.05,        // 尾の長さのばらつき
        life: 1
      });
    }
    for (var i = this.shootingStars.length - 1; i >= 0; i--) {
      var s = this.shootingStars[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.9;
      if (s.life <= 0 || s.x < -90 || s.x > this.w + 90 || s.y > this.h * 0.6) {
        this.shootingStars.splice(i, 1);
      }
    }

    // ワープ星(中央収束点から放射状に加速)
    var maxR = Math.hypot(this.w, this.h) * 0.62;
    for (var k = 0; k < this.warpStars.length; k++) {
      var ws = this.warpStars[k];
      ws.prev = ws.rad;
      ws.rad += FX.warp.speed * (ws.rad * 0.7 + 28) * ws.spd * dt; // 外周ほど速い(遠近)
      if (ws.rad > maxR) { ws.ang = Math.random() * Math.PI * 2; ws.rad = Math.random() * 24 + 4; ws.prev = ws.rad; }
    }

    // 両サイドの光の粒(奥から発生し手前=画面外へ高速で流れる)
    this.sideSpawnAcc += FX.side.rate * (0.25 + 0.75 * moving) * this.fxScale * dt;
    var cap = FX.side.max * this.fxScale;
    while (this.sideSpawnAcc >= 1) {
      this.sideSpawnAcc -= 1;
      if (this.sideParticles.length < cap) {
        this.sideParticles.push({
          z: 58 + Math.random() * 12,
          side: Math.random() < 0.5 ? -1 : 1,
          spread: 1.02 + Math.random() * 0.4,    // 道の外側へどれだけ寄せるか
          col: FX.side.colors[(Math.random() * FX.side.colors.length) | 0],
          sz: 0.6 + Math.random() * 0.9
        });
      }
    }
    for (var j = this.sideParticles.length - 1; j >= 0; j--) {
      var p = this.sideParticles[j];
      p.z -= fs * FX.side.speedMul * (0.2 + 0.8 * moving) * dt;
      if (p.z <= 0.3) this.sideParticles.splice(j, 1);
    }
  };

  Runner.prototype.update = function (dt) {
    // ゲートが目の前まで来たら減速して止まる(撃ち続ければ必ず壊せる)
    var targetSpeed = WORLD_SPEED;
    if (this.gates) {
      var nearestZ = this.gates[0].worldZ;
      for (var gi2 = 1; gi2 < this.gates.length; gi2++) nearestZ = Math.min(nearestZ, this.gates[gi2].worldZ);
      if (nearestZ - this.traveled < STOP_Z + 4) targetSpeed = 0;
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
        // ボスは中央1体(this.gates長さ1)、通常は照準側のゲート
        var g = this.gates.length === 1 ? this.gates[0] : (b.aim < 0 ? this.gates[0] : this.gates[1]);
        var gz = g.worldZ - this.traveled;
        if (b.z >= gz - 0.5 && g.hp > 0) {
          g.hp -= b.dmg;
          g.hitFlash = FX.numReact.ms; // 数字・本体の被弾リアクション
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
    var bossSingle = this.gates && this.gates.length === 1 && this.gates[0].boss;
    var aim = this.fx < 0 ? -1 : 1; // 先頭の位置で狙う側を決める(判定基準は先頭だけ)
    var aimFx = bossSingle ? 0 : this.fx; // ボスは中央へ弾を収束
    var shooters = [{ fx: this.fx, y: this.heroY }];
    for (var i = 0; i < this.members.length; i++) {
      var pos = this.memberPos(this.members[i]);
      shooters.push({ fx: pos.fx, y: pos.y });
    }
    var mg = FX.muzzle.glow;
    for (var s = 0; s < shooters.length; s++) {
      this.bullets.push({ z: 1.5, fx0: shooters[s].fx, aim: aim, aimFx: aimFx, dmg: dmg });
      // マズルフラッシュ(銃口の発光)を全員ぶん。重い時は後列を間引く
      if (s === 0 || this.fxScale > 0.6 || Math.random() < this.fxScale) {
        this.particles.push({
          type: 'flash',
          x: this.w / 2 + shooters[s].fx * this.roadHalf, y: shooters[s].y - 26,
          r: mg * 0.5, r0: mg, life: 0.1, life0: 0.1, color: '#fff4b0'
        });
      }
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
      if (p.type === 'flash') {
        p.life -= dt;
      } else if (p.type === 'ring') {
        p.rad += p.vrad * dt;
        p.life -= dt;
      } else { // 火花・破片(shard)・四角・文字ポップ
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (!p.text) p.vy += 420 * dt; // 文字ポップは落下させず浮かせる
        p.rot += p.vr * dt;
        p.life -= dt;
      }
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    // パーティクル総数の上限(古いものから間引く=重い端末でもカクつかない)
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    // ゲートの被弾リアクション減衰
    if (this.gates) {
      for (var gg = 0; gg < this.gates.length; gg++) {
        if (this.gates[gg].hitFlash > 0) this.gates[gg].hitFlash = Math.max(0, this.gates[gg].hitFlash - dt);
      }
      // ボスHPゲージの表示値を現在値へなめらかに追従
      if (this.gates[0].boss) {
        var frac = this.gates[0].hp / this.gates[0].maxHp;
        this.bossGauge += (frac - this.bossGauge) * Math.min(1, dt * 6);
      }
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
    if (isBoss) {
      // ボスは中央1枚パネル。全弾が集中する1ターゲット
      this.gates = [
        { side: 0, worldZ: this.traveled + GATE_DIST, hp: hp, maxHp: hp, core: '🛸', kind: 'boss', boss: true, hitFlash: 0 }
      ];
      this.bossGauge = 1;
      this.slowmo = FX.boss.introSlowmoMs;   // 出現の“タメ”(一瞬の減速)
      this.flash = 0.7;                       // 出現フラッシュ
      this.telop = { life: FX.boss.telopMs, life0: FX.boss.telopMs, t1: 'FINAL!', t2: 'ラストバトル!' };
    } else {
      // 通常は左右2ゲート。敵種は毎問ランダム(ペアは同種)
      var kind = Math.random() < 0.5 ? 'enemy-a' : 'enemy-b';
      this.gates = [
        { side: -1, worldZ: this.traveled + GATE_DIST, hp: hp, maxHp: hp, core: '👾', kind: kind, boss: false, hitFlash: 0 },
        { side: 1, worldZ: this.traveled + GATE_DIST, hp: hp, maxHp: hp, core: '👾', kind: kind, boss: false, hitFlash: 0 }
      ];
    }
    window.AIM_CORE.showBanner(isBoss ? 'ボスとうじょう!ラストバトル!' : 'ゲートが せまってきた!');
  };

  /* 命中演出:火花 + 着弾の小閃光 + 衝撃の波紋。ボスは倍率(fxMul)で派手に */
  Runner.prototype.spark = function (gate) {
    var pos = this.gateCenter(gate);
    var mul = gate.boss ? FX.boss.fxMul : 1;
    var n = Math.max(2, Math.round(FX.hit.sparks * mul * this.fxScale));
    var cols = ['#ffffff', '#ffe14d', '#8af6ff'];
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3; // 主に上〜手前へ弾ける
      var sp = Math.random() * FX.hit.sparkSpeed + 70;
      this.particles.push({
        x: pos.x + (Math.random() * 24 - 12), y: pos.y + (Math.random() * 18 - 9),
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        rot: Math.random() * 6, vr: Math.random() * 10 - 5,
        size: Math.random() * 3 + 2, life: 0.22 + Math.random() * 0.16, color: cols[i % 3]
      });
    }
    // 着弾の小閃光
    this.particles.push({ type: 'flash', x: pos.x, y: pos.y, r: FX.hit.flashR * 0.5 * mul, r0: FX.hit.flashR * mul, life: 0.12, life0: 0.12, color: '#ffffff' });
    // 衝撃の波紋(リング)
    for (var r = 0; r < FX.hit.ring; r++) {
      this.particles.push({ type: 'ring', x: pos.x, y: pos.y, rad: 4, vrad: FX.hit.ringSpeed * mul, life: 0.3, life0: 0.3, lw: 2, color: gate.boss ? '#ff8fd0' : '#8af6ff' });
    }
  };

  /* 破壊演出(パーティクル+画面振動+フラッシュ)→ 完全ポーズ → カードUI */
  Runner.prototype.destroyGate = function (gate) {
    var pos = this.gateCenter(gate);
    var boss = gate.boss;
    var colors = ['#ffe14d', '#62e0ff', this.colors.accent, '#ffffff', this.colors.main];
    // 砕け散る破片(回転する板)
    var shardN = Math.round((boss ? FX.boss.defeatShards : FX.destroy.shards) * this.fxScale);
    for (var i = 0; i < shardN; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = Math.random() * (boss ? 520 : 380) + 80;
      this.particles.push({
        type: 'shard', x: pos.x, y: pos.y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 140,
        rot: Math.random() * 6, vr: Math.random() * 16 - 8,
        w: Math.random() * 8 + 4, h: Math.random() * 4 + 3,
        life: Math.random() * 0.6 + (boss ? 0.7 : 0.45), color: colors[i % colors.length]
      });
    }
    // 衝撃波リング(複数)
    var ringN = boss ? FX.boss.defeatRings : FX.destroy.rings;
    for (var r = 0; r < ringN; r++) {
      this.particles.push({
        type: 'ring', x: pos.x, y: pos.y, rad: 6 + r * 8, vrad: 300 + r * 70,
        life: 0.5 + r * 0.1, life0: 0.6 + r * 0.1, lw: boss ? 4 : 3,
        color: r % 2 ? '#ffffff' : (boss ? '#ff8fd0' : '#8af6ff')
      });
    }
    // 中心の大閃光
    this.particles.push({ type: 'flash', x: pos.x, y: pos.y, r: 20, r0: boss ? 170 : 80, life: 0.3, life0: 0.3, color: '#ffffff' });
    this.shake = boss ? FX.boss.defeatShake : FX.destroy.shake;
    this.flash = boss ? FX.boss.defeatFlash : FX.destroy.flash;
    sound.boom();
    if (boss) {
      this.slowmo = FX.boss.defeatSlowmoMs; // スローモーション風の一拍
      // 紙吹雪のひと吹き(クリア画面の紙吹雪へつなぐ)
      var confN = Math.round(46 * this.fxScale);
      for (var c = 0; c < confN; c++) {
        this.particles.push({
          x: this.w / 2 + (Math.random() - 0.5) * this.w, y: -10,
          vx: (Math.random() - 0.5) * 70, vy: Math.random() * 120 + 70,
          rot: Math.random() * 6, vr: Math.random() * 12 - 6,
          size: Math.random() * 6 + 4, life: 1.5, color: colors[c % colors.length]
        });
      }
    }
    this.gates = null;
    this.item = null;
    this.bullets = [];
    this.state = 'exploding';
    var self = this;
    setTimeout(function () {
      self.state = 'paused'; // 完全ポーズ(回答するまで再開しない)
      self.openCards(self.config.questions[self.idx]);
    }, boss ? FX.boss.defeatMs : 700);
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

    /* 最終問だけ「これで けってい!」で確定。それ以外は選んだら即次へ。
       ただし複数選択(multi)・記述(text)は性質上1タップで進めないため「次へ」ボタンで進む。*/
    var isLast = this.idx === this.config.questions.length - 1;
    var FINAL_LABEL = 'これで けってい!';
    var NEXT_LABEL = 'つぎへ すすむ!';

    if (q.type === 'multi') {
      var selected = [];
      var confirmBtn = makeConfirm(isLast ? FINAL_LABEL : NEXT_LABEL);
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
      var confirmBtn2 = makeConfirm(isLast ? FINAL_LABEL : NEXT_LABEL);
      ta.addEventListener('input', function () {
        confirmBtn2.disabled = ta.value.trim() === '';
      });
      confirmBtn2.addEventListener('click', function () { finish(ta.value.trim()); });
      box.appendChild(ta);
      box.appendChild(confirmBtn2);

    } else if (isLast) { // 最終問が single の場合:選択→「これで けってい!」で確定
      var pending = null;
      var confirmBtn3 = makeConfirm(FINAL_LABEL);
      (q.options || []).forEach(function (opt) {
        var card = makeCard(opt);
        card.addEventListener('click', function () {
          var picked = box.querySelectorAll('.answer-card.picked');
          for (var k = 0; k < picked.length; k++) picked[k].classList.remove('picked');
          card.classList.add('picked'); // 単一選択
          pending = opt;
          confirmBtn3.disabled = false;
        });
        box.appendChild(card);
      });
      confirmBtn3.addEventListener('click', function () { if (pending !== null) finish(pending); });
      box.appendChild(confirmBtn3);

    } else { // single(最終問以外):選んだら即・次へ。確定ボタンは出さない
      (q.options || []).forEach(function (opt) {
        var card = makeCard(opt);
        card.addEventListener('click', function () {
          card.classList.add('picked');
          setTimeout(function () { finish(opt); }, 250); // 選んだ手応えを見せてから進む
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
    function makeConfirm(label) {
      var b = document.createElement('button');
      b.className = 'btn-big cards-confirm';
      b.textContent = label;
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

  /* ドット絵を枠(boxW×boxH)に収めて描く。縦横比は保持。
     anchor='bottom' は (cx,cy) を足元、'center' は中心に合わせる。
     読み込み前は false を返すので、呼び出し側で絵文字にフォールバックできる */
  Runner.prototype.drawSprite = function (name, cx, cy, boxW, boxH, anchor) {
    var im = this.sprites && this.sprites[name];
    if (!im || !im._ready) return false;
    var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!iw || !ih) return false;
    var s = Math.min(boxW / iw, boxH / ih);
    var dw = iw * s, dh = ih * s;
    this.ctx.drawImage(im, cx - dw / 2, anchor === 'bottom' ? cy - dh : cy - dh / 2, dw, dh);
    return true;
  };

  Runner.prototype.draw = function (t) {
    var ctx = this.ctx;
    var w = this.w, h = this.h, cx = w / 2;

    // 背景:宇宙の画像(読み込み前はグラデーションで代用)
    this.drawBackground();

    // 星のワープ(中央収束点から手前へ放射状に流れる・控えめ常時)
    this.drawWarpStars();

    // 星雲の脈動(明滅+色ゆらぎ+わずかな呼吸)
    this.drawNebulaPulse(t);

    // 星(またたき)— 空の範囲にだけ重ねる
    for (var i = 0; i < this.stars.length; i++) {
      var st = this.stars[i];
      ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 1.5 + st.ph));
      ctx.fillStyle = '#fff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // 流れ星(複数本が頻繁に横切る)
    this.drawShootingStars();

    // 地平線のネオン帯(ピンクの光が脈動・明滅)
    this.drawHorizonNeon(t);

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

    // 道路の高速グリッド(奥→手前へ流れ落ちる・疾走感の主役)
    this.drawGridScroll();

    // 中央の破線(走行感。グリッドと同じスクロールで流す)
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (var z = 6 - (this.gridScroll % 6); z < 60; z += 6) {
      var p1 = this.project(z), p2 = this.project(z + 2.2);
      ctx.fillRect(cx - 3 * p1.s, p2.y, 6 * p1.s, p1.y - p2.y);
    }

    // 両サイドの光の粒(道の外側を後方へ高速で流れる)
    this.drawSideParticles();

    // パワーアップアイテム(ドット絵。背後に脈動する光を敷いて目立たせる)
    if (this.item) {
      var ip = this.project(this.item.worldZ - this.traveled);
      var ix = cx + this.item.fx * ip.half;
      var iy = ip.y - 26 * ip.s;
      var ir = 22 * ip.s + 6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(120, 230, 255, ' + (0.18 + 0.12 * Math.sin(t * 6)) + ')';
      ctx.beginPath();
      ctx.arc(ix, iy, ir * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      var box = 48 * ip.s + 16;
      if (!this.drawSprite('item', ix, iy, box, box, 'center')) {
        // フォールバック:従来の⚡光る玉
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
    }

    // ゲート(通常は左右2枚、ボスは中央1枚)
    if (this.gates) {
      for (var gi = 0; gi < this.gates.length; gi++) this.drawGate(this.gates[gi], t);
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
      var mbob = Math.sin(t * 9 + mi) * 2;
      if (!this.drawSprite('ally', mx, mp.y + 12 + mbob, 46, 52, 'bottom')) {
        ctx.fillText('🧑‍🚀', mx, mp.y - 6 + mbob);
      }
    }

    // 先頭の主人公(判定の基準。足元の光で目立たせる)
    var hx = cx + this.fx * this.roadHalf;
    ctx.fillStyle = 'rgba(98, 224, 255, .35)';
    ctx.beginPath();
    ctx.ellipse(hx, this.heroY + 16, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    var hbob = Math.sin(t * 9) * 2;
    if (!this.drawSprite('hero', hx, this.heroY + 18 + hbob, 62, 70, 'bottom')) {
      ctx.font = '40px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧑‍🚀', hx, this.heroY - 8 + hbob);
    }

    // パーティクル(火花・破片・閃光・波紋・文字ポップ)
    for (var pi = 0; pi < this.particles.length; pi++) {
      var pt = this.particles[pi];
      if (pt.type === 'flash') { // 着弾/爆発の発光(加算)
        var fa = Math.max(0, pt.life / pt.life0);
        var fr = Math.max(1, pt.r0 - (pt.r0 - pt.r) * fa);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fa;
        var rg = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, fr);
        rg.addColorStop(0, pt.color);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, fr, 0, Math.PI * 2); ctx.fill();
      } else if (pt.type === 'ring') { // 衝撃波(加算の輪)
        var ra = Math.max(0, pt.life / pt.life0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ra;
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = Math.max(0.5, pt.lw * ra);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.rad, 0, Math.PI * 2); ctx.stroke();
      } else { // 火花・破片・文字
        ctx.globalCompositeOperation = 'source-over';
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
        } else if (pt.type === 'shard') {
          ctx.fillRect(-pt.w / 2, -pt.h / 2, pt.w, pt.h);
        } else {
          ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size);
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // 破壊時の白フラッシュ
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.45) + ')';
      ctx.fillRect(0, 0, w, h);
    }

    // ボスHP大ゲージ(画面上部・最前面)
    if (this.gates && this.gates[0].boss) this.drawBossGauge();
    // 中央テロップ「FINAL! / ラストバトル!」(最前面)
    if (this.telop) this.drawTelop();
  };

  /* ボスHPの大ゲージ(画面上部)。減少は updateFx でなめらかに追従 */
  Runner.prototype.drawBossGauge = function () {
    var ctx = this.ctx, w = this.w, g = this.gates[0];
    var frac = Math.max(0, Math.min(1, this.bossGauge));
    var mx = 16, gw = w - mx * 2, gh = FX.boss.gaugeH, gy = 16;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillStyle = '#ff7bb0'; ctx.fillText('BOSS', mx, gy - 3);
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    ctx.fillText(Math.max(0, Math.round(g.hp)) + ' / ' + g.maxHp, w - mx, gy - 3);
    // 枠の下地
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, mx, gy, gw, gh, gh / 2); ctx.fill();
    // バー(赤→ピンクのグラデ)
    var bw = (gw - 4) * frac;
    if (bw > 0) {
      var lg = ctx.createLinearGradient(mx, 0, mx + gw, 0);
      lg.addColorStop(0, '#ff3b6b'); lg.addColorStop(1, '#ff9ad1');
      ctx.fillStyle = lg;
      roundRect(ctx, mx + 2, gy + 2, Math.max(gh - 4, bw), gh - 4, (gh - 4) / 2); ctx.fill();
    }
    ctx.strokeStyle = '#ff8fd0'; ctx.lineWidth = 2;
    roundRect(ctx, mx, gy, gw, gh, gh / 2); ctx.stroke();
    ctx.restore();
  };

  /* 中央テロップ:出だしでスケールイン→終わりにフェード */
  Runner.prototype.drawTelop = function () {
    var ctx = this.ctx, w = this.w, h = this.h, tp = this.telop;
    var k = Math.max(0, tp.life / tp.life0);   // 1→0
    var appear = Math.min(1, (1 - k) * 5);
    var alpha = Math.min(1, k * 3);
    var scale = 0.65 + appear * 0.45;
    var cx = w / 2, cy = h * 0.34;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 italic ' + Math.round(62 * scale) + 'px sans-serif';
    ctx.lineWidth = 8; ctx.strokeStyle = '#3a0a1e';
    ctx.strokeText(tp.t1, cx, cy);
    var lg2 = ctx.createLinearGradient(0, cy - 36, 0, cy + 36);
    lg2.addColorStop(0, '#fff2a8'); lg2.addColorStop(1, '#ff5fa2');
    ctx.fillStyle = lg2;
    ctx.fillText(tp.t1, cx, cy);
    ctx.font = '900 ' + Math.round(24 * scale) + 'px sans-serif';
    ctx.lineWidth = 6; ctx.strokeStyle = '#3a0a1e';
    ctx.strokeText(tp.t2, cx, cy + 44 * scale);
    ctx.fillStyle = '#fff';
    ctx.fillText(tp.t2, cx, cy + 44 * scale);
    ctx.restore();
  };

  /* 星のワープ:中央収束点から外へ放射状に流れる光の線(ハイパースペース風・控えめ常時)。
     fxScaleで本数を間引き、外周ほど明るく・太く伸ばす */
  Runner.prototype.drawWarpStars = function () {
    var ctx = this.ctx;
    var cx0 = this.w / 2, cy0 = this.horizonY;
    var maxR = Math.hypot(this.w, this.h) * 0.62;
    var n = Math.round(this.warpStars.length * this.fxScale);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#dfe9ff';
    for (var i = 0; i < n; i++) {
      var s = this.warpStars[i];
      var c = Math.cos(s.ang), si = Math.sin(s.ang);
      var prog = Math.min(1, s.rad / maxR);
      ctx.globalAlpha = (0.12 + 0.5 * prog) * FX.warp.intensity;
      ctx.lineWidth = 0.6 + 1.8 * prog;
      ctx.beginPath();
      ctx.moveTo(cx0 + c * s.prev, cy0 + si * s.prev);
      ctx.lineTo(cx0 + c * s.rad, cy0 + si * s.rad);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 地平線のネオン帯:消失点の高さにピンクの光の帯を重ね、脈動+速い明滅(ネオン管風) */
  Runner.prototype.drawHorizonNeon = function (t) {
    var ctx = this.ctx, w = this.w, y = this.horizonY, hh = FX.horizon.height;
    var pulse = FX.horizon.base + FX.horizon.amp * (0.5 + 0.5 * Math.sin(t * FX.horizon.speed));
    var flick = 1 - FX.horizon.flicker * (0.5 + 0.5 * Math.sin(t * 37)) * (0.5 + 0.5 * Math.sin(t * 13.3));
    var a = pulse * flick;
    var g = ctx.createLinearGradient(0, y - hh / 2, 0, y + hh / 2);
    g.addColorStop(0, 'rgba(255,95,168,0)');
    g.addColorStop(0.5, 'rgba(255,95,168,' + a + ')');
    g.addColorStop(1, 'rgba(255,95,168,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(0, y - hh / 2, w, hh);
    // 芯の明るいライン
    ctx.globalAlpha = Math.min(1, a * FX.horizon.core);
    ctx.fillStyle = '#ff9ecb';
    ctx.fillRect(0, y - 1.5, w, 3);
    ctx.restore();
  };

  /* 道路の高速グリッド:奥→手前へ流れ落ちる横ライン。隊列が増えるほど速く・はっきり */
  Runner.prototype.drawGridScroll = function () {
    var ctx = this.ctx, cx = this.w / 2;
    var step = FX.grid.spacing;
    var off = this.gridScroll % step;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = FX.grid.color;
    for (var gz = step - off; gz < 70; gz += step) {
      var gp = this.project(gz);
      ctx.globalAlpha = (0.10 + 0.7 * gp.s) * FX.grid.intensity;
      ctx.lineWidth = Math.max(1, FX.grid.width * gp.s);
      ctx.beginPath();
      ctx.moveTo(cx - gp.half, gp.y);
      ctx.lineTo(cx + gp.half, gp.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 両サイドの光の粒:道の外側ふちを後方(画面外)へ高速で流す。中央レーンには置かない */
  Runner.prototype.drawSideParticles = function () {
    var ctx = this.ctx, cx = this.w / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.sideParticles.length; i++) {
      var p = this.sideParticles[i];
      var gp = this.project(p.z);
      var x = cx + p.side * gp.half * p.spread;
      var y = gp.y;
      var r = Math.max(1, FX.side.size * gp.s * p.sz);
      ctx.globalAlpha = Math.min(1, 0.2 + 0.8 * gp.s) * FX.side.intensity;
      ctx.fillStyle = p.col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // 手前ほど長い縦の尾でスピード感を強調
      ctx.globalAlpha *= 0.45;
      ctx.fillRect(x - r * 0.5, y, r, r * 5 * gp.s);
    }
    ctx.restore();
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

  /* 星雲の脈動:中央上の星雲・惑星まわりに、はっきり明滅+色ゆらぎ+わずかな呼吸(膨張収縮)。
     白飛び防止のため加算合成(lighter)+上限を抑える(screen合成は使わない) */
  Runner.prototype.drawNebulaPulse = function (t) {
    var ctx = this.ctx, w = this.w, h = this.h;
    var glows = [
      { cx: w * 0.56, cy: h * 0.28, col: '255,95,168', ph: 0.0, spd: 1.0 },  // マゼンタ
      { cx: w * 0.40, cy: h * 0.34, col: '98,224,255', ph: 2.1, spd: 0.78 }, // シアン
      { cx: w * 0.50, cy: h * 0.24, col: '170,110,255', ph: 4.0, spd: 0.62 } // 紫(色ゆらぎ用)
    ];
    var r0 = Math.max(w, h) * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < glows.length; i++) {
      var d = glows[i];
      var pulse = 0.5 + 0.5 * Math.sin(t * d.spd * FX.nebula.speed + d.ph);
      var a = FX.nebula.base + FX.nebula.amp * pulse;          // 明滅(はっきり)
      var r = r0 * (1 + FX.nebula.breath * Math.sin(t * d.spd * FX.nebula.speed + d.ph)); // 呼吸
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
      var tx = s.x - s.vx * s.len, ty = s.y - s.vy * s.len; // 尾(速度・長さは個体差)
      var a = Math.max(0, Math.min(1, s.life)) * 0.9;
      var grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grad.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      grad.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = s.w;
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
    // ボスは中央1枚で大きめ
    var gw = p.half * (gate.boss ? 1.5 : 0.88);
    var gh = (130 + (gate.boss ? 90 : 0)) * p.s;
    var gx = cx + gate.side * p.half * 0.5 - gw / 2; // ボスは side=0 で中央
    var gy = p.y - gh;

    // 被弾リアクション:当たった瞬間にゲート全体を小さく揺らす
    var react = gate.hitFlash > 0 ? gate.hitFlash / FX.numReact.ms : 0; // 1→0
    ctx.save();
    if (react > 0) {
      ctx.translate((Math.random() - 0.5) * FX.numReact.shake * react,
                    (Math.random() - 0.5) * FX.numReact.shake * react);
    }

    // エネルギーバリア(半透明パネル+ネオン枠)
    ctx.fillStyle = gate.boss ? 'rgba(255, 90, 90, .25)' : 'rgba(98, 224, 255, .18)';
    ctx.strokeStyle = gate.boss ? '#ff5fa2' : '#62e0ff';
    ctx.lineWidth = Math.max(1.5, 4 * p.s);
    roundRect(ctx, gx, gy, gw, gh, 10 * p.s);
    ctx.fill();
    ctx.stroke();

    // コア(エイリアン/ボスUFO)。背景と同化しないよう白い光彩を敷く
    var coreSize = Math.round((gate.boss ? 56 : 42) * p.s + 8);
    var coreCx = gx + gw / 2;
    var coreY = gy + gh / 2 + Math.sin(t * 4 + gate.side) * 4 * p.s;
    ctx.fillStyle = 'rgba(255, 255, 255, .3)';
    ctx.beginPath();
    ctx.arc(coreCx, coreY, coreSize * 0.9, 0, Math.PI * 2);
    ctx.fill();
    // ドット絵(boss=横長は幅基準で大きめ、enemyはパネルいっぱいに)
    var boxW = gate.boss ? gw * 0.96 : gw * 0.98;
    var boxH = gate.boss ? gh * 0.86 : gh * 0.84;
    if (!this.drawSprite(gate.kind, coreCx, coreY, boxW, boxH, 'center')) {
      ctx.font = coreSize + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(gate.core, coreCx, coreY);
    }
    // ボスは被弾で赤く明滅(リアクション強化)
    if (gate.boss && react > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = react * 0.5;
      ctx.fillStyle = '#ff3b6b';
      ctx.beginPath();
      ctx.arc(coreCx, coreY, coreSize * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 耐久値バッジ(ボスは上部の大ゲージで見せるので小バッジは出さない)
    if (!gate.boss) {
      var label = String(gate.hp);
      ctx.font = 'bold ' + Math.round(13 * p.s + 8) + 'px sans-serif';
      var bw = ctx.measureText(label).width + 22 * p.s + 8;
      var bh = 20 * p.s + 10;
      var bx = gx + gw / 2 - bw / 2;
      var by = gy - bh - 6 * p.s;
      ctx.fillStyle = react > 0 ? '#ff7b6b' : '#e8403a'; // 被弾で明滅
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fill();
      ctx.stroke();
      // 数字は必ず中央寄せで描く(揃え設定の取りこぼしで崩れるため明示)
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, gx + gw / 2, by + bh / 2 + 1);
    }
    ctx.restore();
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
