const Product = require('../models/Product');
const Review = require('../models/Review'); // Import Review model
const mongoose = require('mongoose');
const Category = require('../models/Category');
const Subcategory = require('../models/Subcategory');
const { updateProductCountInSubcategory } = require('../utils/subcategoryUtils');

// Get all products 
exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate('category')
      .populate('subcategory')
      .populate('reviews') 
      .lean();

    const validProducts = products.filter(product => product && product._id).map(product => ({
      ...product,
      thumbnails: product.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: product.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: product.saleprice, 
      
    }));

    console.log('Fetched products with normalized URLs:', validProducts);
    res.json(validProducts);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: "Failed to fetch products." });
  }
};

// Fetch single product by ID
exports.getProductById = async (req, res) => {
  try {
    const productId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const product = await Product.findById(productId)
      .populate('category')
      .populate('subcategory')
      .populate('reviews') // Populate reviews
      .lean();

    if (!product || !product._id) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const formattedProduct = {
      ...product,
      thumbnails: product.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: product.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: product.saleprice,
    };

    console.log('Fetched single product with normalized URLs:', formattedProduct);
    res.status(200).json(formattedProduct);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// Get products by category
exports.getProductsByCategory = async (req, res) => {
  try {
    const categoryId = req.params.categoryId; // Use path parameter
    const { subcategoryId } = req.query; // Optional query parameter

    if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid or missing category ID' });
    }

    const query = { category: categoryId };
    if (subcategoryId) {
      if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
        return res.status(400).json({ error: 'Invalid subcategory ID' });
      }
      query.subcategory = subcategoryId;
    }

    const products = await Product.find(query)
      .populate('category')
      .populate('subcategory')
      .populate('reviews')
      .lean();

    if (!products.length) {
      return res.status(404).json({ message: 'No products found for this category' });
    }

    const formattedProducts = products.map(product => ({
      ...product,
      thumbnails: product.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: product.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: product.saleprice,
    }));

    res.status(200).json(formattedProducts);
  } catch (err) {
    console.error('Error fetching products by category:', err);
    res.status(500).json({ error: 'Failed to fetch products by category' });
  }
};

// Update product (Admin only)
exports.updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const updateData = req.body;

    console.log('Received update data:', updateData);
    console.log('Received files:', req.files);

    const existingProduct = await Product.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldSubcategoryId = existingProduct.subcategory;
    const newSubcategoryId = updateData.subcategory;

    if (updateData.saleprice !== undefined) {
      updateData.saleprice = updateData.salePrice;
      delete updateData.saleprice;
    } else if (updateData.saleprice !== undefined) {
      updateData.saleprice = updateData.saleprice;
    } else {
      updateData.saleprice = existingProduct.saleprice;
    }

    if (req.files) {
      updateData.thumbnails = req.files['thumbnails']
        ? req.files['thumbnails'].map(file => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`)
        : existingProduct.thumbnails;
      updateData.gallery = req.files['gallery']
        ? req.files['gallery'].map(file => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`)
        : existingProduct.gallery;
    } else {
      updateData.thumbnails = existingProduct.thumbnails;
      updateData.gallery = existingProduct.gallery;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      updateData,
      { new: true, runValidators: true }
    ).populate('reviews'); // Populate reviews after update

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log('Updated product:', updatedProduct);

    let updatedSubcategories = [];
    if (
      oldSubcategoryId &&
      newSubcategoryId &&
      oldSubcategoryId.toString() !== newSubcategoryId.toString()
    ) {
      const updatedOldSub = await Subcategory.findByIdAndUpdate(
        oldSubcategoryId,
        { $inc: { productCount: -1 } },
        { new: true }
      );

      const updatedNewSub = await Subcategory.findByIdAndUpdate(
        newSubcategoryId,
        { $inc: { productCount: 1 } },
        { new: true }
      );

      updatedSubcategories = [updatedOldSub, updatedNewSub].filter(Boolean);
    }

    const responseProduct = {
      ...updatedProduct.toObject(),
      thumbnails: updatedProduct.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: updatedProduct.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: updatedProduct.saleprice,
    };

    res.status(200).json({
      product: responseProduct,
      updatedSubcategories,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

// Add New Product
exports.addProduct = async (req, res) => {
  const {
    name,
    description,
    price,
    saleprice,
    categoryId,
    subcategoryId,
    sku,
    stock,
    specifications,
  } = req.body;

  try {
    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    let subcategory = null;
    if (subcategoryId) {
      subcategory = await Subcategory.findById(subcategoryId);
      if (!subcategory) return res.status(404).json({ error: 'Subcategory not found' });
    }

    const thumbnails = req.files['thumbnails']
      ? req.files['thumbnails'].map(file => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`)
      : [];
    const gallery = req.files['gallery']
      ? req.files['gallery'].map(file => `${req.protocol}://${req.get('host')}/uploads/${file.filename}`)
      : [];

    console.log('Uploaded thumbnails:', thumbnails);
    console.log('Uploaded gallery:', gallery);

    const product = new Product({
      name,
      description,
      price,
      saleprice: saleprice,
      category: categoryId,
      subcategory: subcategoryId || null,
      thumbnails,
      gallery,
      sku,
      stock,
      specifications,
    });

    await product.save();

    category.productCount += 1;
    await category.save();

    if (subcategoryId) {
      await updateProductCountInSubcategory(subcategoryId);
    }

    const responseProduct = {
      ...product.toObject(),
      salePrice: product.saleprice,
    };

    res.status(201).json(responseProduct);
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(400).json({ error: err.message });
  }
};

// Delete Product
exports.deleteProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const subcategoryId = product.subcategory;
    const categoryId = product.category;

    await Product.findByIdAndDelete(productId);

    let updatedSubcategory = null;
    if (subcategoryId) {
      updatedSubcategory = await Subcategory.findByIdAndUpdate(
        subcategoryId,
        { $inc: { productCount: -1 } },
        { new: true }
      );
    }

    if (categoryId) {
      await Category.findByIdAndUpdate(
        categoryId,
        { $inc: { productCount: -1 } },
        { new: true }
      );
    }

    res.status(200).json({
      message: 'Product deleted successfully',
      updatedSubcategories: updatedSubcategory ? [updatedSubcategory] : [],
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

// Add a review to a product
exports.addReview = async (req, res) => {
  try {
    const productId = req.params.id;
    const { userName, rating, comment } = req.body;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    if (!userName || !rating || !comment) {
      return res.status(400).json({ error: 'All fields (userName, rating, comment) are required' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const newReview = new Review({
      userName,
      rating,
      comment,
      date: new Date(),
    });

    const savedReview = await newReview.save();
    product.reviews = product.reviews || []; // Ensure reviews array exists
    product.reviews.push(savedReview._id);
    await product.save();

    // Fetch updated product with populated fields
    const updatedProduct = await Product.findById(productId)
      .populate('category')
      .populate('subcategory')
      .populate('reviews')
      .lean();

    const formattedProduct = {
      ...updatedProduct,
      thumbnails: updatedProduct.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: updatedProduct.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: updatedProduct.saleprice,
    };

    console.log('Review added, updated product:', formattedProduct);
    res.status(201).json(formattedProduct);
  } catch (err) {
    console.error('Error adding review:', err);
    res.status(500).json({ error: 'Failed to add review' });
  }
};