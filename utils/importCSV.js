const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const mongoose = require("mongoose");
const ShippingDetails = require("../models/ShippingDetails");
require("dotenv").config({ path: "../.env" });

// Debug environment variable
console.log("MONGO_URI:", process.env.MONGO_URI);

const parseCSV = (filePath, mapper) => {
  const records = [];
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    // Log first few lines for debugging
    const fileContent = fs.readFileSync(filePath, "utf8").split("\n").slice(0, 2).join("\n");
    console.log("First few lines of CSV:\n", fileContent);

    fs.createReadStream(filePath)
      .pipe(
        parse({
          columns: true,
          trim: true,
          skip_empty_lines: true,
        })
      )
      .on("data", (row) => {
        console.log("Raw CSV row:", row);
        records.push(mapper(row));
      })
      .on("end", () => {
        console.log(`Parsed ${records.length} records from ${filePath}`);
        resolve(records);
      })
      .on("error", (err) => reject(err));
  });
};

const mapShippingDetails = (row) => {
  return {
    destinationPincode: row["destinationPincode"]?.trim(),
    city: row["city"]?.trim(),
    state: row["state"]?.trim(),
    prepaid: row["prepaid"]?.trim() || "N",
    cod: row["cod"]?.trim() || "N",
    pudoServiceable: row["pudoServiceable"]?.trim() || "N",
    b2cCodServiceable: row["b2cCodServiceable"]?.trim() || "N",
    destinationCategory: row["destinationCategory"]?.trim(), // Add destinationCategory
  };
};

const importData = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env file");
    }

    const csvFilePath = path.join(__dirname, "..", "Uploads", "shipping-details.csv");
    console.log("Looking for CSV at:", csvFilePath);

    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB (ecommerce database)");

    await ShippingDetails.deleteMany({});
    console.log("Cleared existing ShippingDetails collection");

    const shippingDetailsData = await parseCSV(csvFilePath, mapShippingDetails);

    // Validate and clean data
    const validData = shippingDetailsData.filter((record) => {
      if (!record.destinationPincode) {
        console.warn("Skipping record with missing destinationPincode:", record);
        return false;
      }
      return true;
    });

    if (validData.length === 0) {
      throw new Error("No valid records found in shipping-details.csv. Check column names, delimiter, and CSV content.");
    }

    await ShippingDetails.insertMany(validData, { ordered: false });
    console.log(`Imported ${validData.length} records from shipping-details.csv`);

    console.log("Data import completed successfully");
  } catch (error) {
    console.error("Error during import:", error.message);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
};

if (require.main === module) {
  importData();
}

module.exports = { importData };