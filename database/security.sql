-- ================================================================
-- نظام إدارة مستشفى لجنة زكاة ميت على التخصصي
-- Supabase / PostgreSQL Security Layer
-- Roles + Authorization Functions + RLS Policies
-- Run AFTER database/schema.sql
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- 1) Application roles
-- ----------------------------------------------------------------
create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in (
    'admin','doctor','reception','nurse','pharmacist','lab','radiology','accountant'
  )),
  name_ar text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.app_roles (code, name_ar, description) values
  ('admin','مدير النظام','صلاحية كاملة على النظام'),
  ('doctor','طبيب','إدارة المرضى والزيارات والسجلات الطبية والوصفات'),
  ('reception','الاستقبال','تسجيل المرضى والمواعيد وقائمة الانتظار'),
  ('nurse','تمريض','العلامات الحيوية ومتابعة الزيارات التمريضية'),
  ('pharmacist','الصيدلية','الأدوية والصرف والمخزون'),
  ('lab','المعمل','طلبات ونتائج التحاليل'),
  ('radiology','الأشعة','طلبات وتقارير الأشعة'),
  ('accountant','المحاسبة','الفواتير والمدفوعات والمصروفات والمشتريات')
on conflict (code) do update set
  name_ar = excluded.name_ar,
  description = excluded.description;

-- ----------------------------------------------------------------
-- 2) User profiles linked to Supabase Auth
-- ----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role_id uuid references public.app_roles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ----------------------------------------------------------------
-- 3) Automatic profile creation for new Auth users
-- ----------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------
-- 4) Authorization helper functions
-- SECURITY DEFINER prevents recursive RLS evaluation when policies
-- inspect the current user's profile/role.
-- ----------------------------------------------------------------
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ar.code
  from public.profiles p
  join public.app_roles ar on ar.id = p.role_id
  where p.id = auth.uid()
    and p.is_active = true
    and ar.is_active = true
  limit 1;
$$;

create or replace function public.has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() = required_role
     or public.current_role_code() = 'admin';
$$;

create or replace function public.has_any_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() = any(required_roles)
     or public.current_role_code() = 'admin';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() = 'admin';
$$;

create or replace function public.can_access_patient(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_code() in ('admin','doctor','reception','nurse','pharmacist','lab','radiology','accountant')
     and exists (select 1 from public.patients p where p.id = target_patient_id and p.is_active = true);
$$;

-- ----------------------------------------------------------------
-- 5) updated_at for profiles
-- ----------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------
-- 6) Enable RLS on all application tables
-- ----------------------------------------------------------------
DO $$
declare
  t text;
begin
  foreach t in array array[
    'departments','clinics','doctors','doctor_clinics',
    'patients','patient_documents',
    'appointments','queue_tickets',
    'visits','vital_signs','diagnoses','visit_diagnoses',
    'medications','prescriptions','prescription_items',
    'lab_tests','lab_orders','lab_order_items',
    'radiology_tests','radiology_orders',
    'inventory_categories','inventory_items','suppliers','purchases','purchase_items','stock_transactions',
    'invoices','invoice_items','payments','expenses',
    'beneficiaries','charity_cases','charity_services',
    'notifications','audit_logs','system_settings','profiles','app_roles'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 7) Drop/recreate policies to keep this script safely re-runnable
-- ----------------------------------------------------------------
DO $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'departments','clinics','doctors','doctor_clinics','patients','patient_documents',
        'appointments','queue_tickets','visits','vital_signs','diagnoses','visit_diagnoses',
        'medications','prescriptions','prescription_items','lab_tests','lab_orders','lab_order_items',
        'radiology_tests','radiology_orders','inventory_categories','inventory_items','suppliers',
        'purchases','purchase_items','stock_transactions','invoices','invoice_items','payments','expenses',
        'beneficiaries','charity_cases','charity_services','notifications','audit_logs','system_settings',
        'profiles','app_roles'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 8) Profiles / roles
-- ----------------------------------------------------------------
create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy profiles_admin_insert
on public.profiles for insert to authenticated
with check (public.is_admin() or id = auth.uid());

create policy app_roles_read_authenticated
on public.app_roles for select to authenticated
using (true);

create policy app_roles_admin_write
on public.app_roles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ----------------------------------------------------------------
-- 9) Master data
-- ----------------------------------------------------------------
create policy departments_read_authenticated on public.departments for select to authenticated using (true);
create policy departments_admin_write on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy clinics_read_authenticated on public.clinics for select to authenticated using (true);
create policy clinics_admin_write on public.clinics for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy doctors_read_authenticated on public.doctors for select to authenticated using (true);
create policy doctors_admin_write on public.doctors for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy doctor_clinics_read_authenticated on public.doctor_clinics for select to authenticated using (true);
create policy doctor_clinics_admin_write on public.doctor_clinics for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy diagnoses_read_authenticated on public.diagnoses for select to authenticated using (true);
create policy diagnoses_admin_write on public.diagnoses for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy lab_tests_read_authenticated on public.lab_tests for select to authenticated using (true);
create policy lab_tests_admin_write on public.lab_tests for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy radiology_tests_read_authenticated on public.radiology_tests for select to authenticated using (true);
create policy radiology_tests_admin_write on public.radiology_tests for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy inventory_categories_read_authenticated on public.inventory_categories for select to authenticated using (true);
create policy inventory_categories_admin_write on public.inventory_categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------
-- 10) Patients
-- ----------------------------------------------------------------
create policy patients_select_staff
on public.patients for select to authenticated
using (public.has_any_role(array['doctor','reception','nurse','pharmacist','lab','radiology','accountant']));

create policy patients_insert_clinical_staff
on public.patients for insert to authenticated
with check (public.has_any_role(array['doctor','reception','nurse']));

create policy patients_update_clinical_staff
on public.patients for update to authenticated
using (public.has_any_role(array['doctor','reception','nurse']))
with check (public.has_any_role(array['doctor','reception','nurse']));

after patients_delete_admin
-- Intentionally omitted: patient deletion should be restricted to administrators.

create policy patients_delete_admin
on public.patients for delete to authenticated
using (public.is_admin());

create policy patient_documents_staff_select
on public.patient_documents for select to authenticated
using (public.can_access_patient(patient_id));

create policy patient_documents_staff_insert
on public.patient_documents for insert to authenticated
with check (public.has_any_role(array['doctor','reception','nurse']) and public.can_access_patient(patient_id));

create policy patient_documents_staff_update
on public.patient_documents for update to authenticated
using (public.has_any_role(array['doctor','reception','nurse']) and public.can_access_patient(patient_id))
with check (public.has_any_role(array['doctor','reception','nurse']) and public.can_access_patient(patient_id));

create policy patient_documents_admin_delete
on public.patient_documents for delete to authenticated
using (public.is_admin());

-- ----------------------------------------------------------------
-- 11) Appointments / queue
-- ----------------------------------------------------------------
create policy appointments_staff_select
on public.appointments for select to authenticated
using (public.has_any_role(array['doctor','reception','nurse','accountant']));

create policy appointments_reception_insert
on public.appointments for insert to authenticated
with check (public.has_any_role(array['reception','doctor']));

create policy appointments_staff_update
on public.appointments for update to authenticated
using (public.has_any_role(array['reception','doctor','nurse']))
with check (public.has_any_role(array['reception','doctor','nurse']));

create policy appointments_admin_delete
on public.appointments for delete to authenticated
using (public.is_admin());

create policy queue_staff_select
on public.queue_tickets for select to authenticated
using (public.has_any_role(array['reception','doctor','nurse']));

create policy queue_staff_insert
on public.queue_tickets for insert to authenticated
with check (public.has_any_role(array['reception','nurse']));

create policy queue_staff_update
on public.queue_tickets for update to authenticated
using (public.has_any_role(array['reception','doctor','nurse']))
with check (public.has_any_role(array['reception','doctor','nurse']));

create policy queue_admin_delete on public.queue_tickets for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------
-- 12) Clinical records
-- ----------------------------------------------------------------
create policy visits_clinical_select
on public.visits for select to authenticated
using (public.has_any_role(array['doctor','nurse','reception','lab','radiology']));

create policy visits_doctor_nurse_insert
on public.visits for insert to authenticated
with check (public.has_any_role(array['doctor','nurse']));

create policy visits_doctor_nurse_update
on public.visits for update to authenticated
using (public.has_any_role(array['doctor','nurse']))
with check (public.has_any_role(array['doctor','nurse']));

create policy visits_admin_delete on public.visits for delete to authenticated using (public.is_admin());

create policy vitals_clinical_select on public.vital_signs for select to authenticated using (public.has_any_role(array['doctor','nurse']));
create policy vitals_nurse_insert on public.vital_signs for insert to authenticated with check (public.has_any_role(array['nurse','doctor']));
create policy vitals_clinical_update on public.vital_signs for update to authenticated using (public.has_any_role(array['nurse','doctor'])) with check (public.has_any_role(array['nurse','doctor']));
create policy vitals_admin_delete on public.vital_signs for delete to authenticated using (public.is_admin());

create policy visit_diagnoses_clinical_select on public.visit_diagnoses for select to authenticated using (public.has_any_role(array['doctor','nurse']));
create policy visit_diagnoses_doctor_write on public.visit_diagnoses for all to authenticated using (public.has_role('doctor')) with check (public.has_role('doctor'));

-- ----------------------------------------------------------------
-- 13) Pharmacy
-- ----------------------------------------------------------------
create policy medications_read_authenticated on public.medications for select to authenticated using (true);
create policy medications_pharmacy_write on public.medications for all to authenticated using (public.has_role('pharmacist')) with check (public.has_role('pharmacist'));

create policy prescriptions_clinical_select on public.prescriptions for select to authenticated using (public.has_any_role(array['doctor','nurse','pharmacist']));
create policy prescriptions_doctor_insert on public.prescriptions for insert to authenticated with check (public.has_role('doctor'));
create policy prescriptions_doctor_update on public.prescriptions for update to authenticated using (public.has_role('doctor')) with check (public.has_role('doctor'));
create policy prescriptions_pharmacist_update on public.prescriptions for update to authenticated using (public.has_role('pharmacist')) with check (public.has_role('pharmacist'));
create policy prescriptions_admin_delete on public.prescriptions for delete to authenticated using (public.is_admin());

create policy prescription_items_clinical_select on public.prescription_items for select to authenticated using (public.has_any_role(array['doctor','nurse','pharmacist']));
create policy prescription_items_doctor_write on public.prescription_items for all to authenticated using (public.has_role('doctor')) with check (public.has_role('doctor'));

create policy inventory_items_read_authenticated on public.inventory_items for select to authenticated using (true);
create policy inventory_items_pharmacy_write on public.inventory_items for all to authenticated using (public.has_role('pharmacist')) with check (public.has_role('pharmacist'));

create policy suppliers_accountant_pharmacy_select on public.suppliers for select to authenticated using (public.has_any_role(array['accountant','pharmacist']));
create policy suppliers_accountant_pharmacy_write on public.suppliers for all to authenticated using (public.has_any_role(array['accountant','pharmacist'])) with check (public.has_any_role(array['accountant','pharmacist']));

create policy purchases_accountant_pharmacy_select on public.purchases for select to authenticated using (public.has_any_role(array['accountant','pharmacist']));
create policy purchases_accountant_pharmacy_write on public.purchases for all to authenticated using (public.has_any_role(array['accountant','pharmacist'])) with check (public.has_any_role(array['accountant','pharmacist']));

create policy purchase_items_accountant_pharmacy_select on public.purchase_items for select to authenticated using (public.has_any_role(array['accountant','pharmacist']));
create policy purchase_items_accountant_pharmacy_write on public.purchase_items for all to authenticated using (public.has_any_role(array['accountant','pharmacist'])) with check (public.has_any_role(array['accountant','pharmacist']));

create policy stock_transactions_pharmacy_accountant_select on public.stock_transactions for select to authenticated using (public.has_any_role(array['pharmacist','accountant']));
create policy stock_transactions_pharmacy_write on public.stock_transactions for insert to authenticated with check (public.has_role('pharmacist'));

-- ----------------------------------------------------------------
-- 14) Laboratory / Radiology
-- ----------------------------------------------------------------
create policy lab_orders_clinical_select on public.lab_orders for select to authenticated using (public.has_any_role(array['doctor','nurse','lab']));
create policy lab_orders_doctor_insert on public.lab_orders for insert to authenticated with check (public.has_role('doctor'));
create policy lab_orders_lab_update on public.lab_orders for update to authenticated using (public.has_any_role(array['lab','doctor'])) with check (public.has_any_role(array['lab','doctor']));
create policy lab_orders_admin_delete on public.lab_orders for delete to authenticated using (public.is_admin());

create policy lab_items_clinical_select on public.lab_order_items for select to authenticated using (public.has_any_role(array['doctor','nurse','lab']));
create policy lab_items_lab_write on public.lab_order_items for all to authenticated using (public.has_role('lab')) with check (public.has_role('lab'));

create policy radiology_orders_clinical_select on public.radiology_orders for select to authenticated using (public.has_any_role(array['doctor','nurse','radiology']));
create policy radiology_orders_doctor_insert on public.radiology_orders for insert to authenticated with check (public.has_role('doctor'));
create policy radiology_orders_radiology_update on public.radiology_orders for update to authenticated using (public.has_any_role(array['radiology','doctor'])) with check (public.has_any_role(array['radiology','doctor']));
create policy radiology_orders_admin_delete on public.radiology_orders for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------
-- 15) Finance
-- ----------------------------------------------------------------
create policy invoices_finance_reception_select on public.invoices for select to authenticated using (public.has_any_role(array['accountant','reception']));
create policy invoices_finance_reception_insert on public.invoices for insert to authenticated with check (public.has_any_role(array['accountant','reception']));
create policy invoices_finance_update on public.invoices for update to authenticated using (public.has_role('accountant')) with check (public.has_role('accountant'));
create policy invoices_admin_delete on public.invoices for delete to authenticated using (public.is_admin());

create policy invoice_items_finance_reception_select on public.invoice_items for select to authenticated using (public.has_any_role(array['accountant','reception']));
create policy invoice_items_finance_reception_write on public.invoice_items for all to authenticated using (public.has_any_role(array['accountant','reception'])) with check (public.has_any_role(array['accountant','reception']));

create policy payments_finance_select on public.payments for select to authenticated using (public.has_any_role(array['accountant','reception']));
create policy payments_finance_insert on public.payments for insert to authenticated with check (public.has_any_role(array['accountant','reception']));
create policy payments_finance_update on public.payments for update to authenticated using (public.has_role('accountant')) with check (public.has_role('accountant'));
create policy payments_admin_delete on public.payments for delete to authenticated using (public.is_admin());

create policy expenses_finance_select on public.expenses for select to authenticated using (public.has_role('accountant'));
create policy expenses_finance_write on public.expenses for all to authenticated using (public.has_role('accountant')) with check (public.has_role('accountant'));

-- ----------------------------------------------------------------
-- 16) Charity / beneficiaries
-- ----------------------------------------------------------------
create policy beneficiaries_staff_select on public.beneficiaries for select to authenticated using (public.has_any_role(array['admin','reception','accountant']));
create policy beneficiaries_staff_write on public.beneficiaries for all to authenticated using (public.has_any_role(array['reception','accountant'])) with check (public.has_any_role(array['reception','accountant']));

create policy charity_cases_staff_select on public.charity_cases for select to authenticated using (public.has_any_role(array['admin','reception','accountant']));
create policy charity_cases_staff_write on public.charity_cases for all to authenticated using (public.has_any_role(array['reception','accountant'])) with check (public.has_any_role(array['reception','accountant']));

create policy charity_services_staff_select on public.charity_services for select to authenticated using (public.has_any_role(array['admin','reception','accountant']));
create policy charity_services_staff_write on public.charity_services for all to authenticated using (public.has_any_role(array['reception','accountant'])) with check (public.has_any_role(array['reception','accountant']));

-- ----------------------------------------------------------------
-- 17) Notifications / audit / settings
-- ----------------------------------------------------------------
create policy notifications_own_select on public.notifications for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy notifications_own_update on public.notifications for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.is_admin());
create policy audit_logs_authenticated_insert on public.audit_logs for insert to authenticated with check (true);

create policy system_settings_authenticated_select on public.system_settings for select to authenticated using (true);
create policy system_settings_admin_write on public.system_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;

-- ================================================================
-- IMPORTANT
-- 1. Create the first administrator manually in Supabase Auth.
-- 2. Then assign role_id in public.profiles to the 'admin' role.
-- 3. Do not expose service_role keys in the Web App.
-- ================================================================
