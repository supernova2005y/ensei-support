import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listEventIds, loadEvent } from '@/lib/events.ts';
import EventView from '../../_components/EventView.tsx';

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
  return <EventView event={event} baseId={id} />;
}
