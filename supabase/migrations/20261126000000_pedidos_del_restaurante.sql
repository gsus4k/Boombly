-- pedidos_del_restaurante ahora también devuelve la captura del pago (ruta en el bucket "comprobantes")
-- y la referencia del pago móvil. Como cambia el tipo de retorno hay que borrarla y crearla de nuevo.
-- Seguridad: SECURITY DEFINER + solo el gestor de ESE restaurante (restaurante_gestor) o un admin.

drop function if exists public.pedidos_del_restaurante(uuid);

create function public.pedidos_del_restaurante(p_id_restaurante uuid)
returns table (
  id_pedido        uuid,
  codigo           text,
  estado           text,
  creado_en        timestamptz,
  cliente          text,
  telefono_cliente text,
  unidades         integer,
  subtotal         numeric,
  costo_envio      numeric,
  total            numeric,
  comprobante_url  text,
  referencia_pago  text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (
    es_admin() or exists (
      select 1 from restaurante_gestor g
      where g.id_restaurante = p_id_restaurante and g.auth_user_id = auth.uid()
    )
  ) then
    raise exception 'No tienes acceso a los pedidos de este restaurante' using errcode = '42501';
  end if;

  return query
  select p.id_pedido,
         p.codigo,
         p.estado::text,
         p.creado_en,
         c.nombre,
         c.telefono,
         coalesce(d.unidades, 0)::integer,
         coalesce(d.subtotal, 0)::numeric,
         p.costo_envio::numeric,
         (p.costo_envio + coalesce(d.subtotal, 0))::numeric,
         pg.comprobante_url,
         pg.referencia
  from pedido p
  join cliente c on c.id_cliente = p.id_cliente
  left join lateral (
    select sum(dp.cantidad) as unidades, sum(dp.subtotal) as subtotal
    from detalle_pedido dp where dp.id_pedido = p.id_pedido
  ) d on true
  left join lateral (                      -- el pago más reciente del pedido (puede haber reintentos)
    select x.comprobante_url, x.referencia
    from pago x where x.id_pedido = p.id_pedido
    order by x.creado_en desc limit 1
  ) pg on true
  where p.id_restaurante = p_id_restaurante
  order by p.creado_en desc
  limit 100;
end $$;

revoke all on function public.pedidos_del_restaurante(uuid) from public, anon;
grant execute on function public.pedidos_del_restaurante(uuid) to authenticated;
