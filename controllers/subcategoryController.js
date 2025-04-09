const Subcategory = require('../models/Subcategory');
const Category = require('../models/Category');
const Product = require('../models/Product');

// Create a new subcategory and update subcategoryCount
exports.createSubcategory = async (req, res) => {
  const { name, categoryId, status } = req.body;
  console.log(req.body,)

  try {
    // Check if the category exists
    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    // Create the subcategory with productCount initialized to 0
    const subcategory = new Subcategory({ name, category: categoryId, productCount: 0,status });
    await subcategory.save();

    // Update subcategory count in the category
    const actualCount = await Subcategory.countDocuments({ category: categoryId });
    category.subcategoryCount = actualCount;
    await category.save();

    res.status(201).json(subcategory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Get all subcategories
exports.getAllSubcategories = async (req, res) => {
  try {
    const subcategories = await Subcategory.find().populate('category');
    res.json(subcategories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Edit subcategory (Update name & category)
exports.editSubcategory = async (req, res) => {
  const { name, categoryId } = req.body;

  try {
    const subcategory = await Subcategory.findById(req.params.id);
    if (!subcategory) return res.status(404).json({ error: 'Subcategory not found' });

    // Check if the new category exists
    if (categoryId && categoryId !== subcategory.category.toString()) {
      const newCategory = await Category.findById(categoryId);
      if (!newCategory) return res.status(404).json({ error: 'New category not found' });

      // Update subcategory count for the old category
      const oldCategory = await Category.findById(subcategory.category);
      if (oldCategory) {
        oldCategory.subcategoryCount = Math.max(0, oldCategory.subcategoryCount - 1);
        await oldCategory.save();
      }

      // Assign the new category to the subcategory
      subcategory.category = categoryId;

      // Update subcategory count for the new category
      const newCount = await Subcategory.countDocuments({ category: categoryId });
      newCategory.subcategoryCount = newCount;
      await newCategory.save();
    }
    // Update name if provided
    if (name) subcategory.name = name;

    await subcategory.save();
    res.json(subcategory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Update category status (Admin only)
exports.updateSubCategoryStatus = async (req, res) => {
  const { status } = req.body;

  try {
    const subCategory = await Subcategory.findById(req.params.id);
    if (!subCategory) return res.status(404).json({ error: "Subcategory not found" });

    console.log("Before update:", subCategory); // 🔍 Debugging log

    // Ensure status is updated correctly
    if (status.toLowerCase() === "active" || status.toLowerCase() === "inactive") {
      subCategory.status = status.toLowerCase();
      await subCategory.save();

      // Fetch the updated document from the database
      const updatedSubCategory = await Subcategory.findById(req.params.id);
      console.log("After update:", updatedSubCategory); // 🔍 Debugging log

      res.json(updatedSubCategory);
    } else {
      res.status(400).json({ error: 'Invalid status. Must be "active" or "inactive".' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Delete a subcategory and update subcategoryCount
exports.deleteSubcategory = async (req, res) => {
  try {
    const subcategory = await Subcategory.findById(req.params.id);
    if (!subcategory) return res.status(404).json({ error: "Subcategory not found" });

    // Check if there are products in this subcategory
    const productCount = await Product.countDocuments({ subcategory: subcategory._id });
    console.log(`Subcategory ${req.params.id} has ${productCount} products`);
    if (productCount > 0) {
      return res.status(400).json({
        error: "Cannot delete subcategory with products. Remove products first.",
        productCount, // Include productCount in the response
      });
    }

    // Delete subcategory
    await Subcategory.findByIdAndDelete(req.params.id);

    // Decrement subcategoryCount in the parent category
    const category = await Category.findById(subcategory.category);
    if (category) {
      category.subcategoryCount = Math.max(0, category.subcategoryCount - 1);
      await category.save();
    }

    res.json({ message: "Subcategory deleted successfully" });
  } catch (err) {
    console.error("Error deleting subcategory:", err);
    res.status(500).json({ error: err.message });
  }
};

