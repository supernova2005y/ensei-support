import Link from 'next/link';
import { listVenueOptions } from '@/lib/customEvent.ts';
import { eventDate, formatDateJa, listEventIds, loadEvent } from '@/lib/events.ts';

// トップ：「どの公演に行く？」の質問に答えて、その公演の寄り道の計画へ進む
export default function Home() {
  const events = listEventIds()
    .map((id) => ({ id, event: loadEvent(id)! }))
    .sort((a, b) => eventDate(a.event).localeCompare(eventDate(b.event)));
  const venues = listVenueOptions();

  return (
    <main className="section">
      <div className="section-head">
        <h1>どの公演に行く？</h1>
      </div>
      <div className="trip-opts">
        {events.map(({ id, event }) => (
          <Link key={id} className="trip-opt" href={`/events/${id}`}>
            <span className="t">{event.artist ?? event.name}</span>
            <span className="d">
              {formatDateJa(eventDate(event))}・{event.venue.name}
            </span>
          </Link>
        ))}
      </div>

      <div className="section-head">
        <h2 id="t-custom">自分の公演で調べる</h2>
      </div>
      {/* 送ると /plan?venue=…&date=…&start=… を開く（JavaScript なしでも動く） */}
      <form className="form" action="/plan" method="get" aria-labelledby="t-custom">
        <div className="field-row">
          <label htmlFor="venue">会場</label>
          <select id="venue" name="venue" required>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="date">日付</label>
          <input id="date" name="date" type="date" required />
        </div>
        <div className="field-row">
          <label htmlFor="start">開演</label>
          <input id="start" name="start" type="time" min="09:00" max="21:00" defaultValue="18:00" required />
        </div>
        <button className="btn" type="submit">
          この公演で調べる
        </button>
        <p className="note">
          会場は、いまは帰りの便と駅を調べてある{venues.length}か所から選べます。
        </p>
      </form>
    </main>
  );
}
