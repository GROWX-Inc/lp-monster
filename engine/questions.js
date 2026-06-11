/* 質問モーダル(画面に重なる質問ウィンドウ)の表示と回答の受け取り。
   3タイプ対応: single=単一選択 / multi=複数選択 / text=自由記述
   回答するまで閉じられない(閉じるボタンを設けない)*/

(function () {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* question: configの質問1件 / num,total: 表示用「Q2/6」 / onAnswer(回答値) */
  function open(question, num, total, onAnswer) {
    var modal = document.querySelector('#modal');
    modal.innerHTML = '';
    var box = el('div', 'q-box');
    box.appendChild(el('span', 'q-label', 'Q' + num + ' / ' + total));
    box.appendChild(el('p', 'q-text', question.text));

    function answer(value) {
      close();
      onAnswer(value);
    }

    if (question.type === 'single') {
      (question.options || []).forEach(function (opt) {
        var btn = el('button', 'q-option', opt);
        btn.addEventListener('click', function () { answer(opt); });
        box.appendChild(btn);
      });

    } else if (question.type === 'multi') {
      var selected = [];
      var confirmBtn = el('button', 'btn-big q-confirm', 'これで こうげき!');
      confirmBtn.disabled = true;
      (question.options || []).forEach(function (opt) {
        var btn = el('button', 'q-option', opt);
        btn.addEventListener('click', function () {
          var i = selected.indexOf(opt);
          if (i >= 0) { selected.splice(i, 1); btn.classList.remove('selected'); }
          else { selected.push(opt); btn.classList.add('selected'); }
          confirmBtn.disabled = selected.length === 0;
        });
        box.appendChild(btn);
      });
      confirmBtn.addEventListener('click', function () { answer(selected.slice()); });
      box.appendChild(confirmBtn);

    } else { // text(自由記述)
      var ta = el('textarea', 'q-textarea');
      ta.rows = 4;
      ta.placeholder = '自由にご記入ください';
      var confirmBtn2 = el('button', 'btn-big q-confirm', 'これで こうげき!');
      confirmBtn2.disabled = true;
      ta.addEventListener('input', function () {
        confirmBtn2.disabled = ta.value.trim() === '';
      });
      confirmBtn2.addEventListener('click', function () { answer(ta.value.trim()); });
      box.appendChild(ta);
      box.appendChild(confirmBtn2);
    }

    modal.appendChild(box);
    modal.hidden = false;
  }

  function close() {
    var modal = document.querySelector('#modal');
    modal.hidden = true;
    modal.innerHTML = '';
  }

  window.AIM_QUESTIONS = { open: open, close: close };
})();
