/* モード「runner」:縦スクロール群衆ランナー風(自動走行+2択ゲート)。
   デザインモチーフ:宇宙×アメリカンポップ。
   宇宙飛行士の群れが宇宙ハイウェイを自動で走り、
   - 選択肢がちょうど2個の単一選択 → 左右2枚のゲートをタップして回答
   - それ以外(3択以上・複数選択・自由記述) → 回答ウィンドウ(モーダル)
   回答するとエイリアン集団とのバトルに勝利し、仲間=攻撃力⚡が増える */

(function () {
  'use strict';

  var RUN_MS = 2000;      // 次のイベントまで走る時間(ミリ秒)
  var POWER_START = 5;    // 最初の攻撃力(=仲間の数)
  var POWER_GAIN = 3;     // 1問回答ごとに増える攻撃力
  var MAX_UNITS = 30;     // 画面に表示する仲間の上限(性能対策)

  var $ = window.AIM_CORE.$;

  window.AIM_MODES = window.AIM_MODES || {};
  window.AIM_MODES.runner = {
    start: function (config) { new Runner(config).start(); }
  };

  function Runner(config) {
    this.config = config;
    this.idx = 0;          // いま何問目か
    this.answers = {};     // 回答の記録
    this.power = POWER_START;
    this.units = [];       // 画面上の仲間
  }

  Runner.prototype.start = function () {
    var self = this;
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
    $('#hud-power').textContent = '⚡' + this.power;
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
    $('#hud-power').hidden = false;
    this.addUnits(POWER_START);
    this.scheduleNext();
  };

  Runner.prototype.scheduleNext = function () {
    var self = this;
    setTimeout(function () { self.presentQuestion(); }, RUN_MS);
  };

  /* 仲間(宇宙飛行士)を群れに追加。表示はMAX_UNITSまで、数は⚡で管理 */
  Runner.prototype.addUnits = function (n) {
    var crowd = $('#crowd');
    for (var i = 0; i < n && this.units.length < MAX_UNITS; i++) {
      var u = document.createElement('span');
      u.className = 'unit';
      u.textContent = '🧑‍🚀';
      var k = this.units.length;
      var col = k % 5;
      var row = Math.floor(k / 5);
      u.style.left = (col * 30 + (row % 2) * 13 + (Math.random() * 8 - 4)) + 'px';
      u.style.bottom = (row * 20 + (Math.random() * 6 - 3)) + 'px';
      u.style.animationDelay = (Math.random() * 0.5) + 's';
      crowd.appendChild(u);
      this.units.push(u);
    }
  };

  Runner.prototype.presentQuestion = function () {
    var q = this.config.questions[this.idx];
    var self = this;
    if (q.type === 'single' && (q.options || []).length === 2) {
      this.showGates(q);
    } else {
      window.AIM_CORE.showBanner('エイリアンの たいぐんが みちを ふさいだ!');
      setTimeout(function () {
        window.AIM_QUESTIONS.open(q, self.idx + 1, self.config.questions.length, function (value) {
          self.onAnswer(q, value);
        });
      }, 800);
    }
  };

  /* 2択ゲート:タップしたゲートをくぐる=回答 */
  Runner.prototype.showGates = function (q) {
    var self = this;
    var gates = $('#gates');
    gates.innerHTML = '';
    var label = document.createElement('p');
    label.className = 'gate-question';
    label.textContent = q.text;
    gates.appendChild(label);
    var row = document.createElement('div');
    row.className = 'gate-row';
    q.options.forEach(function (opt, i) {
      var b = document.createElement('button');
      b.className = 'gate ' + (i === 0 ? 'gate-l' : 'gate-r');
      b.textContent = opt;
      b.addEventListener('click', function () {
        gates.hidden = true;
        self.onAnswer(q, opt);
      });
      row.appendChild(b);
    });
    gates.appendChild(row);
    gates.hidden = false;
    window.AIM_CORE.showBanner('ゲートが せまってきた!どっちを えらぶ?');
  };

  Runner.prototype.onAnswer = function (q, value) {
    this.answers[q.id] = value;
    this.startBattle(q);
  };

  /* バトル:数字付きの敵が現れ、群れが突撃 → 数字が0になり勝利 → ⚡が増える */
  Runner.prototype.startBattle = function (q) {
    var self = this;
    var isBoss = q.event === 'boss' || this.idx === this.config.questions.length - 1;
    var foe = $('#foe');
    foe.innerHTML = '';
    foe.className = isBoss ? 'boss' : '';

    var body = document.createElement('div');
    body.className = 'foe-body';
    if (isBoss) {
      body.textContent = '🛸';
    } else {
      for (var i = 0; i < 6; i++) {
        var a = document.createElement('span');
        a.textContent = '👽';
        body.appendChild(a);
      }
    }
    foe.appendChild(body);

    var foePower = Math.max(1, this.power - 1); // 必ず勝てる数にする(失敗要素なし)
    var num = document.createElement('div');
    num.className = 'foe-num';
    num.textContent = foePower;
    foe.appendChild(num);
    foe.hidden = false;

    window.AIM_CORE.showBanner(isBoss ? 'ボスUFOが あらわれた!' : 'エイリアンと バトル!');

    setTimeout(function () {
      $('#crowd').classList.add('attack');
      body.classList.add('foe-hit');
      /* 敵の数字が0までカウントダウン */
      var left = foePower;
      var tick = setInterval(function () {
        left -= Math.max(1, Math.ceil(foePower / 20));
        if (left <= 0) {
          clearInterval(tick);
          num.textContent = '0';
          self.winBattle(foe);
        } else {
          num.textContent = left;
        }
      }, 45);
    }, 700);
  };

  Runner.prototype.winBattle = function (foe) {
    var self = this;
    /* アメコミ風「POW!」バースト */
    var pow = document.createElement('div');
    pow.className = 'pow';
    pow.textContent = 'POW!';
    foe.appendChild(pow);

    setTimeout(function () {
      foe.hidden = true;
      $('#crowd').classList.remove('attack');
      self.power += POWER_GAIN;
      self.addUnits(POWER_GAIN);
      self.idx++;
      self.updateHud();
      window.AIM_CORE.showBanner('やっつけた!なかまが ふえた!⚡+' + POWER_GAIN);
      if (self.idx >= self.config.questions.length) {
        setTimeout(function () {
          window.AIM_CORE.showClear(self.config, 'GAME CLEAR!', self.answers);
        }, 1200);
      } else {
        self.scheduleNext();
      }
    }, 800);
  };
})();
