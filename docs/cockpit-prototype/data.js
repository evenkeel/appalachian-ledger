/* Fictional prototype data. Every name, amount and price here is invented.
   Money is held as integers (cents, whole bitcoin units) even in the mockup. */
(function () {
  const TODAY = new Date(2026, 10, 19); // Thu 19 Nov 2026
  const RATE = { oct: 877, nov: 842 }; // bitcoin per dollar, fictional monthly references

  // November expenses so far. Category totals, pace and drill-downs all derive from this list.
  const expenses = [
    [2, "Pharmacy", "Health", "Visa", 6240],
    [3, "Dinner on Main Street", "Dining", "Visa", 9180],
    [4, "Mountain Market", "Groceries", "Visa", 30140],
    [5, "Fuel", "Transport", "Visa", 2210],
    [7, "Electric & water", "Utilities", "Checking", 19360],
    [8, "Home essentials", "Shopping", "Visa", 4470],
    [9, "Ridge Tavern", "Dining", "Visa", 7240],
    [10, "Weekly groceries", "Groceries", "Visa", 15320],
    [10, "Dentist copay", "Health", "Checking", 15760],
    [12, "Transit pass", "Transport", "Checking", 8825],
    [13, "Lunch", "Dining", "Visa", 5440],
    [13, "Natural gas", "Utilities", "Checking", 10000],
    [14, "Hardware store", "Shopping", "Visa", 3100],
    [15, "Parking", "Transport", "Visa", 3515],
    [16, "Farmers market", "Groceries", "Checking", 12840],
    [16, "Dinner on Main Street", "Dining", "Visa", 8395],
    [16, "Work boots", "Shopping", "Visa", 11735],
    [17, "Fuel", "Transport", "Visa", 5210],
    [18, "Blue Ridge Coffee", "Dining", "Visa", 920],
    [19, "Mountain Market", "Groceries", "Visa", 6520],
  ].map(([day, name, cat, acct, cents]) => ({ day, name, cat, acct, cents, kind: "expense" }));

  const other = [
    { day: 1, name: "Salary", cat: "Income", acct: "Checking", cents: 310000, kind: "income" },
    { day: 3, name: "Bitcoin buy", cat: "Stack", acct: "Checking → Cold storage", cents: 40000, bitcoin: 338100, kind: "stack" },
    { day: 6, name: "Design project", cat: "Income", acct: "Checking", cents: 85000, kind: "income" },
    { day: 10, name: "To cash reserve", cat: "Move", acct: "Checking → Reserve", cents: 30000, kind: "move" },
    { day: 10, name: "To brokerage", cat: "Move", acct: "Checking → Brokerage", cents: 50000, kind: "move" },
    { day: 15, name: "Salary", cat: "Income", acct: "Checking", cents: 310000, kind: "income" },
    { day: 17, name: "Bitcoin buy", cat: "Stack", acct: "Checking → Cold storage", cents: 40000, bitcoin: 334300, kind: "stack" },
  ];

  // October: daily spending (cents) for the whole month, and category totals through day 19.
  const octDaily = [
    0, 8420, 4210, 28600, 0, 6150, 18450, 3320, 7240, 12980, 0, 6825, 15400, 9310, 0, 19480, 2260, 21410, 15200,
    4100, 72000, 0, 14500, 5230, 7000, 6995, 0, 3180, 2350, 0, 0,
  ];
  const octCats = { Groceries: 60000, Dining: 25000, Utilities: 28450, Transport: 22000, Shopping: 21805, Health: 22000 };

  window.PROTO = {
    TODAY,
    RATE,
    six: {
      expenses,
      other,
      octDaily,
      octCats,
      checking: { calm: 481240, trouble: 241240 },
      bills: [
        { day: 2, name: "Mortgage", cents: 140000, debt: true },
        { day: 4, name: "Health insurance", cents: 14500 },
        { day: 6, name: "Internet", cents: 7000 },
        { day: 9, name: "Ridgeline Visa payment", cents: 128436, card: true },
        { day: 12, name: "Electric & water", cents: 18450 },
        { day: 14, name: "Car insurance", cents: 11200 },
        { day: 16, name: "Phone", cents: 6500 },
        { day: 23, name: "Streaming", cents: 2299 },
      ],
      overdue: { day: -3, name: "Car registration", cents: 8600 },
      paydays: [
        { day: 12, cents: 310000, name: "Salary" },
        { day: 26, cents: 310000, name: "Salary" },
      ],
      stack: {
        held: 21932000,
        monthStart: 21259600,
        history: [
          ["Jun", 18617000],
          ["Jul", 19272000],
          ["Aug", 19912000],
          ["Sep", 20612000],
          ["Oct", 21259600],
          ["Nov", 21932000],
        ],
        rates: [
          ["Jun", 9.8],
          ["Jul", 10.4],
          ["Aug", 10.1],
          ["Sep", 11.0],
          ["Oct", 10.2],
        ],
        wallets: [
          ["Cold storage", 21400000],
          ["Spending wallet", 532000],
        ],
      },
      price: { perDollar: 842, legacy: "$118,750.00 per BTC", source: "Fictional demo rate", when: "daily reference · Nov 19" },
      income: [
        ["Salary", 620000],
        ["Design project", 85000],
      ],
      moves: [
        ["Cash reserve", 30000],
        ["Brokerage", 50000],
      ],
      costOfLiving: {
        months: ["Jun", "Jul", "Aug", "Sep", "Oct"],
        usd: [281000, 286500, 279000, 290500, 294610],
        bitcoin: [2927083, 2865000, 2669856, 2665138, 2584298],
      },
      card: { name: "Ridgeline Visa", limit: 600000, balance: { calm: 128436, trouble: 412800 }, dueDay: 9, statement: 128436 },
      mortgage: { name: "Home mortgage", balance: 20992000, history: [21400000, 21332000, 21264000, 21196000, 21128000, 20992000] },
      allowances: [
        ["Groceries", 90000],
        ["Dining", 40000],
        ["Transport", 30000],
        ["Shopping", 25000],
      ],
      horizon: { name: "Base case", retireAge: 58, fundedTo: 95, monthlyUsd: 420000, monthlyBitcoin: 1180000 },
    },
    day3: {
      checking: 201630,
      expenses: [
        { day: 17, name: "Mountain Market", cat: "Groceries", acct: "Checking", cents: 6420, kind: "expense" },
        { day: 18, name: "Fuel", cat: "Transport", acct: "Checking", cents: 4100, kind: "expense" },
        { day: 19, name: "Lunch", cat: "Dining", acct: "Checking", cents: 1850, kind: "expense" },
      ],
    },
  };
})();
