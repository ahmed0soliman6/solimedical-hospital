-- ================================================================
-- نظام إدارة مستشفى لجنة زكاة ميت على التخصصي
-- PostgreSQL / Supabase
-- Initial database schema
-- ================================================================

create extension if not exists pgcrypto;

-- -------------------------
-- Generic updated_at trigger
-- -------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- -------------------------
-- Departments / Clinics / Doctors
-- -------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  code text unique,
  location text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  specialty text,
  license_number text unique,
  phone text,
  email text,
  department_id uuid references public.departments(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.doctor_clinics (
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  primary key (doctor_id, clinic_id)
);

-- -------------------------
-- Patients
-- -------------------------
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  medical_record_no text not null unique,
  national_id text unique,
  full_name text not null,
  date_of_birth date,
  gender text check (gender in ('male','female','other')),
  phone text,
  alternate_phone text,
  address text,
  marital_status text,
  blood_type text check (blood_type in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  allergies text,
  chronic_conditions text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_type text not null,
  title text,
  storage_path text,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

-- -------------------------
-- Appointments / Queue
-- -------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid references public.doctors(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  appointment_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','checked_in','in_progress','completed','cancelled','no_show')),
  reason text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.queue_tickets (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references public.appointments(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  clinic_id uuid references public.clinics(id) on delete set null,
  ticket_date date not null default current_date,
  ticket_number integer not null,
  status text not null default 'waiting' check (status in ('waiting','called','in_service','completed','cancelled')),
  called_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_date, clinic_id, ticket_number)
);

-- -------------------------
-- Visits / Clinical record
-- -------------------------
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid references public.doctors(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  visit_at timestamptz not null default timezone('utc', now()),
  chief_complaint text,
  history_of_present_illness text,
  examination_notes text,
  assessment text,
  treatment_plan text,
  follow_up_date date,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.vital_signs (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  temperature numeric(4,1),
  systolic_bp integer,
  diastolic_bp integer,
  pulse integer,
  respiratory_rate integer,
  oxygen_saturation numeric(5,2),
  weight_kg numeric(6,2),
  height_cm numeric(6,2),
  recorded_at timestamptz not null default timezone('utc', now()),
  notes text
);

create table if not exists public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.visit_diagnoses (
  visit_id uuid not null references public.visits(id) on delete cascade,
  diagnosis_id uuid not null references public.diagnoses(id) on delete restrict,
  diagnosis_type text not null default 'primary' check (diagnosis_type in ('primary','secondary','differential')),
  notes text,
  primary key (visit_id, diagnosis_id)
);

-- -------------------------
-- Pharmacy / Prescriptions
-- -------------------------
create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  generic_name text,
  form text,
  strength text,
  barcode text unique,
  unit text,
  reorder_level numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete restrict,
  doctor_id uuid references public.doctors(id) on delete set null,
  prescribed_at timestamptz not null default timezone('utc', now()),
  notes text,
  status text not null default 'active' check (status in ('active','dispensed','cancelled')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  medication_id uuid not null references public.medications(id) on delete restrict,
  dosage text,
  frequency text,
  duration text,
  route text,
  quantity numeric(12,2),
  instructions text
);

-- -------------------------
-- Laboratory
-- -------------------------
create table if not exists public.lab_tests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  category text,
  specimen_type text,
  reference_range text,
  unit text,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete set null,
  ordered_by uuid references public.doctors(id) on delete set null,
  ordered_at timestamptz not null default timezone('utc', now()),
  status text not null default 'ordered' check (status in ('ordered','sample_collected','processing','completed','cancelled')),
  notes text
);

create table if not exists public.lab_order_items (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references public.lab_orders(id) on delete cascade,
  lab_test_id uuid not null references public.lab_tests(id) on delete restrict,
  result_value text,
  result_numeric numeric,
  result_unit text,
  reference_range text,
  result_flag text,
  notes text,
  completed_at timestamptz
);

-- -------------------------
-- Radiology
-- -------------------------
create table if not exists public.radiology_tests (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  modality text,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.radiology_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  visit_id uuid references public.visits(id) on delete set null,
  ordered_by uuid references public.doctors(id) on delete set null,
  radiology_test_id uuid not null references public.radiology_tests(id) on delete restrict,
  ordered_at timestamptz not null default timezone('utc', now()),
  status text not null default 'ordered' check (status in ('ordered','scheduled','performed','reported','cancelled')),
  findings text,
  impression text,
  report_text text,
  report_storage_path text,
  completed_at timestamptz
);

-- -------------------------
-- Inventory / Suppliers / Purchases
-- -------------------------
create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.inventory_categories(id) on delete set null,
  medication_id uuid references public.medications(id) on delete set null,
  item_code text unique,
  name text not null,
  unit text,
  quantity numeric(14,3) not null default 0,
  reorder_level numeric(14,3) not null default 0,
  expiry_date date,
  batch_number text,
  purchase_price numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  tax_number text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_number text,
  purchase_date date not null default current_date,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','received','cancelled')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  expiry_date date,
  batch_number text,
  total numeric(14,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('purchase','sale','dispense','return','adjustment','waste','transfer_in','transfer_out')),
  quantity numeric(14,3) not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- -------------------------
-- Finance
-- -------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  invoice_number text not null unique,
  invoice_date timestamptz not null default timezone('utc', now()),
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid','partially_paid','paid','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  service_type text not null,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  total numeric(14,2) generated always as (quantity * unit_price) stored
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer','other')),
  payment_date timestamptz not null default timezone('utc', now()),
  reference_number text,
  notes text,
  received_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer','other')),
  reference_number text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

-- -------------------------
-- Charity / Zakat beneficiaries
-- -------------------------
create table if not exists public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  beneficiary_no text not null unique,
  full_name text not null,
  national_id text unique,
  phone text,
  address text,
  marital_status text,
  family_size integer check (family_size is null or family_size >= 0),
  eligibility_status text not null default 'pending' check (eligibility_status in ('pending','approved','rejected','suspended')),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.charity_cases (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete restrict,
  case_type text not null,
  description text,
  requested_amount numeric(14,2) not null default 0,
  approved_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed','cancelled')),
  decision_date date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.charity_services (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.charity_cases(id) on delete cascade,
  service_type text not null,
  service_date date not null default current_date,
  provider_name text,
  amount numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

-- -------------------------
-- Application settings / notifications / audit
-- -------------------------
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text not null,
  message text not null,
  notification_type text,
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  table_name text,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

-- -------------------------
-- Indexes
-- -------------------------
create index if not exists idx_patients_name on public.patients using gin (to_tsvector('simple', full_name));
create index if not exists idx_patients_phone on public.patients(phone);
create index if not exists idx_patients_national_id on public.patients(national_id);
create index if not exists idx_appointments_date on public.appointments(appointment_at);
create index if not exists idx_appointments_patient on public.appointments(patient_id);
create index if not exists idx_appointments_doctor on public.appointments(doctor_id);
create index if not exists idx_visits_patient on public.visits(patient_id, visit_at desc);
create index if not exists idx_visits_doctor on public.visits(doctor_id, visit_at desc);
create index if not exists idx_lab_orders_patient on public.lab_orders(patient_id, ordered_at desc);
create index if not exists idx_radiology_orders_patient on public.radiology_orders(patient_id, ordered_at desc);
create index if not exists idx_stock_transactions_item on public.stock_transactions(inventory_item_id, created_at desc);
create index if not exists idx_invoices_patient on public.invoices(patient_id, invoice_date desc);
create index if not exists idx_payments_date on public.payments(payment_date desc);
create index if not exists idx_expenses_date on public.expenses(expense_date desc);
create index if not exists idx_audit_logs_user on public.audit_logs(user_id, created_at desc);

-- -------------------------
-- updated_at triggers
-- -------------------------
create trigger trg_departments_updated_at before update on public.departments for each row execute function public.set_updated_at();
create trigger trg_clinics_updated_at before update on public.clinics for each row execute function public.set_updated_at();
create trigger trg_doctors_updated_at before update on public.doctors for each row execute function public.set_updated_at();
create trigger trg_patients_updated_at before update on public.patients for each row execute function public.set_updated_at();
create trigger trg_appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
create trigger trg_visits_updated_at before update on public.visits for each row execute function public.set_updated_at();
create trigger trg_medications_updated_at before update on public.medications for each row execute function public.set_updated_at();
create trigger trg_inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger trg_suppliers_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger trg_purchases_updated_at before update on public.purchases for each row execute function public.set_updated_at();
create trigger trg_invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger trg_beneficiaries_updated_at before update on public.beneficiaries for each row execute function public.set_updated_at();
create trigger trg_charity_cases_updated_at before update on public.charity_cases for each row execute function public.set_updated_at();

-- -------------------------
-- Seed essential settings
-- -------------------------
insert into public.system_settings(key, value, description)
values
('hospital_name', '"نظام إدارة مستشفى لجنة زكاة ميت على التخصصي"'::jsonb, 'اسم النظام'),
('default_currency', '"EGP"'::jsonb, 'العملة الافتراضية'),
('timezone', '"Africa/Cairo"'::jsonb, 'المنطقة الزمنية')
on conflict (key) do nothing;

-- NOTE:
-- 1) Authentication users should be created with Supabase Auth.
-- 2) Do not store passwords in application tables.
-- 3) RLS policies are intentionally added in the next migration after
--    the application roles/users are mapped to auth.users.
-- 4) This schema creates the data model only; it does not migrate
--    existing local/browser data automatically.
