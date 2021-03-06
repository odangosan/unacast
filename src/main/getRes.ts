import express from 'express';
import bodyParser from 'body-parser'; // jsonパーサ
const router = express.Router();
import log from 'electron-log';
import ReadIcons from './ReadIcons'; //アイコンファイル名取得
const readIcons = new ReadIcons();

import { createDom } from './startServer';
import ReadSitaraba from './readBBS/readSitaraba'; // したらば読み込み用モジュール
import Read5ch from './readBBS/Read5ch'; // 5ch互換板読み込み用モジュール
const sitaraba = new ReadSitaraba();
const read5ch = new Read5ch();
// 掲示板読み込みモジュール、一度決定したら使いまわすためにグローバル宣言
let bbsModule: ReadSitaraba | ReadSitaraba = null as any;

// リクエストのbodyをパース下りエンコードしたりするためのやつ
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());

/**
 * ブラウザからの初期処理リクエスト
 */
router.get('/', async (req, res, next) => {
  // リクエストからURLとレス番号を取得する
  const threadUrl: string = globalThis.config.url;
  // レス番号取得
  const resNum: number = globalThis.config.resNumber ? Number(globalThis.config.resNumber) : NaN;
  res.header('Content-Type', 'application/json; charset=UTF-8');

  const result = await getRes(threadUrl, resNum);

  // 末尾のレス番号を保存
  if (result.length > 0 && result[result.length - 1].number) {
    globalThis.electron.threadNumber = Number(result[result.length - 1].number);
  } else {
    // 読み込み失敗時はとりあえず指定されたレス番か1にする
    globalThis.electron.threadNumber = resNum ? resNum : 1;
  }
  // 初回なのでキューを初期化
  // サーバー立てるとこで初期化してる
  // globalThis.electron.commentQueueList = [];

  result.shift();
  const doms = result.map((item) => createDom(item));
  res.send(JSON.stringify(doms));
});

export const getResInterval = async () => {
  if (globalThis.electron.threadNumber > 0) {
    const result = await getRes(globalThis.config.url, globalThis.electron.threadNumber);
    // 指定したレス番は除外対象
    result.shift();
    if (result.length > 0 && result[result.length - 1].number) {
      globalThis.electron.threadNumber = Number(result[result.length - 1].number);
      globalThis.electron.commentQueueList.push(...result);
    }
    notifyThreadResLimit();
  }
};

/**
 * 掲示板のレスを取得する
 * @param threadUrl スレのURL
 * @param resNum この番号以降を取得する
 */
const getRes = async (threadUrl: string, resNum: number): Promise<UserComment[]> => {
  try {
    // リクエストURLを解析し、使用するモジュールを変更する
    bbsModule = analysBBSName(threadUrl) as any;

    // 選択したモジュールでレス取得処理を行う
    const response = await bbsModule.read(threadUrl, resNum);
    globalThis.electron.threadConnectionError = 0;
    console.log(`[getRes.js] fetch res end resNum = ${resNum}, result = ${response.length}`);

    return response.map((res) => {
      return {
        ...res,
        imgUrl: readIcons.getRandomIcons(),
      };
    });
  } catch (e) {
    log.error(e);
    if (globalThis.config.notifyThreadConnectionErrorLimit > 0) {
      globalThis.electron.threadConnectionError += 1;
      if (globalThis.electron.threadConnectionError >= globalThis.config.notifyThreadConnectionErrorLimit) {
        globalThis.electron.threadConnectionError = 0;
        return [
          {
            name: 'unacastより',
            imgUrl: './img/unacast.png',
            text: '掲示板が規定回数通信エラーになりました。設定を見直すか、掲示板URLを変更してください。',
          },
        ];
      }
    }
    return [];
  }
};

/*
 * URLをみてどこのBBSか判定して使用するモジュールを返却する
 */
const analysBBSName = (threadUrl: string) => {
  // したらばドメイン名
  const sitarabaDomain = 'jbbs.shitaraba.net';
  // こんな感じで必要に応じて増やしていけばいいんじゃね？
  // const dokkanoBBS = 'dokka.bbs.com';

  if (threadUrl.indexOf(sitarabaDomain) !== -1) {
    // URLにしたらばドメイン名が入ってればしたらば
    return sitaraba;
  }
  // どこにも該当しなかったらとりあえず5chで
  // この辺も対応ドメインリストとか作ってちゃんと判定したほうがよさそう
  return read5ch;
};

/** エラー回数が規定回数以上かチェックして、超えてたら通知する */
const notifyThreadResLimit = () => {
  if (globalThis.config.notifyThreadResLimit > 0 && globalThis.electron.threadNumber >= globalThis.config.notifyThreadResLimit) {
    globalThis.electron.commentQueueList.push({
      name: 'unacastより',
      imgUrl: './img/unacast.png',
      text: `レスが${globalThis.config.notifyThreadResLimit}を超えました`,
    });
  }
};

export default router;
