import Banner from '../models/Banner.js';

// Get all banners
export const getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find().lean();
    console.log('Returning banners:', banners);
    res.status(200).json(banners);
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
};

// Add a new banner
export const addBanner = async (req, res) => {
  const {salestext, title, description, buttonText, buttonLink, active } = req.body;

  try {
    console.log('Files received:', req.files);
    if (!req.files || !req.files['bannerImage']) {
      return res.status(400).json({ error: 'Banner image is required' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.files['bannerImage'][0].filename}`;

    const banner = new Banner({
      salestext,
      title,
      description,
      imageUrl,
      buttonText,
      buttonLink,
      active: active !== undefined ? active : true,
    });

    await banner.save();
    console.log('New banner saved:', banner);
    res.status(201).json(banner);
  } catch (error) {
    console.error('Error adding banner:', error);
    res.status(400).json({ error: error.message || 'Failed to add banner' });
  }
};

// Update a banner
export const updateBanner = async (req, res) => {
  const { id } = req.params;
  const {salestext, title, description, buttonText, buttonLink, active } = req.body;

  console.log('Received ID for update:', id);

  try {
    if (!id || id === 'undefined') {
      return res.status(400).json({ error: 'Invalid or missing banner ID' });
    }

    const updateData = {
      salestext,
      title,
      description,
      buttonText,
      buttonLink,
      active: active !== undefined ? active : undefined,
    };

    if (req.files && req.files['bannerImage']) {
      updateData.imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.files['bannerImage'][0].filename}`;
    }

    const banner = await Banner.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!banner) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    console.log('Updated banner:', banner);
    res.status(200).json(banner);
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(400).json({ error: error.message || 'Failed to update banner' });
  }
};

// Delete a banner
export const deleteBanner = async (req, res) => {
  const { id } = req.params;

  console.log('DELETE /api/banners/:id called with ID:', id);

  try {
    if (!id || id === 'undefined') {
      return res.status(400).json({ error: 'Invalid or missing banner ID' });
    }

    const banner = await Banner.findByIdAndDelete(id);
    if (!banner) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    console.log('Deleted banner:', banner);
    res.status(200).json({ message: 'Banner deleted successfully' });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ error: error.message || 'Failed to delete banner' });
  }
};

// Toggle banner active status
export const toggleBannerActive = async (req, res) => {
  const { id } = req.params;

  console.log('PATCH /api/banners/:id/toggle called with ID:', id);

  try {
    if (!id || id === 'undefined') {
      return res.status(400).json({ error: 'Invalid or missing banner ID' });
    }

    const banner = await Banner.findById(id);
    if (!banner) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    banner.active = !banner.active;
    await banner.save();

    console.log('Toggled banner:', banner);
    res.status(200).json(banner);
  } catch (error) {
    console.error('Error toggling banner status:', error);
    res.status(500).json({ error: error.message || 'Failed to toggle banner status' });
  }
};