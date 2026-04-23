const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Bizdak database...');

  // Cities
  const dakar = await prisma.city.upsert({
    where: { slug: 'dakar' },
    update: {},
    create: { name: 'Dakar', slug: 'dakar', country: 'Senegal', lat: 14.7167, lng: -17.4677 },
  });

  const houston = await prisma.city.upsert({
    where: { slug: 'houston' },
    update: {},
    create: { name: 'Houston', slug: 'houston', country: 'United States', lat: 29.7604, lng: -95.3698 },
  });

  const capeTown = await prisma.city.upsert({
    where: { slug: 'cape-town' },
    update: {},
    create: { name: 'Cape Town', slug: 'cape-town', country: 'South Africa', lat: -33.9249, lng: 18.4241 },
  });

  // Tags
  const tags = await Promise.all([
    prisma.tag.upsert({ where: { slug: 'food' },     update: {}, create: { name: 'Food',        slug: 'food' } }),
    prisma.tag.upsert({ where: { slug: 'fashion' },  update: {}, create: { name: 'Fashion',     slug: 'fashion' } }),
    prisma.tag.upsert({ where: { slug: 'electronics' }, update: {}, create: { name: 'Electronics', slug: 'electronics' } }),
    prisma.tag.upsert({ where: { slug: 'beauty' },   update: {}, create: { name: 'Beauty',      slug: 'beauty' } }),
    prisma.tag.upsert({ where: { slug: 'services' }, update: {}, create: { name: 'Services',    slug: 'services' } }),
  ]);

  const [food, fashion, electronics] = tags;

  // Stores – Dakar
  const store1 = await prisma.store.upsert({
    where: { id: 'seed-store-001' },
    update: {},
    create: {
      id: 'seed-store-001',
      name: 'Marché Sandaga',
      description: 'Central market with fashion, food and everyday goods.',
      address: 'Avenue Lamine Guèye, Dakar',
      lat: 14.6937,
      lng: -17.4441,
      cityId: dakar.id,
    },
  });

  const store2 = await prisma.store.upsert({
    where: { id: 'seed-store-002' },
    update: {},
    create: {
      id: 'seed-store-002',
      name: 'Chez Fatou Resto',
      description: 'Traditional Senegalese cuisine in the heart of Dakar.',
      address: 'Rue Vincens, Dakar',
      lat: 14.6917,
      lng: -17.4399,
      cityId: dakar.id,
    },
  });

  // Deals
  const now = new Date();
  const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  await prisma.deal.upsert({
    where: { id: 'seed-deal-001' },
    update: {},
    create: {
      id: 'seed-deal-001',
      title: '30% off all fabrics this week',
      description: 'Huge selection of wax print fabrics at 30% off. Limited stock.',
      originalPrice: 5000,
      discountedPrice: 3500,
      discountPercent: 30,
      startDate: now,
      endDate: inTwoWeeks,
      cityId: dakar.id,
      storeId: store1.id,
      isActive: true,
      tags: { create: [{ tag: { connect: { id: fashion.id } } }] },
    },
  });

  await prisma.deal.upsert({
    where: { id: 'seed-deal-002' },
    update: {},
    create: {
      id: 'seed-deal-002',
      title: 'Thiéboudienne lunch special – 1500 FCFA',
      description: 'Full plate of thiéboudienne including a drink. Weekdays 12–15h.',
      discountedPrice: 1500,
      startDate: now,
      endDate: inTwoWeeks,
      cityId: dakar.id,
      storeId: store2.id,
      isActive: true,
      tags: { create: [{ tag: { connect: { id: food.id } } }] },
    },
  });

  console.log(`Seeded:
  - Cities: Dakar, Abidjan
  - Tags: ${tags.map((t) => t.name).join(', ')}
  - Stores: Marché Sandaga, Chez Fatou Resto
  - Deals: 2 active deals`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
