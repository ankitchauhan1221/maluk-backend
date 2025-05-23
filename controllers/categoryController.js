const Category = require('../models/Category');
const Subcategory = require('../models/Subcategory');
const Product = require('../models/Product');

// Generate unique slug from name
const generateSlug = async (name, existingId = null) => {
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

// Create a new category
exports.createCategory = async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Category name is required and must be a string.' });
  }

  try {
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ error: 'Category with this name already exists.' });
    }

    const slug = await generateSlug(name);
    const category = new Category({ name, slug, status: 'active', subcategoryCount: 0 });
    await category.save();
    res.status(201).json(category);
  } catch (err) {
    console.error('Error creating category:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
};

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().select('name slug status productCount subcategoryCount');
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
};

// Edit category
exports.editCategory = async (req, res) => {
  const { name, status } = req.body;

  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    if (name && typeof name === 'string' && name !== category.name) {
      category.name = name;
      category.slug = await generateSlug(name, category._id);
    }

    if (status && (status === 'active' || status === 'inactive')) {
      category.status = status;
    } else if (status) {
      return res.status(400).json({ error: 'Invalid status. Must be "active" or "inactive".' });
    }

    await category.save();
    res.json(category);
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ error: 'Failed to update category.' });
  }
};

// Get category by slug
exports.getCategoryBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ error: 'Category slug is required and must be a string.' });
    }

    const category = await Category.findOne({ slug })
      .populate('subcategories', 'name status productCount')
      .lean();

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (err) {
    console.error('Error fetching category by slug:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid category slug format' });
    }
    res.status(500).json({ error: 'Failed to fetch category. Please try again later.' });
  }
};

// Update category status
exports.updateCategoryStatus = async (req, res) => {
  const { status } = req.body;

  if (!status || (status !== 'active' && status !== 'inactive')) {
    return res.status(400).json({ error: 'Invalid status. Must be "active" or "inactive".' });
  }

  try {
    const category = await Category.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    res.json(category);
  } catch (err) {
    console.error('Error updating category status:', err);
    res.status(500).json({ error: 'Failed to update category status.' });
  }
};

// Delete a category
exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    console.log(`Category ${categoryId} productCount: ${category.productCount}`);

    if (category.productCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete category with products. Remove products first.',
      });
    }

    if (!Subcategory) {
      throw new Error('Subcategory model is not defined. Check import.');
    }

    const subcategories = await Subcategory.find({ category: categoryId });
    console.log(`Found ${subcategories.length} subcategories for category ${categoryId}`);

    for (const subcategory of subcategories) {
      if (subcategory.productCount > 0) {
        return res.status(400).json({
          error: 'Cannot delete category because a subcategory contains products. Remove products first.',
        });
      }
    }

    await Subcategory.deleteMany({ category: categoryId });
    console.log(`Deleted ${subcategories.length} subcategories`);

    await Category.findByIdAndDelete(categoryId);
    res.status(200).json({ message: 'Category and its subcategories deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
};

// Get products by category slug
exports.getProductsByCategory = async (req, res) => {
  try {
    const { categorySlug } = req.params;
    const { subcategoryId } = req.query;

    const category = await Category.findOne({ slug: categorySlug });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    let query = { category: category._id };
    if (subcategoryId) {
      const subcategory = await Subcategory.findById(subcategoryId);
      if (!subcategory) {
        return res.status(404).json({ error: 'Subcategory not found' });
      }
      query.subcategory = subcategoryId;
    }

    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('subcategory', 'name')
      .populate('reviews')
      .lean();

    const formattedProducts = products.map(product => ({
      ...product,
      thumbnails: product.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: product.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: product.saleprice || product.price,
    }));

    res.status(200).json(formattedProducts);
  } catch (err) {
    console.error('Error fetching products by category:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};