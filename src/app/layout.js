import './globals.css';

export const metadata = {
  title: 'teamval',
  description: 'Analyze Valorant team agent compositions by map and region.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
