/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  // Electron file:// 프로토콜에서 /_next/static/ 절대경로가 루트를 찾지 못함.
  // 프로덕션 export 시에만 상대경로. dev 서버(http://localhost:3000) 는 절대경로 유지.
  ...(process.env.NODE_ENV === 'production' ? { assetPrefix: './' } : {}),
};
