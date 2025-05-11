const Coupon = require('../models/Coupon');

// Create a new coupon (Admin only)
exports.createCoupon = async (req, res) => {
  const {
    code,
    discountType,
    discountValue,
    minOrderAmount,
    maxDiscountAmount,
    startDate,
    endDate,
    usageLimit,
    firstTimeUsersOnly,
    couponType,
    buyQuantity,
    getQuantity,
    requiredQuantity,
    applicableProductIds,
  } = req.body;

  try {
    // Validate required fields
    if (!code || !startDate || !endDate) {
      return res.status(400).json({ error: 'Coupon code, start date, and end date are required' });
    }

    // Normalize dates to UTC
    const normalizedStartDate = new Date(startDate);
    normalizedStartDate.setUTCHours(0, 0, 0, 0);
    const normalizedEndDate = new Date(endDate);
    normalizedEndDate.setUTCHours(23, 59, 59, 999);

    // Validate dates
    if (normalizedStartDate >= normalizedEndDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    // Validate coupon type
    const validCouponTypes = ['standard', 'buy_x_get_y', 'combo', 'same_product_discount'];
    if (!validCouponTypes.includes(couponType)) {
      return res.status(400).json({ error: `Invalid coupon type. Must be one of: ${validCouponTypes.join(', ')}` });
    }

    // Validate Buy X Get Y specific fields
    if (couponType === 'buy_x_get_y') {
      if (!buyQuantity || buyQuantity <= 0 || !getQuantity || getQuantity <= 0) {
        return res.status(400).json({ error: 'Buy quantity and get quantity must be greater than 0 for Buy X Get Y coupons' });
      }
    }

    // Validate Same Product Discount specific fields
    if (couponType === 'same_product_discount') {
      if (!requiredQuantity || requiredQuantity <= 0) {
        return res.status(400).json({ error: 'Required quantity must be greater than 0 for Same Product Discount coupons' });
      }
      if (!discountValue || discountValue <= 0) {
        return res.status(400).json({ error: 'Discount value must be greater than 0 for Same Product Discount coupons' });
      }
      if (!applicableProductIds || !applicableProductIds.length) {
        return res.status(400).json({ error: 'At least one applicable product is required for Same Product Discount coupons' });
      }
    }

    // Set discountValue to 0 for Buy X Get Y and Combo coupons
    const finalDiscountValue = couponType === 'buy_x_get_y' || couponType === 'combo' ? 0 : discountValue;

    // Validate discountValue for standard coupons
    if (couponType === 'standard') {
      if (!finalDiscountValue || finalDiscountValue <= 0) {
        return res.status(400).json({ error: 'Discount value must be greater than 0 for standard coupons' });
      }
      if (discountType === 'percentage' && finalDiscountValue > 100) {
        return res.status(400).json({ error: 'Percentage discount cannot be greater than 100%' });
      }
    }

    const coupon = new Coupon({
      code: code.toUpperCase(),
      discountType: discountType || 'percentage',
      discountValue: finalDiscountValue || 0,
      minOrderAmount: minOrderAmount || 0,
      maxDiscountAmount: maxDiscountAmount || 0,
      startDate: normalizedStartDate,
      endDate: normalizedEndDate,
      usageLimit: usageLimit || null,
      firstTimeUsersOnly: firstTimeUsersOnly || false,
      couponType: couponType || 'standard',
      buyQuantity: buyQuantity || 0,
      getQuantity: getQuantity || 0,
      requiredQuantity: requiredQuantity || 0,
      applicableProducts: applicableProductIds || [],
    });

    await coupon.save();
    res.status(201).json({ message: 'Coupon created successfully', coupon });
  } catch (err) {
    console.error('Error creating coupon:', err);
    res.status(400).json({ error: err.message });
  }
};

// Apply a coupon to an order
exports.applyCoupon = async (req, res) => {
  try {
    const { code, orderAmount, userId, cartItems } = req.body;

    console.log('Coupon apply request:', { code, orderAmount, userId, cartItems });

    if (!code || typeof orderAmount !== 'number' || !userId) {
      return res.status(400).json({ error: 'Coupon code, order amount, and user ID are required' });
    }

    if (!cartItems || !Array.isArray(cartItems)) {
      return res.status(400).json({ error: 'Cart items are required to apply coupon' });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() }).populate('applicableProducts');
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found or inactive' });
    }

    if (coupon.status === 'inactive') {
      return res.status(400).json({ error: 'Coupon is inactive' });
    }

    // Normalize dates to UTC and compare only the date portion for startDate
    const currentDate = new Date();
    const currentDateOnly = new Date(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate());
    const startDateOnly = new Date(coupon.startDate.getUTCFullYear(), coupon.startDate.getUTCMonth(), coupon.startDate.getUTCDate());
    const endDate = new Date(coupon.endDate);

    if (currentDate > endDate) {
      if (coupon.status !== 'expired') {
        coupon.status = 'expired';
        await coupon.save();
      }
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    if (currentDateOnly < startDateOnly) {
      return res.status(400).json({ error: 'Coupon is not yet active' });
    }

    if (orderAmount < coupon.minOrderAmount) {
      return res.status(400).json({
        error: `Minimum order amount of ₹${coupon.minOrderAmount} required`,
      });
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ error: 'Coupon usage limit reached' });
    }

    if (coupon.firstTimeUsersOnly) {
      const userUsage = coupon.userUsage.find((u) => u.userId.toString() === userId);
      if (userUsage && userUsage.used) {
        return res.status(400).json({ error: 'This coupon can only be used once by new users' });
      }
      const otherCoupons = await Coupon.find({ 'userUsage.userId': userId, firstTimeUsersOnly: true });
      if (otherCoupons.length > 0) {
        return res.status(400).json({ error: 'This coupon is only for first-time users' });
      }
    }

    // Validate applicable products for all coupon types if applicableProducts is specified
    let eligibleItems = [];
    if (coupon.applicableProducts.length > 0) {
      eligibleItems = cartItems.filter((item) =>
        coupon.applicableProducts.some((p) => p._id.toString() === item.productId)
      );
      if (!eligibleItems.length) {
        return res.status(400).json({
          error: `This coupon applies only to: ${coupon.applicableProducts.map((p) => p.name).join(', ')}. Please add these items.`,
        });
      }
    } else {
      eligibleItems = cartItems; // Use all items if no specific products are required
    }

    let discountAmount = 0;
    if (coupon.couponType === 'standard') {
      // For standard coupons, calculate discount based on eligible items only
      const eligibleOrderAmount = eligibleItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      if (coupon.discountType === 'percentage') {
        discountAmount = (coupon.discountValue / 100) * eligibleOrderAmount;
        if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
          discountAmount = coupon.maxDiscountAmount;
        }
      } else if (coupon.discountType === 'fixed') {
        discountAmount = coupon.discountValue;
      }
    } else if (coupon.couponType === 'buy_x_get_y') {
      const totalEligibleQuantity = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
      if (totalEligibleQuantity < coupon.buyQuantity) {
        return res.status(400).json({
          error: `At least ${coupon.buyQuantity} qualifying items required for this coupon`,
        });
      }

      const freeItemsCount = Math.floor(totalEligibleQuantity / (coupon.buyQuantity + coupon.getQuantity)) * coupon.getQuantity;

      if (freeItemsCount > 0) {
        const sortedItems = eligibleItems
          .map((item) => ({ ...item }))
          .sort((a, b) => a.price - b.price);

        let itemsUsed = 0;
        let freeItemsValue = 0;

        for (let item of sortedItems) {
          while (itemsUsed < freeItemsCount && item.quantity > 0) {
            freeItemsValue += item.price;
            item.quantity -= 1;
            itemsUsed += 1;
          }
          if (itemsUsed >= freeItemsCount) break;
        }

        discountAmount = freeItemsValue;

        if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
          discountAmount = coupon.maxDiscountAmount;
        }
      }
    } else if (coupon.couponType === 'combo') {
      const applicableProductIds = coupon.applicableProducts.map((p) => p._id.toString());
      const hasAllProducts = applicableProductIds.every((productId) =>
        cartItems.some((item) => item.productId === productId && item.quantity > 0)
      );

      if (!hasAllProducts) {
        return res.status(400).json({ error: 'All specified products must be in the cart for this combo coupon' });
      }

      discountAmount = 100; // Example fixed discount; adjust based on requirements
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else if (coupon.couponType === 'same_product_discount') {
      const hasSufficientQuantity = eligibleItems.some((item) => item.quantity >= coupon.requiredQuantity);

      if (!hasSufficientQuantity) {
        return res.status(400).json({
          error: `At least ${coupon.requiredQuantity} units of a qualifying product are required for this coupon`,
        });
      }

      discountAmount = coupon.discountValue;
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    }

    if (discountAmount > orderAmount) {
      discountAmount = orderAmount;
    }

    if (discountAmount > 0) {
      coupon.usedCount += 1;
      if (coupon.firstTimeUsersOnly) {
        coupon.userUsage.push({ userId, used: true });
      }
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        coupon.status = 'inactive';
      }
      await coupon.save();
    }

    res.status(200).json({ message: 'Coupon applied successfully', discountAmount });
  } catch (error) {
    console.error('Error applying coupon:', error);
    res.status(500).json({ error: 'Server error while applying coupon' });
  }
};

// Get All Coupons
exports.getAllCoupon = async (req, res) => {
  try {
    const coupons = await Coupon.find().populate('applicableProducts', 'name');
    res.status(200).json(coupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update Coupon Status (Active/Inactive)
exports.statusUpdate = async (req, res) => {
  try {
    const { status } = req.body;
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    const currentDate = new Date();
    if (new Date(coupon.endDate) < currentDate) {
      coupon.status = 'expired';
    } else if (status === 'active' || status === 'inactive') {
      coupon.status = status;
    } else {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await coupon.save();
    res.status(200).json({ message: 'Coupon status updated successfully', coupon });
  } catch (error) {
    console.error('Error updating coupon status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update Coupon
exports.editCoupon = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      usageLimit,
      firstTimeUsersOnly,
      couponType,
      buyQuantity,
      getQuantity,
      requiredQuantity,
      applicableProductIds,
    } = req.body;

    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    // Normalize dates to UTC if provided
    const normalizedStartDate = startDate
      ? new Date(startDate).setUTCHours(0, 0, 0, 0)
      : coupon.startDate;
    const normalizedEndDate = endDate
      ? new Date(endDate).setUTCHours(23, 59, 59, 999)
      : coupon.endDate;

    // Validate dates
    if (normalizedStartDate && normalizedEndDate && normalizedStartDate >= normalizedEndDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    // Validate coupon type
    const validCouponTypes = ['standard', 'buy_x_get_y', 'combo', 'same_product_discount'];
    if (couponType && !validCouponTypes.includes(couponType)) {
      return res.status(400).json({ error: `Invalid coupon type. Must be one of: ${validCouponTypes.join(', ')}` });
    }

    // Validate Buy X Get Y specific fields
    if (couponType === 'buy_x_get_y') {
      if (!buyQuantity || buyQuantity <= 0 || !getQuantity || getQuantity <= 0) {
        return res.status(400).json({ error: 'Buy quantity and get quantity must be greater than 0 for Buy X Get Y coupons' });
      }
    }

    // Validate Same Product Discount specific fields
    if (couponType === 'same_product_discount') {
      if (!requiredQuantity || requiredQuantity <= 0) {
        return res.status(400).json({ error: 'Required quantity must be greater than 0 for Same Product Discount coupons' });
      }
      if (!discountValue || discountValue <= 0) {
        return res.status(400).json({ error: 'Discount value must be greater than 0 for Same Product Discount coupons' });
      }
      if (!applicableProductIds || !applicableProductIds.length) {
        return res.status(400).json({ error: 'At least one applicable product is required for Same Product Discount coupons' });
      }
    }

    // Set discountValue to 0 for Buy X Get Y and Combo coupons
    const finalDiscountValue = couponType === 'buy_x_get_y' || couponType === 'combo' ? 0 : discountValue;

    // Validate discountValue for standard coupons
    if (couponType === 'standard') {
      if (!finalDiscountValue || finalDiscountValue <= 0) {
        return res.status(400).json({ error: 'Discount value must be greater than 0 for standard coupons' });
      }
      if (discountType === 'percentage' && finalDiscountValue > 100) {
        return res.status(400).json({ error: 'Percentage discount cannot be greater than 100%' });
      }
    }

    coupon.code = code?.toUpperCase() || coupon.code;
    coupon.discountType = discountType || coupon.discountType;
    coupon.discountValue = finalDiscountValue !== undefined ? finalDiscountValue : coupon.discountValue;
    coupon.minOrderAmount = minOrderAmount || coupon.minOrderAmount;
    coupon.maxDiscountAmount = maxDiscountAmount || coupon.maxDiscountAmount;
    coupon.startDate = normalizedStartDate || coupon.startDate;
    coupon.endDate = normalizedEndDate || coupon.endDate;
    coupon.usageLimit = usageLimit || coupon.usageLimit;
    coupon.firstTimeUsersOnly = firstTimeUsersOnly !== undefined ? firstTimeUsersOnly : coupon.firstTimeUsersOnly;
    coupon.couponType = couponType || coupon.couponType;
    coupon.buyQuantity = buyQuantity !== undefined ? buyQuantity : coupon.buyQuantity;
    coupon.getQuantity = getQuantity !== undefined ? getQuantity : coupon.getQuantity;
    coupon.requiredQuantity = requiredQuantity !== undefined ? requiredQuantity : coupon.requiredQuantity;
    coupon.applicableProducts = applicableProductIds || coupon.applicableProducts;

    await coupon.save();
    res.status(200).json({ message: 'Coupon updated successfully', coupon });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Delete a coupon (Admin only)
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    res.status(200).json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};