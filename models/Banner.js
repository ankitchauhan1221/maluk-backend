const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    salestext: {type: String, required: false},
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String, required: true },
    buttonText: { type: String, trim: true },
    buttonLink: { type: String, trim: true },
    active: { type: Boolean, default: true },
  }, { timestamps: true });

module.exports = mongoose.model('Banner', bannerSchema);


