import Hero from '@/components/base/Hero';
import Categories from '@/components/common/Categories';

export default function Home() {
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

        {/* Empty State / Property Container */}
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-stone-200">
          <h3 className="text-lg font-semibold text-stone-800">
            No properties listed yet
          </h3>
          <p className="text-stone-500 mt-1 max-w-md mx-auto">
            Ready to list your Kirkcudbright holiday stay? Click <strong>Add homes</strong> in the top menu to publish your first property!
          </p>
        </div>
      </div>
    </main>
  );
}