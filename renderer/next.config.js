/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  // Electron file:// 프로토콜에서 /_next/static/ 절대경로가 루트를 찾지 못함.
  // 상대경로로 변환해 동일 디렉토리에서 chunk 로드.
  assetPrefix: './',
};
