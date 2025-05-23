import { cancelOrder } from "../controllers/shippingController";
import authMiddleware from "../middleware/authMiddleware";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  await authMiddleware(req, res, () => cancelOrder(req, res));
}