-- School sample data loaded into every playgroundX database.
--   11 subjects, 15 teachers, 200 students (8 classes), 176 lessons,
--   8,800 grades, 22,000 attendance rows.
-- Foreign keys are added after the bulk load to keep seeding fast.
SET statement_timeout = 0;
SELECT setseed(0.42);

CREATE TABLE subjects (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  weekly_hours  integer NOT NULL
);

CREATE TABLE teachers (
  id          integer PRIMARY KEY,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  email       text NOT NULL,
  subject_id  integer NOT NULL,   -- main subject
  hired_on    date NOT NULL
);

CREATE TABLE students (
  id             integer PRIMARY KEY,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  class_name     text NOT NULL,
  date_of_birth  date NOT NULL,
  email          text NOT NULL
);

CREATE TABLE lessons (
  id          integer PRIMARY KEY,
  subject_id  integer NOT NULL,
  teacher_id  integer NOT NULL,
  class_name  text NOT NULL,
  weekday     integer NOT NULL,   -- 1 = Monday ... 5 = Friday
  period      integer NOT NULL,   -- 1..6
  room        text NOT NULL
);

CREATE TABLE grades (
  id          integer PRIMARY KEY,
  student_id  integer NOT NULL,
  lesson_id   integer NOT NULL,
  grade       integer NOT NULL,   -- 1 (best) .. 6 (worst)
  kind        text NOT NULL,      -- test / homework / oral
  graded_on   date NOT NULL
);

CREATE TABLE attendance (
  id               integer PRIMARY KEY,
  student_id       integer NOT NULL,
  lesson_id        integer NOT NULL,
  attendance_date  date NOT NULL,
  status           text NOT NULL  -- present / late / absent / excused
);

INSERT INTO subjects (id, name, weekly_hours) VALUES
  (1,'Mathematics',4),(2,'German',4),(3,'English',3),(4,'Physics',2),
  (5,'Chemistry',2),(6,'Biology',2),(7,'History',2),(8,'Geography',2),
  (9,'Art',1),(10,'Music',1),(11,'Physical Education',2);

-- teachers 1..11 teach subject = id; teachers 12..15 teach subjects 1..4 as well
INSERT INTO teachers (id, first_name, last_name, email, subject_id, hired_on)
SELECT g,
  (ARRAY['Anna','Ben','Clara','David','Eva','Felix','Greta','Hugo','Ines','Jan','Katja','Leo','Mia','Noah','Olivia'])[g],
  (ARRAY['Schmidt','Meyer','Fischer','Weber','Wagner','Becker','Hoffmann','Koch','Richter','Klein','Wolf','Neumann','Schwarz','Zimmermann','Braun'])[g],
  'teacher' || g || '@school.example',
  CASE WHEN g <= 11 THEN g ELSE g - 11 END,
  DATE '2005-08-01' + (g * 331) % 6000
FROM generate_series(1, 15) AS g;

-- 200 students, 25 per class
INSERT INTO students (id, first_name, last_name, class_name, date_of_birth, email)
SELECT g,
  (ARRAY['Lukas','Emma','Finn','Mia','Leon','Hannah','Paul','Sophie','Jonas','Lena','Elias','Marie','Noah','Lea','Ben','Anna','Tim','Laura','Max','Nele'])[1 + (g * 7) % 20],
  (ARRAY['Müller','Schneider','Krüger','Lange','Schmitt','Hartmann','Krause','Lehmann','Schulz','Maier','Köhler','Herrmann','König','Walter','Peters'])[1 + (g * 11) % 15],
  (ARRAY['5a','5b','6a','6b','7a','7b','8a','8b'])[1 + (g - 1) % 8],
  DATE '2010-09-01' - (((1 + (g - 1) % 8) / 2) * 365) + ((g * 53) % 330),
  'student' || g || '@school.example'
FROM generate_series(1, 200) AS g;

-- 22 lessons per class (each subject twice a week): 8 x 22 = 176
INSERT INTO lessons (id, subject_id, teacher_id, class_name, weekday, period, room)
SELECT (c - 1) * 22 + k,
  s,
  CASE WHEN s <= 4 AND c % 2 = 0 THEN s + 11 ELSE s END,
  (ARRAY['5a','5b','6a','6b','7a','7b','8a','8b'])[c],
  1 + (k - 1) % 5,
  1 + ((k - 1) / 5 + c) % 6,
  'R' || (100 + c * 3 + s)
FROM generate_series(1, 8) AS c
CROSS JOIN generate_series(1, 22) AS k
CROSS JOIN LATERAL (SELECT 1 + (k - 1) % 11 AS s) AS x;

-- 2 grades per student per lesson of their class: 200 x 22 x 2 = 8,800
INSERT INTO grades (id, student_id, lesson_id, grade, kind, graded_on)
SELECT row_number() OVER (ORDER BY st.id, l.id, n),
  st.id, l.id,
  least(6, greatest(1, round(3.0 + ((st.id * 37) % 7 - 3) * 0.25 + (random() + random() + random() - 1.5) * 2)))::int,
  (ARRAY['test','homework','oral'])[1 + (st.id + l.id + n) % 3],
  DATE '2025-09-15' + ((st.id * 7 + l.id * 3 + n * 29) % 90)
FROM students st
JOIN lessons l ON l.class_name = st.class_name
CROSS JOIN generate_series(1, 2) AS n;

-- 5 weeks of attendance per student per lesson: 200 x 22 x 5 = 22,000
INSERT INTO attendance (id, student_id, lesson_id, attendance_date, status)
SELECT row_number() OVER (ORDER BY st.id, l.id, w),
  st.id, l.id,
  DATE '2025-09-01' + (w - 1) * 7 + (l.weekday - 1),
  CASE
    WHEN r < 0.90 THEN 'present'
    WHEN r < 0.95 THEN 'late'
    WHEN r < 0.98 THEN 'excused'
    ELSE 'absent'
  END
FROM students st
JOIN lessons l ON l.class_name = st.class_name
CROSS JOIN generate_series(1, 5) AS w
CROSS JOIN LATERAL (SELECT random() AS r) AS rr;

ALTER TABLE teachers   ADD FOREIGN KEY (subject_id) REFERENCES subjects(id);
ALTER TABLE lessons    ADD FOREIGN KEY (subject_id) REFERENCES subjects(id);
ALTER TABLE lessons    ADD FOREIGN KEY (teacher_id) REFERENCES teachers(id);
ALTER TABLE grades     ADD FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE grades     ADD FOREIGN KEY (lesson_id)  REFERENCES lessons(id);
ALTER TABLE attendance ADD FOREIGN KEY (student_id) REFERENCES students(id);
ALTER TABLE attendance ADD FOREIGN KEY (lesson_id)  REFERENCES lessons(id);

ANALYZE;
