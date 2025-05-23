const mongoose = require('mongoose');
const Category = require('../models/Category');

async function addSlugsToCategories() {
  try {
    await mongoose.connect('mongodb://localhost:27017/ecommerce', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const categories = await Category.find({ slug: { $in: [null, ''] } });
    for (const category of categories) {
      const slug = await generateSlug(category.name, category._id);
      category.slug = slug;
      await category.save();
      console.log(`Updated category: ${category.name} -> ${slug}`);
    }

    console.log('Finished adding slugs to categories');
    mongoose.disconnect();
  } catch (err) {
    console.error('Error adding slugs:', err);
  }
}

const generateSlug = async (name, existingId) => {
  let baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let slug = baseSlug;
  let counter = 1;
  const query = existingId ? { slug, _id: { $ne: existingId } } : { slug };
  while (await Category.findOne(query)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
};

addSlugsToCategories();