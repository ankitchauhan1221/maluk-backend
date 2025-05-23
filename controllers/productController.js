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

// Fetch single product by ID or slug
exports.getProductById = async (req, res) => {
  try {
    // Determine if the request is for slug or ID based on parameter
    const identifier = req.params.slug || req.params.id;
    const isSlug = !!req.params.slug; // True for /slug/:slug, false for /:id

    if (!identifier) {
      return res.status(400).json({
        error: 'Missing identifier',
        message: 'Product ID or slug is required',
      });
    }

    let product;
    if (isSlug) {
      console.log(`Fetching product by slug: ${identifier}`);
      product = await Product.findOne({ slug: identifier })
        .populate('category')
        .populate('subcategory')
        .populate('reviews')
        .lean();
    } else if (mongoose.Types.ObjectId.isValid(identifier)) {
      console.log(`Fetching product by ID: ${identifier}`);
      product = await Product.findById(identifier)
        .populate('category')
        .populate('subcategory')
        .populate('reviews')
        .lean();
    } else {
      return res.status(400).json({
        error: 'Invalid identifier',
        message: 'Provided ID is not a valid MongoDB ObjectId',
      });
    }

    if (!product || !product._id) {
      console.log(`Product not found for identifier: ${identifier} (isSlug: ${isSlug})`);
      return res.status(404).json({
        error: 'Product not found',
        message: isSlug ? 'No product found with the given slug' : 'No product found with the given ID',
      });
    }

    const formattedProduct = {
      ...product,
      thumbnails: product.thumbnails.map(thumbnail =>
        thumbnail.startsWith('http') ? thumbnail : `${req.protocol}://${req.get('host')}/${thumbnail}`
      ),
      gallery: product.gallery.map(galleryItem =>
        galleryItem.startsWith('http') ? galleryItem : `${req.protocol}://${req.get('host')}/${galleryItem}`
      ),
      salePrice: product.saleprice || product.price, // Fallback to price if saleprice is undefined
    };

    console.log('Fetched single product with normalized URLs:', {
      _id: formattedProduct._id,
      slug: formattedProduct.slug,
      name: formattedProduct.name,
      thumbnails: formattedProduct.thumbnails,
      salePrice: formattedProduct.salePrice,
    });
    res.status(200).json(formattedProduct);
  } catch (err) {
    console.error('Error fetching product:', {
      identifier: req.params.slug || req.params.id,
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      error: 'Failed to fetch product',
      message: err.message,
    });
  }
};

// Get products by category
exports.getProductsByCategory = async (req, res) => {
  try {
    const { categorySlug } = req.params;
    const { subcategoryId } = req.query;

    // Validate categorySlug
    if (!categorySlug || typeof categorySlug !== 'string' || categorySlug.trim() === '') {
      return res.status(400).json({ error: 'Invalid or missing category slug' });
    }

    const category = await Category.findOne({ slug: categorySlug });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    let query = { category: category._id };
    if (subcategoryId) {
      if (!mongoose.Types.ObjectId.isValid(subcategoryId)) {
        return res.status(400).json({ error: 'Invalid subcategory ID' });
      }
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

    if (!products.length) {
      return res.status(200).json([]); // Return empty array instead of 404 for no products
    }

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
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid category or subcategory ID format' });
    }
    res.status(500).json({ error: 'Failed to fetch products' });
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

    // Generate new slug if name is being updated
    if (updateData.name && updateData.name !== existingProduct.name) {
      const baseSlug = updateData.name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      let slug = baseSlug;
      let counter = 1;
      while (await Product.findOne({ slug, _id: { $ne: productId } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      updateData.slug = slug;
    }

    const oldSubcategoryId = existingProduct.subcategory;
    const newSubcategoryId = updateData.subcategory;

    if (updateData.saleprice !== undefined) {
      updateData.saleprice = updateData.salePrice;
      delete updateData.salePrice;
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
    ).populate('reviews');

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
    res.status(500).json({ 
      error: 'Failed to update product',
      message: error.message 
    });
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

    // Generate slug from name
    const baseSlug = name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    
    // Check if slug exists and append number if needed
    let slug = baseSlug;
    let counter = 1;
    while (await Product.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
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
      slug,
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
    res.status(400).json({ 
      error: err.message,
      message: 'Failed to add product. Please check your input data.'
    });
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