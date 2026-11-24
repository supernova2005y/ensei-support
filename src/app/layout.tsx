import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '遠征プランナー',
  description: 'ライブ遠征の宿・帰りの便をまとめて調べる',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@500;600&display=swap"
        />
      </head>
      <body>
        <div className="wrap">
          <nav className="site">
            <Link href="/">遠征プランナー</Link>
          </nav>
          {children}
          <footer className="site-foot">
            <p>
              宿の空室・料金は楽天トラベルの情報です。予約リンクには楽天アフィリエイトのリンク（広告）を含みます。料金は予約ページで必ず確かめてください。
            </p>
            <p>
              <a href="https://developers.rakuten.com/" target="_blank" rel="noopener">
                Supported by Rakuten Developers
              </a>
            </p>
            <p>
              Powered by{' '}
              <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener">
                ホットペッパーグルメ Webサービス
              </a>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
