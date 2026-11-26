// 公演の画面の中身（見出し・日帰りできる？・どこに泊まる？）。
// 用意した公演（/events/[id]）と、自分の公演で調べる画面（/plan）の両方で使う。サーバー側で描く。

import { eventDate, formatDateJa, type EventConfig } from '@/lib/events.ts';
import { loadItineraryData } from '@/lib/itineraryData.ts';
import { missingRakutenKeys, rakutenSetupHint } from '@/lib/rakuten.ts';
import EventStays from './EventStays.tsx';
import TripPlanner from './TripPlanner.tsx';
import { judgeLastTrains } from '@/lib/lastTrain.ts';
import { loadLastTrainTable } from '@/lib/lastTrainData.ts';

export default function EventView(props: {
  event: EventConfig;
  baseId: string; // 宿を探すときに使う会場の設定ファイルの id
  custom?: { date: string; start: string };
}) {
  const { event, baseId, custom } = props;
  const { venue } = event;
  const times = [venue.open && `開場${venue.open}`, venue.start && `開演${venue.start}`].filter(Boolean).join(' ');
  // 楽天のキーがない環境（手元で初めて動かしたとき・CI）では、押す前に案内を出してボタンを止める。
  // 用意した公演のページはビルドのときに作るので、Vercel でキーを足したら再デプロイが要る（docs/vercel-setup.md）
  const missingKeys = missingRakutenKeys();
  const staysSetupMessage = missingKeys.length
    ? `楽天APIのキー（${missingKeys.join('、')}）がまだ設定されていません。${rakutenSetupHint()}`
    : undefined;
  // 寄り道の候補（data/<公演の id>.json）。自分の公演の画面も、会場の候補を使う（日付だけ変わる）
  const trip = loadItineraryData(baseId);
  // 帰りの最終便に間に合うかの判定。泊まり方を選ぶ画面で、選ぶ前だけ見せる（選んだら消す）
  const lastTrain = judgeLastTrains(event, loadLastTrainTable());
  const staysProps = {
    eventId: baseId,
    checkin: event.checkin,
    checkout: event.checkout,
    venueName: venue.name,
    custom,
    setupMessage: staysSetupMessage,
  };

  return (
    <main className="wrap">
      <header className="event-head">
        {/* 見出しはアーティスト名、わかっていれば公演（ツアー）名、日付は改行して出す */}
        <h1>
          <span className="artist">{event.artist ?? event.name}</span>
          {event.tourName && <span className="tour">{event.tourName}</span>}
          <span className="date">{formatDateJa(eventDate(event))}</span>
        </h1>
        {/* 日付は見出しにあるので、ここには会場・時刻・出発地だけ */}
        <p className="meta">
          {[venue.name, times, event.origin && `${event.origin.name}発`]
            .filter(Boolean)
            .map((item, i) => (
              // 「名古屋／駅発」のように言葉の途中で折り返さないよう、項目ごとにまとめる
              <span key={i} className="meta-item">
                {i > 0 && '・'}
                {item}
              </span>
            ))}
        </p>
        <p className="note">名古屋以外の出発・帰宅地は未対応。</p>
      </header>

      {/* 寄り道の候補があるときは、泊まり方と宿は寄り道の画面の中に入る。候補がない公演では、泊まり方と宿だけ出す */}
      {trip ? (
        <TripPlanner data={trip} stays={staysProps} eventId={baseId} lastTrain={lastTrain} />
      ) : (
        <EventStays {...staysProps} lastTrain={lastTrain} />
      )}
    </main>
  );
}
