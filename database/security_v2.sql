-- ================================================================
-- Hospital Management System - Security v2
-- Run AFTER database/schema.sql
-- Supabase / PostgreSQL
-- ================================================================

begin;

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('admin','doctor','reception','nurse','pharmacist','lab','radiology','accountant')),
  name_ar text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.app_roles(code,name_ar,description) values
('admin','مدير النظام','كامل الصلاحيات'),
('doctor','طبيب','السجل الطبي والزيارات والوصفات'),
('reception','الاستقبال','المرضى والمواعيد والاستقبال'),
('nurse','تمريض','العلامات الحيوية والمتابعة'),
('pharmacist','الصيدلية','الأدوية والمخزون والصرف'),
('lab','المعمل','التحاليل والنتائج'),
('radiology','الأشعة','الأشعة والتقارير'),
('accountant','المحاسبة','الفواتير والمدفوعات والمصروفات والمشتريات')
on conflict(code) do update set name_ar=excluded.name_ar, description=excluded.description;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role_id uuid references public.app_roles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',new.email))
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_role_code()
returns text language sql stable security definer set search_path=public
as $$
  select ar.code from public.profiles p
  join public.app_roles ar on ar.id=p.role_id
  where p.id=auth.uid() and p.is_active and ar.is_active limit 1;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role_code()='admin',false); $$;

create or replace function public.has_role(required_role text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_admin() or public.current_role_code()=required_role; $$;

create or replace function public.has_any_role(required_roles text[])
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_admin() or public.current_role_code()=any(required_roles); $$;

create or replace function public.can_access_patient(target_patient_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.has_any_role(array['doctor','reception','nurse','pharmacist','lab','radiology','accountant'])
  and exists(select 1 from public.patients p where p.id=target_patient_id and p.is_active);
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- RLS is enabled explicitly for all tables created by schema.sql plus security tables.
do $$
declare t text;
begin
  foreach t in array array[
    'departments','clinics','doctors','doctor_clinics','patients','patient_documents',
    'appointments','queue_tickets','visits','vital_signs','diagnoses','visit_diagnoses',
    'medications','prescriptions','prescription_items','lab_tests','lab_orders','lab_order_items',
    'radiology_tests','radiology_orders','inventory_categories','inventory_items','suppliers',
    'purchases','purchase_items','stock_transactions','invoices','invoice_items','payments','expenses',
    'beneficiaries','charity_cases','charity_services','notifications','audit_logs','system_settings',
    'app_roles','profiles'
  ] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

-- Profiles and roles
create policy profiles_select on public.profiles for select to authenticated
using(id=auth.uid() or public.is_admin());
create policy profiles_insert on public.profiles for insert to authenticated
with check(id=auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using(public.is_admin());
create policy app_roles_select on public.app_roles for select to authenticated using(true);
create policy app_roles_admin on public.app_roles for all to authenticated using(public.is_admin()) with check(public.is_admin());

-- Master data
create policy departments_select on public.departments for select to authenticated using(true);
create policy departments_admin on public.departments for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy clinics_select on public.clinics for select to authenticated using(true);
create policy clinics_admin on public.clinics for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy doctors_select on public.doctors for select to authenticated using(true);
create policy doctors_admin on public.doctors for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy doctor_clinics_select on public.doctor_clinics for select to authenticated using(true);
create policy doctor_clinics_admin on public.doctor_clinics for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy diagnoses_select on public.diagnoses for select to authenticated using(true);
create policy diagnoses_admin on public.diagnoses for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy lab_tests_select on public.lab_tests for select to authenticated using(true);
create policy lab_tests_admin on public.lab_tests for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy radiology_tests_select on public.radiology_tests for select to authenticated using(true);
create policy radiology_tests_admin on public.radiology_tests for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy inventory_categories_select on public.inventory_categories for select to authenticated using(true);
create policy inventory_categories_admin on public.inventory_categories for all to authenticated using(public.is_admin()) with check(public.is_admin());

-- Patients
create policy patients_select on public.patients for select to authenticated
using(public.has_any_role(array['doctor','reception','nurse','pharmacist','lab','radiology','accountant']));
create policy patients_insert on public.patients for insert to authenticated
with check(public.has_any_role(array['doctor','reception','nurse']));
create policy patients_update on public.patients for update to authenticated
using(public.has_any_role(array['doctor','reception','nurse']))
with check(public.has_any_role(array['doctor','reception','nurse']));
create policy patients_delete on public.patients for delete to authenticated using(public.is_admin());

create policy patient_documents_select on public.patient_documents for select to authenticated
using(public.can_access_patient(patient_id));
create policy patient_documents_insert on public.patient_documents for insert to authenticated
with check(public.has_any_role(array['doctor','reception','nurse']) and public.can_access_patient(patient_id));
create policy patient_documents_update on public.patient_documents for update to authenticated
using(public.has_any_role(array['doctor','reception','nurse']))
with check(public.has_any_role(array['doctor','reception','nurse']));
create policy patient_documents_delete on public.patient_documents for delete to authenticated using(public.is_admin());

-- Appointments and queue
create policy appointments_select on public.appointments for select to authenticated
using(public.has_any_role(array['doctor','reception','nurse','accountant']));
create policy appointments_insert on public.appointments for insert to authenticated
with check(public.has_any_role(array['doctor','reception']));
create policy appointments_update on public.appointments for update to authenticated
using(public.has_any_role(array['doctor','reception','nurse']))
with check(public.has_any_role(array['doctor','reception','nurse']));
create policy appointments_delete on public.appointments for delete to authenticated using(public.is_admin());
create policy queue_select on public.queue_tickets for select to authenticated
using(public.has_any_role(array['doctor','reception','nurse']));
create policy queue_insert on public.queue_tickets for insert to authenticated
with check(public.has_any_role(array['reception','nurse']));
create policy queue_update on public.queue_tickets for update to authenticated
using(public.has_any_role(array['doctor','reception','nurse']))
with check(public.has_any_role(array['doctor','reception','nurse']));
create policy queue_delete on public.queue_tickets for delete to authenticated using(public.is_admin());

-- Clinical records
create policy visits_select on public.visits for select to authenticated
using(public.has_any_role(array['doctor','nurse','reception','lab','radiology']));
create policy visits_insert on public.visits for insert to authenticated
with check(public.has_any_role(array['doctor','nurse']));
create policy visits_update on public.visits for update to authenticated
using(public.has_any_role(array['doctor','nurse'])) with check(public.has_any_role(array['doctor','nurse']));
create policy visits_delete on public.visits for delete to authenticated using(public.is_admin());
create policy vitals_select on public.vital_signs for select to authenticated using(public.has_any_role(array['doctor','nurse']));
create policy vitals_insert on public.vital_signs for insert to authenticated with check(public.has_any_role(array['doctor','nurse']));
create policy vitals_update on public.vital_signs for update to authenticated using(public.has_any_role(array['doctor','nurse'])) with check(public.has_any_role(array['doctor','nurse']));
create policy vitals_delete on public.vital_signs for delete to authenticated using(public.is_admin());
create policy visit_diagnoses_select on public.visit_diagnoses for select to authenticated using(public.has_any_role(array['doctor','nurse']));
create policy visit_diagnoses_write on public.visit_diagnoses for all to authenticated using(public.has_role('doctor')) with check(public.has_role('doctor'));

-- Pharmacy
create policy medications_select on public.medications for select to authenticated using(true);
create policy medications_pharmacist on public.medications for all to authenticated using(public.has_role('pharmacist')) with check(public.has_role('pharmacist'));
create policy prescriptions_select on public.prescriptions for select to authenticated using(public.has_any_role(array['doctor','nurse','pharmacist']));
create policy prescriptions_doctor_insert on public.prescriptions for insert to authenticated with check(public.has_role('doctor'));
create policy prescriptions_update on public.prescriptions for update to authenticated using(public.has_any_role(array['doctor','pharmacist'])) with check(public.has_any_role(array['doctor','pharmacist']));
create policy prescriptions_delete on public.prescriptions for delete to authenticated using(public.is_admin());
create policy prescription_items_select on public.prescription_items for select to authenticated using(public.has_any_role(array['doctor','nurse','pharmacist']));
create policy prescription_items_doctor on public.prescription_items for all to authenticated using(public.has_role('doctor')) with check(public.has_role('doctor'));
create policy inventory_items_select on public.inventory_items for select to authenticated using(true);
create policy inventory_items_pharmacist on public.inventory_items for all to authenticated using(public.has_role('pharmacist')) with check(public.has_role('pharmacist'));
create policy suppliers_select on public.suppliers for select to authenticated using(public.has_any_role(array['accountant','pharmacist']));
create policy suppliers_write on public.suppliers for all to authenticated using(public.has_any_role(array['accountant','pharmacist'])) with check(public.has_any_role(array['accountant','pharmacist']));
create policy purchases_select on public.purchases for select to authenticated using(public.has_any_role(array['accountant','pharmacist']));
create policy purchases_write on public.purchases for all to authenticated using(public.has_any_role(array['accountant','pharmacist'])) with check(public.has_any_role(array['accountant','pharmacist']));
create policy purchase_items_select on public.purchase_items for select to authenticated using(public.has_any_role(array['accountant','pharmacist']));
create policy purchase_items_write on public.purchase_items for all to authenticated using(public.has_any_role(array['accountant','pharmacist'])) with check(public.has_any_role(array['accountant','pharmacist']));
create policy stock_transactions_select on public.stock_transactions for select to authenticated using(public.has_any_role(array['accountant','pharmacist']));
create policy stock_transactions_insert on public.stock_transactions for insert to authenticated with check(public.has_role('pharmacist'));

-- Laboratory / Radiology
create policy lab_orders_select on public.lab_orders for select to authenticated using(public.has_any_role(array['doctor','nurse','lab']));
create policy lab_orders_insert on public.lab_orders for insert to authenticated with check(public.has_role('doctor'));
create policy lab_orders_update on public.lab_orders for update to authenticated using(public.has_any_role(array['doctor','lab'])) with check(public.has_any_role(array['doctor','lab']));
create policy lab_orders_delete on public.lab_orders for delete to authenticated using(public.is_admin());
create policy lab_items_select on public.lab_order_items for select to authenticated using(public.has_any_role(array['doctor','nurse','lab']));
create policy lab_items_lab on public.lab_order_items for all to authenticated using(public.has_role('lab')) with check(public.has_role('lab'));
create policy radiology_orders_select on public.radiology_orders for select to authenticated using(public.has_any_role(array['doctor','nurse','radiology']));
create policy radiology_orders_insert on public.radiology_orders for insert to authenticated with check(public.has_role('doctor'));
create policy radiology_orders_update on public.radiology_orders for update to authenticated using(public.has_any_role(array['doctor','radiology'])) with check(public.has_any_role(array['doctor','radiology']));
create policy radiology_orders_delete on public.radiology_orders for delete to authenticated using(public.is_admin());

-- Finance
create policy invoices_select on public.invoices for select to authenticated using(public.has_any_role(array['accountant','reception']));
create policy invoices_insert on public.invoices for insert to authenticated with check(public.has_any_role(array['accountant','reception']));
create policy invoices_update on public.invoices for update to authenticated using(public.has_role('accountant')) with check(public.has_role('accountant'));
create policy invoices_delete on public.invoices for delete to authenticated using(public.is_admin());
create policy invoice_items_select on public.invoice_items for select to authenticated using(public.has_any_role(array['accountant','reception']));
create policy invoice_items_write on public.invoice_items for all to authenticated using(public.has_any_role(array['accountant','reception'])) with check(public.has_any_role(array['accountant','reception']));
create policy payments_select on public.payments for select to authenticated using(public.has_any_role(array['accountant','reception']));
create policy payments_insert on public.payments for insert to authenticated with check(public.has_any_role(array['accountant','reception']));
create policy payments_update on public.payments for update to authenticated using(public.has_role('accountant')) with check(public.has_role('accountant'));
create policy payments_delete on public.payments for delete to authenticated using(public.is_admin());
create policy expenses_select on public.expenses for select to authenticated using(public.has_role('accountant'));
create policy expenses_write on public.expenses for all to authenticated using(public.has_role('accountant')) with check(public.has_role('accountant'));

commit;

-- First administrator:
-- 1) Create a user in Supabase Authentication.
-- 2) Set that user's role_id in public.profiles to the id of app_roles.code='admin'.
-- Never put a service_role key in the Web App.
