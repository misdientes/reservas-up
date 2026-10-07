-- Sesión 5: número público de WhatsApp (decisión de René) y mensaje
-- predefinido con que se abre la conversación. Ambos son públicos y se
-- cambian en app_settings sin tocar código. En la Sesión 6 la página de
-- cada propiedad agregará su nombre al mensaje.
update public.app_settings
   set value = '56976978232'
 where key = 'whatsapp_number';

insert into public.app_settings (key, value, is_public)
values ('whatsapp_message', 'Hola, quiero consultar por una estadía en Reservas UP.', true)
on conflict (key) do nothing;
