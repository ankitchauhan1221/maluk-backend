const invoiceService = {
    generateInvoice: async (order) => {
      const invoice = {
        orderId: order.orderId,
        items: order.items,
        total: order.totalPrice,
        date: new Date(),
        customerEmail: order.customerEmail
      };
      console.log('Generated Invoice:', invoice);
      return invoice;
    }
  };
  
  module.exports = invoiceService;