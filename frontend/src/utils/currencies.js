// Mirrors backend/middleware/validate.js's SUPPORTED_CURRENCIES. Kept as a
// duplicate list rather than shared over the network, since the frontend
// can't import backend code directly - if you add a currency here, add it
// there too (and vice versa), or the dropdown will offer something the
// server rejects.
export const CURRENCIES = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: '$' },
  { code: 'AUD', label: 'Australian Dollar', symbol: '$' },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'Fr' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹' },
  { code: 'MXN', label: 'Mexican Peso', symbol: '$' },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$' },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: '$' },
  { code: 'NZD', label: 'New Zealand Dollar', symbol: '$' },
  { code: 'SEK', label: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', label: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', label: 'Danish Krone', symbol: 'kr' },
  { code: 'PLN', label: 'Polish Złoty', symbol: 'zł' },
  { code: 'KRW', label: 'South Korean Won', symbol: '₩' },
  { code: 'HKD', label: 'Hong Kong Dollar', symbol: '$' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'ILS', label: 'Israeli Shekel', symbol: '₪' },
  { code: 'TRY', label: 'Turkish Lira', symbol: '₺' },
  { code: 'THB', label: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', label: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', label: 'Philippine Peso', symbol: '₱' },
  { code: 'VND', label: 'Vietnamese Dong', symbol: '₫' },
  { code: 'RUB', label: 'Russian Ruble', symbol: '₽' },
  { code: 'CZK', label: 'Czech Koruna', symbol: 'Kč' },
  { code: 'HUF', label: 'Hungarian Forint', symbol: 'Ft' },
];
