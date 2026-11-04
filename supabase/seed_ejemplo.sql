-- BOOMBLY · Datos de ejemplo para probar (ejecutar DESPUÉS de boombly_schema.sql y de crear tu usuario admin)
-- Cambia los teléfonos 58412000000X por los reales y las coordenadas por las de cada local.
do $$
declare
  v_admin uuid := (select id_admin from admin limit 1);
  v_rest1 uuid := gen_random_uuid();
  v_rest2 uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid(); v_p3 uuid := gen_random_uuid(); v_p4 uuid := gen_random_uuid();
begin
  if v_admin is null then
    raise exception 'Primero crea tu usuario admin (Authentication → Users) y agrégalo a la tabla admin.';
  end if;

  insert into repartidor (nombre, telefono) values
    ('Repartidor 1', '584120000001'), ('Repartidor 2', '584120000002'),
    ('Repartidor 3', '584120000003'), ('Repartidor 4', '584120000004');

  insert into restaurante (id_restaurante, id_admin, id_categoria, nombre, direccion, telefono, lat, lng, etiqueta, pm_banco, pm_telefono, pm_cedula_rif) values
    (v_rest1, v_admin, (select id_categoria from categoria where nombre = 'Burgers'), 'Boom Burger (ejemplo)', 'Barquisimeto, Lara', '584120000010', 10.0678, -69.3467, 'POPULAR', 'Banesco', '04120000010', 'V-12345678'),
    (v_rest2, v_admin, (select id_categoria from categoria where nombre = 'Pizza'),   'Fuego Pizza (ejemplo)', 'Cabudare, Lara',     '584120000011', 10.0333, -69.2667, 'NUEVO',   'Mercantil', '04120000011', 'J-12345678-9');

  insert into producto (id_producto, nombre, descripcion) values
    (v_p1, 'Doble Smash', 'Doble carne smash con queso cheddar'),
    (v_p2, 'Papas fritas', 'Porción grande con salsa de la casa'),
    (v_p3, 'Pizza Margherita', 'Tomate, mozzarella y albahaca'),
    (v_p4, 'Refresco 355 ml', 'Frío, varios sabores');

  insert into detalle_producto (id_restaurante, id_producto, precio) values
    (v_rest1, v_p1, 5.50), (v_rest1, v_p2, 2.50), (v_rest1, v_p4, 1.50),
    (v_rest2, v_p3, 7.00), (v_rest2, v_p4, 1.75);
end $$;
