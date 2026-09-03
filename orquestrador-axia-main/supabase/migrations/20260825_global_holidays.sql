-- Client-confirmed rule: the holiday calendar is global and independent of companies.
alter table if exists public.company_holidays
  alter column company_id drop not null;

alter table if exists public.company_holidays
  drop constraint if exists company_holidays_company_id_holiday_date_key;

create unique index if not exists company_holidays_holiday_date_key
  on public.company_holidays (holiday_date);
