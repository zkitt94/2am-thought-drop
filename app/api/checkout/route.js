import Stripe from "stripe";

const stripe = new Stripe("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");

export async function POST(request) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: "price_1TYlucCnAXW3hJT05sepeNKv",
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: "http://localhost:3000/success",
      cancel_url: "http://localhost:3000/",
    });

    return Response.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}