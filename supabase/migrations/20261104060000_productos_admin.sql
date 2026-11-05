drop function if exists guardar_producto_restaurante(uuid, uuid, text, text, numeric, boolean, text);
drop function if exists eliminar_producto_restaurante(uuid, uuid);

create function guardar_producto_restaurante(
  p_id_restaurante uuid,
  p_id_producto uuid,
  p_nombre text,
  p_descripcion text,
  p_precio numeric,
  p_disponible boolean,
  p_imagen_url text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then
    raise exception 'Solo los administradores pueden modificar productos';
  end if;

  p_nombre := btrim(regexp_replace(p_nombre, '\s+', ' ', 'g'));
  if char_length(p_nombre) < 2 then
    raise exception 'El nombre debe tener al menos 2 caracteres';
  end if;
  if p_descripcion is null or btrim(p_descripcion) = '' then
    raise exception 'La descripción es obligatoria';
  end if;
  if p_precio is null or p_precio < 0 then
    raise exception 'El precio debe ser mayor o igual a 0';
  end if;

  insert into producto (id_producto, nombre, descripcion, imagen_url)
  values (p_id_producto, p_nombre, btrim(p_descripcion), p_imagen_url)
  on conflict (id_producto) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        imagen_url = coalesce(p_imagen_url, producto.imagen_url);

  insert into detalle_producto (id_restaurante, id_producto, precio, disponible)
  values (p_id_restaurante, p_id_producto, p_precio, coalesce(p_disponible, true))
  on conflict (id_restaurante, id_producto) do update
    set precio = excluded.precio,
        disponible = excluded.disponible;
end $$;

create function eliminar_producto_restaurante(
  p_id_restaurante uuid,
  p_id_producto uuid
) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then
    raise exception 'Solo los administradores pueden eliminar productos';
  end if;

  if exists (
    select 1 from detalle_pedido
    where id_restaurante = p_id_restaurante and id_producto = p_id_producto
  ) then
    update detalle_producto
      set disponible = false
      where id_restaurante = p_id_restaurante and id_producto = p_id_producto;
    return 'archivado';
  end if;

  delete from detalle_producto
  where id_restaurante = p_id_restaurante and id_producto = p_id_producto;

  if not exists (
    select 1 from detalle_producto where id_producto = p_id_producto
  ) then
    delete from producto where id_producto = p_id_producto;
  end if;

  return 'eliminado';
end $$;

revoke all on function guardar_producto_restaurante(uuid, uuid, text, text, numeric, boolean, text) from public, anon;
revoke all on function eliminar_producto_restaurante(uuid, uuid) from public, anon;
grant execute on function guardar_producto_restaurante(uuid, uuid, text, text, numeric, boolean, text) to authenticated;
grant execute on function eliminar_producto_restaurante(uuid, uuid) to authenticated;
