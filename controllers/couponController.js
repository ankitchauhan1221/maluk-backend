const Coupon = require('../models/Coupon');

// Create a new coupon (Admin only)
exports.createCoupon = async (req, res) => {
  const { code, discountType, discountValue, minOrderAmount, maxDiscountAmount, startDate, endDate, usageLimit } = req.body;

  try {
    const coupon = new Coupon({
      code,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      usageLimit,
    });
    await coupon.save();
    res.status(201).json(coupon);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Apply a coupon to an order
exports.applyCoupon = async (req, res) => {
  try {
    const { code, orderAmount } = req.body;

    if (!code || typeof orderAmount !== 'number') {
      return res.status(400).json({ error: 'Coupon code and order amount are required' });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found or inactive' });
    }

    if (coupon.status === 'inactive') {
      return res.status(400).json({ error: 'Coupon not found or inactive' });
    }

    const currentDate = new Date();
    if (currentDate > coupon.endDate) {
      if (coupon.status !== 'expired') {
        coupon.status = 'expired';
        await coupon.save();
      }
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    if (currentDate < coupon.startDate) {
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

    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = (coupon.discountValue / 100) * orderAmount;
      if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
        discountAmount = coupon.maxDiscountAmount;
      }
    } else if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    }

    if (discountAmount > orderAmount) {
      discountAmount = orderAmount;
    }

    res.status(200).json({ discountAmount });
  } catch (error) {
    console.error('Error applying coupon:', error);
    res.status(500).json({ error: 'Server error while applying coupon' });
  }
};

exports.incrementCouponUsage = async (couponCode) => {
  try {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (coupon && coupon.status === 'active' && (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit)) {
      coupon.usedCount += 1;
      if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
        coupon.status = 'inactive';
      }
      await coupon.save();
    }
  } catch (error) {
    console.error('Error incrementing coupon usage:', error);
  }
};

// Get All Coupons
exports.getAllCoupon = async (req, res) => {
  try {
    const coupons = await Coupon.find();
    res.status(200).json(coupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update Coupon Status (Active/Inactive)
exports.statusUpdate = async (req, res) => {
  try {
    const { status } = req.body;
    const coupon = await Coupon.findById(req.params.id);

    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }

    // Automatically set to 'expired' if end date has passed
    const currentDate = new Date();
    if (new Date(coupon.endDate) < currentDate) {
      coupon.status = "expired";
    } else {
      // Allow toggling only if not expired
      coupon.status = status;
    }

    await coupon.save();

    res.status(200).json({ message: "Coupon status updated successfully", coupon });
  } catch (error) {
    console.error("Error updating coupon status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


// Update Coupon
exports.editCoupon =  async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      maxDiscountAmount,
      startDate,
      endDate,
      isActive,
      usageLimit,
    } = req.body;

    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    // Update fields
    coupon.code = code || coupon.code;
    coupon.discountType = discountType || coupon.discountType;
    coupon.discountValue = discountValue || coupon.discountValue;
    coupon.minOrderAmount = minOrderAmount || coupon.minOrderAmount;
    coupon.maxDiscountAmount = maxDiscountAmount || coupon.maxDiscountAmount;
    coupon.startDate = startDate || coupon.startDate;
    coupon.endDate = endDate || coupon.endDate;
    coupon.isActive = isActive !== undefined ? isActive : coupon.isActive;
    coupon.usageLimit = usageLimit || coupon.usageLimit;

    await coupon.save();
    res.status(200).json(coupon);
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


// Delete a coupon (Admin only)
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found' });
    res.json({ message: 'Coupon deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};