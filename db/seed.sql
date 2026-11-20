-- Sample data loaded into every playgroundX database (small "shop" schema).

CREATE TABLE departments (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  location   text NOT NULL
);

CREATE TABLE employees (
  id            serial PRIMARY KEY,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  email         text UNIQUE NOT NULL,
  department_id integer REFERENCES departments(id),
  manager_id    integer REFERENCES employees(id),
  salary        numeric(10,2) NOT NULL,
  hired_on      date NOT NULL
);

CREATE TABLE customers (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  email      text UNIQUE NOT NULL,
  country    text NOT NULL,
  created_at timestamp NOT NULL
);

CREATE TABLE products (
  id       serial PRIMARY KEY,
  name     text NOT NULL,
  category text NOT NULL,
  price    numeric(8,2) NOT NULL,
  in_stock integer NOT NULL
);

CREATE TABLE orders (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  employee_id integer REFERENCES employees(id),
  ordered_at  timestamp NOT NULL,
  status      text NOT NULL
);

CREATE TABLE order_items (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES orders(id),
  product_id integer NOT NULL REFERENCES products(id),
  quantity   integer NOT NULL,
  unit_price numeric(8,2) NOT NULL
);

INSERT INTO departments (name, location) VALUES
  ('Sales',       'Berlin'),
  ('Engineering', 'Amsterdam'),
  ('Support',     'Dublin'),
  ('Marketing',   'Paris'),
  ('Finance',     'Vienna');

-- 30 employees; the first 5 are managers (no manager themselves)
INSERT INTO employees (first_name, last_name, email, department_id, manager_id, salary, hired_on)
SELECT
  (ARRAY['Anna','Ben','Clara','David','Eva','Felix','Greta','Hugo','Ines','Jan','Katja','Leo','Mia','Noah','Olivia','Paul','Quinn','Rosa','Sam','Tina'])[1 + (g * 7) % 20],
  (ARRAY['Schmidt','Meyer','Fischer','Weber','Wagner','Becker','Hoffmann','Koch','Richter','Klein','Wolf','Neumann'])[1 + (g * 5) % 12],
  'employee' || g || '@example.com',
  1 + (g % 5),
  CASE WHEN g <= 5 THEN NULL ELSE 1 + (g % 5) END,
  round((38000 + (g * 2371) % 52000 + CASE WHEN g <= 5 THEN 30000 ELSE 0 END)::numeric, 2),
  DATE '2015-01-01' + ((g * 97) % 3000)
FROM generate_series(1, 30) AS g;

-- 200 customers
INSERT INTO customers (name, email, country, created_at)
SELECT
  (ARRAY['Alpha','Bravo','Cedar','Delta','Echo','Forge','Globe','Harbor','Iris','Jade'])[1 + g % 10]
    || ' ' || (ARRAY['Trading','Systems','Foods','Labs','Studio','Logistics','Media','Works'])[1 + (g * 3) % 8]
    || ' ' || g,
  'contact' || g || '@customer.example',
  (ARRAY['Germany','Austria','Netherlands','France','Ireland','Spain','Italy','Poland'])[1 + (g * 11) % 8],
  TIMESTAMP '2022-01-01' + (g * 37 % 900) * INTERVAL '1 day' + (g * 13 % 24) * INTERVAL '1 hour'
FROM generate_series(1, 200) AS g;

INSERT INTO products (name, category, price, in_stock) VALUES
  ('Mechanical Keyboard', 'Electronics', 89.90, 120),
  ('Wireless Mouse',      'Electronics', 29.50, 300),
  ('USB-C Hub',           'Electronics', 45.00,  80),
  ('27" Monitor',         'Electronics', 249.00, 40),
  ('Desk Lamp',           'Home',        34.99,  75),
  ('Office Chair',        'Home',       189.00,  25),
  ('Standing Desk',       'Home',       399.00,  12),
  ('Notebook A5',         'Stationery',   4.50, 900),
  ('Gel Pen Set',         'Stationery',   7.80, 650),
  ('Whiteboard',          'Stationery',  59.00,  30),
  ('Coffee Beans 1kg',    'Food',        18.90, 200),
  ('Green Tea Box',       'Food',         9.40, 340),
  ('Protein Bars (12)',   'Food',        16.00, 150),
  ('Backpack',            'Accessories', 64.00,  90),
  ('Water Bottle',        'Accessories', 14.50, 410);

-- 600 orders
INSERT INTO orders (customer_id, employee_id, ordered_at, status)
SELECT
  1 + (g * 17) % 200,
  CASE WHEN g % 10 = 0 THEN NULL ELSE 1 + (g * 3) % 30 END,
  TIMESTAMP '2023-01-01' + (g * 53 % 700) * INTERVAL '1 day' + (g * 7 % 24) * INTERVAL '1 hour',
  (ARRAY['pending','shipped','delivered','delivered','delivered','cancelled'])[1 + g % 6]
FROM generate_series(1, 600) AS g;

-- 1-4 items per order
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, p.id, 1 + (o.id + n) % 5, p.price
FROM orders o
CROSS JOIN LATERAL generate_series(1, 1 + o.id % 4) AS n
JOIN products p ON p.id = 1 + (o.id * 3 + n * 5) % 15;
