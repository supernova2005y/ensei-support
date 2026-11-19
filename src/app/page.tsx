import Link from 'next/link';
import { eventDate, formatDateJa, listEventIds, loadEvent } from '@/lib/events.ts';

export default function Home() {
  const events = listEventIds()
    .map((id) => ({ id, event: loadEvent(id)! }))
    .sort((a, b) => eventDate(a.event).localeCompare(eventDate(b.event)));

  return (
    <main className="section">
      <div className="section-head">
        <h1>遠征する公演</h1>
      </div>
      <p className="note">公演を選ぶと、会場の周りの空室と、帰りの最終便に間に合うかを調べます。</p>
      <ul className="event-list">
        {events.map(({ id, event }) => (
          <li key={id}>
            <Link className="event-link" href={`/events/${id}`}>
              <span className="t">{event.artist ?? event.name}</span>
              <span className="note">
                {formatDateJa(eventDate(event))}・{event.venue.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
