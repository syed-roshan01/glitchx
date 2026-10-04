-- =============================================================
-- 00012 — Seed data (idempotent)
-- Resources: 2× PS5 + 1 Pool Table. Pricing: PS5 ₹100/hr,
-- Pool ₹300/hr. Starter items, services and default settings.
-- =============================================================

-- Pricing plans
insert into public.pricing_plans (resource_type, name, billing_type, price, duration_minutes)
select * from (values
  ('PLAYSTATION', 'PS5 Hourly', 'HOURLY', 100.00, null::integer),
  ('PLAYSTATION', 'PS5 — 2 Hour Package', 'PACKAGE', 180.00, 120),
  ('POOL', 'Pool Hourly', 'HOURLY', 300.00, null::integer),
  ('POOL', 'Pool — 30 Minutes', 'PACKAGE', 150.00, 30)
) as seed(resource_type, name, billing_type, price, duration_minutes)
where not exists (
  select 1 from public.pricing_plans p
  where p.resource_type = seed.resource_type and p.name = seed.name
);

-- Resources
insert into public.resources (name, type, description)
select * from (values
  ('PS5 01', 'PLAYSTATION', 'PlayStation 5 station — 4K TV, dual controllers'),
  ('PS5 02', 'PLAYSTATION', 'PlayStation 5 station — 4K TV, dual controllers'),
  ('Pool Table', 'POOL', 'Full-size pool table with cues and balls')
) as seed(name, type, description)
where not exists (select 1 from public.resources r where r.name = seed.name);

-- Link each resource to its default plan (cheapest hourly of its type)
update public.resources r
set default_pricing_plan_id = p.id
from public.pricing_plans p
where p.resource_type = r.type
  and p.billing_type = 'HOURLY'
  and p.active
  and r.default_pricing_plan_id is null
  and p.price = (
    select min(p2.price) from public.pricing_plans p2
    where p2.resource_type = r.type and p2.billing_type = 'HOURLY' and p2.active
  );

-- Items (food & drinks)
insert into public.items (name, category, price)
select * from (values
  ('Coke', 'DRINK', 40.00),
  ('Pepsi', 'DRINK', 40.00),
  ('Water Bottle', 'DRINK', 20.00),
  ('Energy Drink', 'DRINK', 100.00),
  ('Chips', 'SNACK', 30.00),
  ('Popcorn', 'SNACK', 40.00)
) as seed(name, category, price)
where not exists (select 1 from public.items i where i.name = seed.name);

-- Services (additional games / add-ons)
insert into public.services (name, description, price)
select * from (values
  ('Extra Controller', 'Additional controller for the session', 50.00),
  ('Premium Game', 'New-release premium game unlock', 50.00),
  ('FIFA Tournament Entry', 'FIFA tournament participation', 100.00),
  ('Racing Game', 'Racing game with wheel setup', 100.00),
  ('VR Game', 'VR headset game session', 150.00)
) as seed(name, description, price)
where not exists (select 1 from public.services s where s.name = seed.name);
