-- تفعيل بث Supabase Realtime للجداول التي يراقبها التطبيق.
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor.
-- الكتلة آمنة لإعادة التشغيل: تتجاوز أي جدول موجود بالفعل في publication.

DO $$
DECLARE
  table_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Publication supabase_realtime غير موجودة في هذا المشروع';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'doctors', 'employees', 'visits_clinic', 'visits_dental',
    'visits_operations', 'visits_labs', 'visits_radiology',
    'income', 'expense', 'payroll', 'staff_accounts',
    'audit_log', 'lab_expenses', 'settings'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
      table_name
    );
  END LOOP;
END
$$;
