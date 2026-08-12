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
      <body className="bg-white text-slate-900 antialiased">
        <Navbar />
        {children}
      </body>
    </html>
  );
}