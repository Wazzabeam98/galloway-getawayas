import Link from 'next/link';
import React from 'react';

const Logo = () => {
  return (
    <Link href="/" className="flex items-center gap-3 group">
      {/* Overlapping GG Badge */}
      <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-950 shadow-md border border-emerald-900 group-hover:scale-105 transition-transform">
        <span className="text-emerald-400 font-serif font-black text-xl tracking-tighter select-none -mr-1">
          G
        </span>
        <span className="text-emerald-200 font-serif font-black text-xl tracking-tighter select-none opacity-70">
          G
        </span>
      </div>

      {/* Galloway Getaways Title */}
      <div className="flex flex-col">
        <span className="text-lg font-extrabold tracking-tight text-stone-900 leading-none">
          Galloway
        </span>
        <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-700 uppercase mt-0.5">
          Getaways
        </span>
      </div>
    </Link>
  );
};

export default Logo;