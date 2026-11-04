-- =====================================================================
-- BOOMBLY · Esquema de base de datos para Supabase (PostgreSQL 15+)
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- =====================================================================

-- ---------- 1. TIPOS ENUMERADOS ----------
create type estado_pedido     as enum ('recibido', 'preparado', 'enviado', 'entregado', 'cancelado');
create type estado_pago       as enum ('pendiente', 'verificado', 'rechazado');
create type destinatario_tipo as enum ('cliente', 'restaurante', 'repartidor');
create type estado_envio      as enum ('pendiente', 'enviado', 'fallido');

-- Código legible tipo CL-A1B2C3 / BB-A1B2C3
create function gen_codigo(prefijo text) returns text
language sql volatile as $$
  select prefijo || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))
$$;

-- ---------- 2. TABLAS ----------
create table categoria (
  id_categoria smallint generated always as identity primary key,
  nombre       text not null unique,
  emoji        text
);

-- Administradores: la clave NO se guarda aquí; la maneja Supabase Auth (auth.users).
create table admin (
  id_admin  uuid primary key references auth.users (id) on delete cascade,
  nombre    text not null,
  creado_en timestamptz not null default now()
);

create table cliente (
  id_cliente   uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  codigo       text not null unique default gen_codigo('CL') check (codigo ~ '^CL-[A-Z0-9]{6}$'),
  nombre       text not null check (char_length(trim(nombre)) >= 2),
  telefono     text not null unique check (telefono ~ '^[0-9]{10,15}$'), -- internacional sin "+": 584121234567
  direccion    text,
  creado_en    timestamptz not null default now()
);

create table repartidor (
  id_repartidor uuid primary key default gen_random_uuid(),
  nombre        text not null,
  telefono      text not null unique check (telefono ~ '^[0-9]{10,15}$'),
  disponible    boolean not null default true,
  creado_en     timestamptz not null default now()
);

create table restaurante (
  id_restaurante    uuid primary key default gen_random_uuid(),
  id_admin          uuid not null references admin (id_admin) on delete restrict,
  id_categoria      smallint not null references categoria (id_categoria),
  nombre            text not null check (char_length(trim(nombre)) >= 2),
  direccion         text,
  telefono          text not null check (telefono ~ '^[0-9]{10,15}$'),   -- WhatsApp que recibe los pedidos
  lat               numeric(9,6) not null check (lat between -90 and 90),    -- origen para calcular el envío
  lng               numeric(9,6) not null check (lng between -180 and 180),
  tiempo_estimado   text not null default '20–30 min',
  etiqueta          text,
  imagen_url        text,
  calificacion_base numeric(2,1) not null default 4.5 check (calificacion_base between 0 and 5),
  pm_banco          text,                                                    -- pago móvil del restaurante
  pm_telefono       text,
  pm_cedula_rif     text,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  check ((pm_banco is null) = (pm_telefono is null) and (pm_telefono is null) = (pm_cedula_rif is null))
);

-- Catálogo general de productos (sin precio: el precio depende del restaurante)
create table producto (
  id_producto uuid primary key default gen_random_uuid(),
  nombre      text not null check (char_length(trim(nombre)) >= 2),
  descripcion text,
  imagen_url  text
);

-- Oferta de un producto en un restaurante (resuelve la relación N:M producto–restaurante)
create table detalle_producto (
  id_restaurante uuid not null references restaurante (id_restaurante) on delete cascade,
  id_producto    uuid not null references producto (id_producto) on delete restrict,
  precio         numeric(10,2) not null check (precio >= 0),
  disponible     boolean not null default true,
  primary key (id_restaurante, id_producto)
);

create table pedido (
  id_pedido      uuid primary key default gen_random_uuid(),
  codigo         text not null unique default gen_codigo('BB') check (codigo ~ '^BB-[A-Z0-9]{6}$'),
  id_cliente     uuid not null references cliente (id_cliente) on delete restrict,
  id_restaurante uuid not null references restaurante (id_restaurante) on delete restrict,
  id_repartidor  uuid references repartidor (id_repartidor) on delete set null,  -- se asigna después de crear el pedido
  estado         estado_pedido not null default 'recibido',
  creado_en      timestamptz not null default now(),
  lat_entrega    numeric(9,6) not null check (lat_entrega between -90 and 90),
  lng_entrega    numeric(9,6) not null check (lng_entrega between -180 and 180),
  precision_m    numeric(8,1),
  distancia_km   numeric(7,2) not null check (distancia_km >= 0),   -- distancia por ruta usada para cobrar
  costo_envio    numeric(10,2) not null check (costo_envio >= 0),
  calificacion   smallint check (calificacion between 1 and 5),
  resena         text,
  unique (id_pedido, id_restaurante),                                 -- necesario para la FK compuesta de detalle_pedido
  check (calificacion is null or estado = 'entregado')
);

-- subtotal y total NO se guardan: se calculan (vista v_pedido) para evitar datos duplicados que se desincronicen.
create table detalle_pedido (
  id_pedido       uuid not null,
  id_restaurante  uuid not null,
  id_producto     uuid not null,
  cantidad        integer not null check (cantidad > 0),
  precio_unitario numeric(10,2) not null check (precio_unitario >= 0),  -- precio congelado al momento de comprar
  subtotal        numeric(10,2) generated always as (cantidad * precio_unitario) stored,
  primary key (id_pedido, id_producto),
  -- Las dos FK comparten id_restaurante: el producto DEBE pertenecer al mismo restaurante del pedido (rompe el ciclo).
  foreign key (id_pedido, id_restaurante)    references pedido (id_pedido, id_restaurante) on delete cascade,
  foreign key (id_restaurante, id_producto)  references detalle_producto (id_restaurante, id_producto) on delete restrict
);

create table pago (
  id_pago         uuid primary key default gen_random_uuid(),
  id_pedido       uuid not null references pedido (id_pedido) on delete cascade,
  monto           numeric(10,2) not null check (monto > 0),
  metodo          text not null default 'pago_movil' check (metodo in ('pago_movil')),
  estado          estado_pago not null default 'pendiente',
  referencia      text not null check (referencia ~ '^[0-9]{4,20}$'),
  comprobante_url text,                       -- ruta en Supabase Storage (bucket privado "comprobantes")
  creado_en       timestamptz not null default now(),
  verificado_en   timestamptz
);
create unique index pago_un_verificado_por_pedido on pago (id_pedido) where estado = 'verificado';

create table notificacion (
  id_notificacion       uuid primary key default gen_random_uuid(),
  id_pedido             uuid not null references pedido (id_pedido) on delete cascade,
  destinatario_tipo     destinatario_tipo not null,
  destinatario_telefono text not null check (destinatario_telefono ~ '^[0-9]{10,15}$'),
  canal                 text not null default 'whatsapp' check (canal in ('whatsapp')),
  mensaje               text not null,
  estado                estado_envio not null default 'pendiente',
  wa_message_id         text,
  error                 text,
  creado_en             timestamptz not null default now()
);

-- Tarifas de envío editables sin redeploy (una sola fila)
create table config_envio (
  id            boolean primary key default true check (id),
  tarifa_minima numeric(6,2) not null default 2.00,
  km_incluidos  numeric(5,2) not null default 3,
  precio_km     numeric(6,2) not null default 0.40,
  radio_max_km  numeric(6,2) not null default 100
);

-- ---------- 3. ÍNDICES (llaves foráneas y consultas frecuentes) ----------
create index on restaurante (id_categoria) where activo;
create index on restaurante (id_admin);
create index on detalle_producto (id_producto);
create index on pedido (id_cliente, creado_en desc);
create index on pedido (id_restaurante, estado);
create index on pedido (id_repartidor) where id_repartidor is not null;
create index on pago (id_pedido);
create index on pago (referencia);
create index on notificacion (id_pedido);

-- ---------- 4. VISTAS ----------
create view v_pedido with (security_invoker = true) as
select p.*,
       coalesce(sum(d.subtotal), 0)                  as subtotal,
       p.costo_envio + coalesce(sum(d.subtotal), 0)  as total
from pedido p
left join detalle_pedido d on d.id_pedido = p.id_pedido
group by p.id_pedido;

-- Calificación mostrada = base del restaurante ponderada con reseñas reales (igual que la app)
create view v_restaurante_calificacion with (security_invoker = true) as
select r.id_restaurante,
       round((r.calificacion_base * 10 + coalesce(sum(p.calificacion), 0)) / (10 + count(p.calificacion)), 1) as calificacion,
       count(p.calificacion) as resenas
from restaurante r
left join pedido p on p.id_restaurante = r.id_restaurante and p.calificacion is not null
group by r.id_restaurante;

-- ---------- 5. FUNCIONES ----------
create function haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select (2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))))::numeric
$$;

create function pedido_total(p_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select p.costo_envio + coalesce((select sum(d.subtotal) from detalle_pedido d where d.id_pedido = p.id_pedido), 0)
  from pedido p where p.id_pedido = p_id
$$;

-- El monto pagado debe ser exactamente el total del pedido
create function validar_monto_pago() returns trigger
language plpgsql as $$
begin
  if new.monto is distinct from pedido_total(new.id_pedido) then
    raise exception 'El monto del pago (%) no coincide con el total del pedido (%)', new.monto, pedido_total(new.id_pedido);
  end if;
  return new;
end $$;
create trigger trg_pago_monto before insert on pago for each row execute function validar_monto_pago();

create function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin where id_admin = auth.uid())
$$;

-- Crea el pedido completo en UNA transacción. Recalcula precios y envío en el servidor (el navegador no decide montos).
-- Solo la puede llamar tu Edge Function (service_role), que es quien calcula la distancia de ruta con OSRM.
create function crear_pedido(
  p_id_cliente uuid, p_id_restaurante uuid, p_lat numeric, p_lng numeric, p_precision_m numeric,
  p_distancia_km numeric, p_items jsonb, p_referencia text, p_comprobante_url text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r restaurante%rowtype; cfg config_envio%rowtype;
  recta numeric; v_fee numeric; v_sub numeric; v_id uuid; v_n int; v_esperados int;
begin
  select * into r from restaurante where id_restaurante = p_id_restaurante and activo;
  if not found then raise exception 'Restaurante no disponible'; end if;
  if not exists (select 1 from cliente where id_cliente = p_id_cliente) then raise exception 'Cliente no existe'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Pedido sin productos'; end if;

  select * into cfg from config_envio;
  recta := haversine_km(r.lat, r.lng, p_lat, p_lng);
  if recta > cfg.radio_max_km then raise exception 'Fuera de cobertura (% km)', round(recta, 1); end if;
  if p_distancia_km < recta * 0.98 or p_distancia_km > recta * 4 + 1 then raise exception 'Distancia de ruta inválida'; end if;

  v_fee := round(greatest(cfg.tarifa_minima, cfg.tarifa_minima + greatest(0, p_distancia_km - cfg.km_incluidos) * cfg.precio_km), 2);

  insert into pedido (id_cliente, id_restaurante, lat_entrega, lng_entrega, precision_m, distancia_km, costo_envio)
  values (p_id_cliente, p_id_restaurante, p_lat, p_lng, p_precision_m, round(p_distancia_km, 2), v_fee)
  returning id_pedido into v_id;

  insert into detalle_pedido (id_pedido, id_restaurante, id_producto, cantidad, precio_unitario)
  select v_id, p_id_restaurante, dp.id_producto, sum(i.cantidad), dp.precio
  from jsonb_to_recordset(p_items) as i(id_producto uuid, cantidad int)
  join detalle_producto dp on dp.id_restaurante = p_id_restaurante and dp.id_producto = i.id_producto and dp.disponible
  where i.cantidad > 0
  group by dp.id_producto, dp.precio;
  get diagnostics v_n = row_count;

  select count(distinct x ->> 'id_producto') into v_esperados from jsonb_array_elements(p_items) x;
  if v_n <> v_esperados then raise exception 'Hay productos no disponibles o con cantidad inválida'; end if;

  select sum(subtotal) into v_sub from detalle_pedido where id_pedido = v_id;
  insert into pago (id_pedido, monto, referencia, comprobante_url)
  values (v_id, v_sub + v_fee, p_referencia, p_comprobante_url);

  return v_id;
end $$;

-- Asigna el repartidor disponible que lleva más tiempo sin recibir un pedido (reparto equitativo entre los 4)
create function asignar_repartidor(p_id_pedido uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_rep uuid;
begin
  select r.id_repartidor into v_rep
  from repartidor r
  where r.disponible
  order by (select max(p.creado_en) from pedido p where p.id_repartidor = r.id_repartidor) nulls first, r.creado_en
  limit 1;
  update pedido set id_repartidor = v_rep where id_pedido = p_id_pedido and id_repartidor is null;
  return v_rep;
end $$;

-- El cliente califica su propio pedido entregado (no puede tocar nada más del pedido)
create function calificar_pedido(p_id_pedido uuid, p_calificacion int, p_resena text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update pedido p set calificacion = p_calificacion, resena = nullif(trim(p_resena), '')
  where p.id_pedido = p_id_pedido and p.estado = 'entregado'
    and exists (select 1 from cliente c where c.id_cliente = p.id_cliente and c.auth_user_id = auth.uid());
  if not found then raise exception 'No puedes calificar este pedido'; end if;
end $$;

revoke all on function crear_pedido(uuid, uuid, numeric, numeric, numeric, numeric, jsonb, text, text) from public, anon, authenticated;
revoke all on function asignar_repartidor(uuid) from public, anon, authenticated;
grant execute on function crear_pedido(uuid, uuid, numeric, numeric, numeric, numeric, jsonb, text, text) to service_role;
grant execute on function asignar_repartidor(uuid) to service_role;
grant execute on function calificar_pedido(uuid, int, text) to authenticated;

-- ---------- 6. SEGURIDAD (Row Level Security) ----------
alter table categoria        enable row level security;
alter table admin            enable row level security;
alter table cliente          enable row level security;
alter table repartidor       enable row level security;
alter table restaurante      enable row level security;
alter table producto         enable row level security;
alter table detalle_producto enable row level security;
alter table pedido           enable row level security;
alter table detalle_pedido   enable row level security;
alter table pago             enable row level security;
alter table notificacion     enable row level security;
alter table config_envio     enable row level security;

-- Catálogo público (lectura) y edición solo admin
create policy categoria_lee on categoria for select to anon, authenticated using (true);
create policy categoria_adm on categoria for all to authenticated using (es_admin()) with check (es_admin());
create policy restaurante_lee on restaurante for select to anon, authenticated using (activo or es_admin());
create policy restaurante_adm on restaurante for all to authenticated using (es_admin()) with check (es_admin());
create policy producto_lee on producto for select to anon, authenticated using (true);
create policy producto_adm on producto for all to authenticated using (es_admin()) with check (es_admin());
create policy detprod_lee on detalle_producto for select to anon, authenticated using (true);
create policy detprod_adm on detalle_producto for all to authenticated using (es_admin()) with check (es_admin());
create policy config_lee on config_envio for select to anon, authenticated using (true);
create policy config_adm on config_envio for all to authenticated using (es_admin()) with check (es_admin());

-- Datos privados
create policy admin_yo on admin for select to authenticated using (id_admin = auth.uid());
create policy cliente_propio_lee on cliente for select to authenticated using (auth_user_id = auth.uid() or es_admin());
create policy cliente_propio_ins on cliente for insert to authenticated with check (auth_user_id = auth.uid());
create policy cliente_propio_upd on cliente for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy cliente_adm on cliente for all to authenticated using (es_admin()) with check (es_admin());
create policy repartidor_adm on repartidor for all to authenticated using (es_admin()) with check (es_admin());
create policy notificacion_adm on notificacion for all to authenticated using (es_admin()) with check (es_admin());

create policy pedido_lee on pedido for select to authenticated using (
  es_admin() or exists (select 1 from cliente c where c.id_cliente = pedido.id_cliente and c.auth_user_id = auth.uid()));
create policy pedido_adm on pedido for all to authenticated using (es_admin()) with check (es_admin());

create policy detped_lee on detalle_pedido for select to authenticated using (
  es_admin() or exists (select 1 from pedido p join cliente c on c.id_cliente = p.id_cliente
                        where p.id_pedido = detalle_pedido.id_pedido and c.auth_user_id = auth.uid()));
create policy detped_adm on detalle_pedido for all to authenticated using (es_admin()) with check (es_admin());

create policy pago_lee on pago for select to authenticated using (
  es_admin() or exists (select 1 from pedido p join cliente c on c.id_cliente = p.id_cliente
                        where p.id_pedido = pago.id_pedido and c.auth_user_id = auth.uid()));
create policy pago_reintento on pago for insert to authenticated with check (
  estado = 'pendiente' and exists (select 1 from pedido p join cliente c on c.id_cliente = p.id_cliente
                                   where p.id_pedido = pago.id_pedido and c.auth_user_id = auth.uid()));
create policy pago_adm on pago for all to authenticated using (es_admin()) with check (es_admin());

-- ---------- 7. DATOS INICIALES ----------
insert into config_envio default values;
insert into categoria (nombre, emoji) values
  ('Burgers','🍔'), ('Pizza','🍕'), ('Sushi','🍣'), ('Tacos','🌮'), ('Ramen','🍜'), ('Dulces','🍩'), ('Bebidas','🧃');
