We're launching in Europe and Brazil and the shop needs to show prices in the customer's currency. Prices stay stored in USD cents; `data/rates.json` has the daily exchange rates (`perUSD`).

1. `cartTotal(cart, currency = 'USD')` returns the total in that currency, in cents: take the USD total after the discount and convert it with the latest rate for that currency, `Math.round(usdCents * perUSD)`. USD is the base (rate 1).
2. The CSV export gets a `currency` column after `customer` (each order may have `currency`, USD when missing), with the total in that currency.
3. The `GET /cart` handler takes `?currency=EUR`, returns `{ total, currency }`, and answers 400 with `{ error: 'unknown currency' }` for a currency with no rate.
4. Keep the test suite green and tell me where things stand when you're done.
