/* 回答の送信(GoogleフォームへのPOST方式)。
   送信先URLに「PLACEHOLDER」が含まれる間は仮設定とみなし、送信せずログ出力のみ。
   要確認: Googleフォームへの外部POSTは no-cors(他サイトへの送信を許す代わりに
   結果を読めないブラウザの決まり)で行うため、送信の成否はプログラム側で確認できない。
   実運用前に実フォームでの送達テストが必要 */

(function () {
  'use strict';

  async function send(config, answers) {
    var s = config.submit || {};
    var action = s.googleFormAction || '';
    if (!action || action.indexOf('PLACEHOLDER') >= 0) {
      console.log('[AI MONSTER] 送信先が仮設定のため送信をスキップしました:', answers);
      return { sent: false, reason: 'placeholder' };
    }
    var fd = new FormData();
    var map = s.fieldMap || {};
    Object.keys(answers).forEach(function (qid) {
      var field = map[qid];
      if (!field) return;
      var val = answers[qid];
      fd.append(field, Array.isArray(val) ? val.join('、') : val);
    });
    try {
      await fetch(action, { method: 'POST', mode: 'no-cors', body: fd });
      return { sent: true }; // 送信要求は行った(no-corsのため成否は読めない)
    } catch (e) {
      return { sent: false, reason: 'error' };
    }
  }

  window.AIM_SUBMIT = { send: send };
})();
