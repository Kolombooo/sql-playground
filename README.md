# SQL Playground

A Docker app for teaching SQL. Students enter one shared password plus a number
(1–50) and get their own PostgreSQL database `playgroundN` with sample data, a
query editor, results table, and a structure panel (tables, columns, keys and
row counts — never table contents).

## Run

```bash
cp .env.example .env   # then edit the passwords
docker compose up --build
```

Open http://localhost:3000. The first start creates and seeds all 50 databases
(a few seconds); data persists in the `pgdata` volume.

## Sample data

A linked school schema: `subjects` (11), `teachers` (15), `students` (200, 8 classes),
`lessons` (176, each with a subject and teacher), `grades` (8,800) and `attendance` (22,000).

## Load handling

All database work goes through a FIFO queue (`MAX_CONCURRENT` at a time, max 200 waiting).
While a query waits, the browser shows its queue position and estimated time; if the student
waited, the result line says how long. One query per student at a time. Tested with 25 students at once.

## How it works

- `APP_PASSWORD` is the only credential students type; everything else is hard coded/configured.
- The chosen number is stored unhashed in the `playground` cookie. A signed `auth`
  cookie (HttpOnly) proves the password was entered, so editing the number cookie alone does nothing.
- Each `playgroundN` is owned by its own Postgres role; `CONNECT` is revoked from everyone else,
  so a student can't read other databases. Queries have a 5 s timeout, results are capped at 500 rows.
- "Reset database" drops everything in the student's database and reloads `db/seed.sql`.
- Tailwind CSS is compiled during the Docker build (`npm run build:css` locally).

## Customising

Edit `db/seed.sql` to change the sample data, then bump `SEED_MARKER` in `server/provision.js`:
on the next start every database is rebuilt (student work is wiped).
`MAX_CONCURRENT` (default 8) in `.env`/compose sets how many queries run at once.
Postgres isn't exposed on the host; the app is the only way in.
