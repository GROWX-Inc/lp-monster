/* ゲームテーマ「adventure(冒険)」。
   テーマ = フィールドの見た目・登場キャラ・セリフのセット。
   新テーマを追加するときは、このファイルをコピーして
   engine/themes/○○.js を作り AIM_THEMES.○○ に登録するだけでよい
   (engine本体の修正は不要)*/

window.AIM_THEMES = window.AIM_THEMES || {};

window.AIM_THEMES.adventure = {
  label: '冒険',
  hero: '🧙',
  sprites: {
    enemy: ['👾', '🦇', '👻', '🐍', '🕷️'],
    chest: '🎁',
    boss: '🐲'
  },
  fieldDecorations: ['🌲', '🌳', '🌵', '🪨', '🍄', '🌾'],
  /* 夜の冒険イメージの背景(白背景は使わない) */
  fieldBackground: 'linear-gradient(#27345e 0%, #45406e 60%, #6b5380 100%)',
  messages: {
    encounter: {
      enemy: 'モンスターが あらわれた!',
      chest: 'たからばこを みつけた!',
      boss: 'ボスが あらわれた!'
    },
    resolve: {
      enemy: 'モンスターを たおした!',
      chest: 'たからばこを あけた!',
      boss: 'ボスを たおした!'
    },
    clearTitle: 'GAME CLEAR!'
  }
};
