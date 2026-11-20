// 自分の公演で調べる：/plan?venue=live-b&date=2027-03-06&start=18:00
// 会場は events/*.json にある会場から選び、日付と開演時刻だけを差し替えて、公演の画面と同じ中身を出す。
// URL の値から作るので、ビルドのときではなく開くたびに描く。

import type { Metadata } from 'next';
import Link from 'next/link';
import { buildCustomEvent, checkDate, checkStart, listVenueOptions } from '@/lib/customEvent.ts';
import { loadEvent } from '@/lib/events.ts';
import EventView from '../_components/EventView.tsx';

export const metadata: Metadata = { title: 'あなたの公演｜遠征プランナー' };

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function PlanPage({ searchParams }: Props) {
  const q = await searchParams;
  const venueId = one(q.venue);
  const date = one(q.date);
  const start = one(q.start);

  const base = listVenueOptions().some((v) => v.id === venueId) ? loadEvent(venueId) : null;
  const problem = !base ? '会場を選んでください。' : (checkDate(date) ?? checkStart(start));

  if (!base || problem) {
    return (
      <main className="section">
        <h1>自分の公演で調べる</h1>
        <p className="error" role="alert">
          {problem}
        </p>
        <p>
          <Link href="/">入力に戻る</Link>
        </p>
      </main>
    );
  }

  return <EventView event={buildCustomEvent(base, { date, start })} baseId={venueId} custom={{ date, start }} />;
}
