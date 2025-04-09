const Category = require('../models/Category');
const Subcategory = require('../models/Subcategory')

// Create a new category
exports.createCategory = async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Category name is required and must be a string.' });
  }

  try {
    // Check if category already exists
    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ error: 'Category with this name already exists.' });
    }

    const category = new Category({ name, status: 'active', subcategoryCount: 0 });
    await category.save();
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
};

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
};

// Edit category (Update name and status)
exports.editCategory = async (req, res) => {
  const { name, status } = req.body;

  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    if (name && typeof name === 'string') {
      category.name = name;
    }

    if (status && (status === 'active' || status === 'inactive')) {
      category.status = status;
    } else if (status) {
      return res.status(400).json({ error: 'Invalid status. Must be "active" or "inactive".' });
    }

    await category.save();
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update category.' });
  }
};

// Enhanced version with additional details
exports.getCategoryById = async (req, res) => {
  try {
    const categoryId = req.params.id;
    
    // Find category by ID and populate subcategories if needed
    const category = await Category.findById(categoryId)
      .populate('subcategories', 'name status productCount'); // Optional: if you have a subcategories reference
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.status(200).json({
      success: true,
      data: category
    });
  } catch (err) {
    // More specific error handling
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid category ID format' });
    }
    res.status(500).json({ error: 'Failed to fetch category. Please try again later.' });
  }
};

// Update category status (Admin only)
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
    res.status(500).json({ error: 'Failed to update category status.' });
  }
};

// Delete a category (Admin only)
exports.deleteCategory = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    console.log(`Category ${categoryId} productCount: ${category.productCount}`);

    // Check if there are products directly in this category
    if (category.productCount > 0) {
      return res.status(400).json({
        error: "Cannot delete category with products. Remove products first.",
      });
    }

    // Verify Subcategory is defined
    if (!Subcategory) {
      throw new Error("Subcategory model is not defined. Check import.");
    }

    // Find all subcategories under this category
    const subcategories = await Subcategory.find({ category: categoryId });
    console.log(`Found ${subcategories.length} subcategories for category ${categoryId}`);

    // Check if any subcategories have products
    for (const subcategory of subcategories) {
      if (subcategory.productCount > 0) {
        return res.status(400).json({
          error: "Cannot delete category because a subcategory contains products. Remove products first.",
        });
      }
    }

    // Delete all subcategories under this category
    await Subcategory.deleteMany({ category: categoryId });
    console.log(`Deleted ${subcategories.length} subcategories`);

    // Delete the category
    await Category.findByIdAndDelete(categoryId);
    res.status(200).json({ message: "Category and its subcategories deleted successfully" });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({ error: "Failed to delete category" });
  }
};
