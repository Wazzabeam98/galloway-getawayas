export const dynamic = 'force-dynamic';
import './globals.css';
import Navbar from '@/components/base/Navbar';

export const metadata = {
  title: 'Galloway Getaways',
  description: 'Handpicked holiday rentals in Dumfries & Galloway',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        {children}
      </body>
    </html>
  );
}