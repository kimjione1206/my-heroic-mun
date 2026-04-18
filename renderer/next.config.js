/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  images: { unoptimized: true },
  // trailingSlash 비활성: /sheet → sheet.html (out/ 루트에 평탄화)
  //   중첩 디렉토리 + 상대 assetPrefix 조합에서 /_next/ 경로 꼬임 방지
  trailingSlash: false,
  reactStrictMode: true,
  // 프로덕션 export 시 상대경로 (file://). dev 서버는 기본 절대경로 사용.
  ...(process.env.NODE_ENV === 'production' ? { assetPrefix: './' } : {}),
};
