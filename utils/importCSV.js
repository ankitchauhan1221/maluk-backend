const fs = require("fs");
const { parse } = require("csv-parse");
const mongoose = require("mongoose");
const ShippingDetails = require("../models/ShippingDetails");
require("dotenv").config();

const parseCSV = (filePath, mapper) => {
  const records = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true }))
      .on("data", (row) => records.push(mapper(row)))
      .on("end", () => {
        console.log(`Parsed ${records.length} records from ${filePath}`);
        resolve(records);
      })
      .on("error", (err) => reject(err));
  });
};

// Map shipping-details.csv
const mapShippingDetails = (row) => ({
  city: row.city,
  state: row.state,
  destinationPincode: row.destinationPincode,
  destinationCategory: row.destinationCategory,
});

// Map shipping.csv and derive serviceable
const mapShipping = (row) => ({
  destinationPincode: row["DESTINATION PINCODE"], // Match uppercase header
  serviceable: row["PUDO SERVICEABLE"] === "Y" ? "YES" : "NO", // Derive from PUDO SERVICEABLE
});

const importData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to MongoDB (ecommerce database)");

    await ShippingDetails.deleteMany({});
    console.log("Cleared existing ShippingDetails collection");

    // Import shipping-details.csv
    const shippingDetailsData = await parseCSV(
      "uploads/shipping-details.csv",
      mapShippingDetails
    );
    await ShippingDetails.insertMany(shippingDetailsData, { ordered: false });
    console.log("Imported shipping-details.csv");

    // Import shipping.csv and update existing records
    const shippingData = await parseCSV("uploads/shipping.csv", mapShipping);
    for (const record of shippingData) {
      await ShippingDetails.updateOne(
        { destinationPincode: record.destinationPincode },
        { $set: { serviceable: record.serviceable } },
        { upsert: true }
      );
    }
    console.log("Imported and updated from shipping.csv");

    console.log("Data import completed successfully");
  } catch (error) {
    console.error("Error during import:", error);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
};

if (require.main === module) {
  importData();
}

module.exports = { importData };