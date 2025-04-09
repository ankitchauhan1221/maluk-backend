import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import addressRoutes from "./routes/addressRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import couponRoutes from "./routes/couponRoutes.js";
import bannerRoutes from "./routes/bannerRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import phonepeRoutes from "./routes/phonepeRoutes.js";
import contactRoutes from"./routes/contactRoutes.js";
import shippingRoutes from "./routes/shipping.js";
import bodyParser from "body-parser";
import path from "path"; 

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// app.use(cors({
//   origin: "*",
//   methods: "GET,POST,PUT,PATCH,DELETE",
//   allowedHeaders: "Content-Type,Authorization",
// }));
app.use(cors());
app.use(express.json());
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(path.resolve(), 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/address', addressRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/banners', bannerRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/phonepe", phonepeRoutes);


connectDB();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});