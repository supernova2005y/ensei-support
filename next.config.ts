import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // /api/stays は呼ばれるたびに events/*.json を読むので、Vercel に上げる関数に同梱する
  // （画面のほうはビルドのときに events/ と data/ を読んで作るので、同梱しなくてよい）
  outputFileTracingIncludes: {
    '/api/stays': ['./events/**/*.json'],
  },
};

export default nextConfig;
