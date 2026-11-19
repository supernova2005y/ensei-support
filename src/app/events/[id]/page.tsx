import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eventDate, formatDateJa, listEventIds, loadEvent } from '@/lib/events.ts';
import { judgeLastTrains } from '@/lib/lastTrain.ts';
import { loadLastTrainTable } from '@/lib/lastTrainData.ts';
import LastTrainCard from './LastTrainCard.tsx';
import StaysPanel from './StaysPanel.tsx';

// 公演のページはビルドのときに events/*.json から作る（公演を足したら再デプロイ）
export const dynamicParams = false;

export function generateStaticParams() {
  return listEventIds().map((id) => ({ id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = loadEvent((await params).id);
  return { title: event ? `${event.artist ?? event.name}｜遠征プランナー` : '遠征プランナー' };
}

export default async function EventPage({ params }: Props) {
  const { id } = await params;
  const event = loadEvent(id);
  if (!event) notFound();
  const lastTrain = judgeLastTrains(event, loadLastTrainTable());
  const { venue } = event;
  const times = [venue.open && `開場${venue.open}`, venue.start && `開演${venue.start}`].filter(Boolean).join(' ');

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
      </header>

      {lastTrain && <LastTrainCard judgment={lastTrain} />}

      <StaysPanel
        eventId={id}
        checkin={event.checkin}
        checkout={event.checkout}
        venueName={venue.name}
      />
    </main>
  );
}
