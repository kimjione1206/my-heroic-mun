import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>나만의 영웅문</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
