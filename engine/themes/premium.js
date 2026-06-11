/* ゲームテーマ「premium(プレミアム)」— 画像素材版。
   現在は仮の単色プレースホルダ画像(SVG)で動作する。
   実素材(AI生成画像)が揃ったら:
   1. engine/themes/premium/ に WebP変換・圧縮した画像を置く
   2. 下の ext を '.svg' から '.webp' に変える
   3. 歩行コマが増える場合は hero.frames に追記する
   これだけで差し替え完了(engine本体・このファイルの他の場所は無修正)*/

window.AIM_THEMES = window.AIM_THEMES || {};

window.AIM_THEMES.premium = {
  label: 'プレミアム',
  type: 'image',
  assets: 'engine/themes/premium/',
  ext: '.svg', // 実素材が揃ったら '.webp' に変更

  /* 背景3層。speed = 流れる速さ(1が主人公と同じ速さ。小さいほど遠くに見える)*/
  layers: [
    { file: 'bg-far',  speed: 0.2 },
    { file: 'bg-mid',  speed: 0.5 },
    { file: 'bg-near', speed: 1.0, size: 'auto 55%' } // 近景は画面下部のみに表示
  ],

  hero: {
    frames: ['hero-walk-1', 'hero-walk-2'] // 歩行コマ(最大4コマまで追加可)
  },

  sprites: {
    enemy: ['enemy-a', 'enemy-b'],
    chest: 'chest',
    chestOpen: 'chest-open',
    boss: 'boss'
  },

  hud: { frame: 'hud-frame' },

  /* 表示幅(px)。素材の絵柄に合わせて調整する */
  sizes: { hero: 64, enemy: 72, chest: 64, boss: 96 },

  /* 背景画像が読み込まれるまでのつなぎの色 */
  fieldBackground: 'linear-gradient(#2b3a67 0%, #8a6db1 100%)',

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
