CREATE TABLE app.booking_forms (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  organization text NOT NULL,
  use_case text NOT NULL,
  details text NOT NULL,
  slot_date text NOT NULL UNIQUE,
  slot_start text NOT NULL,
  hours integer NOT NULL,
  duration_label text NOT NULL,
  fee_label text NOT NULL,
  reference text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX booking_forms_slot_idx ON app.booking_forms (slot_date);
