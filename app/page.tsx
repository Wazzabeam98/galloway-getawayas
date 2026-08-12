import Hero from '@/components/base/Hero';
import Categories from '@/components/common/Categories';
import HomeCard from '@/components/common/HomeCard';
import { getHomes } from '@/lib/getHomes';

export default async function Home() {
  const homes = await getHomes();

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Hospitable-style Kirkcudbright Hero Banner */}
      <Hero />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Category Filters */}
        <div className="mb-10">
          <Categories />
        </div>

        {/* Section Heading */}
        <div className="mb-6 border-b pb-3">
          <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
            Our Properties
          </h2>
          <p className="text-stone-600 text-sm mt-1">
            Handpicked holiday rentals in Dumfries & Galloway
          </p>
        </div>

        {/* Property Grid */}
        {homes && homes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {homes.map((home: any) => (
              <HomeCard key={home.id} data={home} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
            <h3 className="text-lg font-semibold text-stone-800">
              No properties listed yet
            </h3>
            <p className="text-stone-500 mt-1">
              Add your first Kirkcudbright property using the "Add homes" button top right!
            </p>
          </div>
        )}
      </div>
    </main>
  );
}