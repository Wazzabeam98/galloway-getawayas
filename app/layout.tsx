export const dynamic = 'force-dynamic';

import './globals.css';
import 'react-toastify/dist/ReactToastify.css';
import Navbar from '@/components/base/Navbar';
import { ToastContainer } from 'react-toastify';

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
        <ToastContainer position="top-center" />
      </body>
    </html>
  );
}
