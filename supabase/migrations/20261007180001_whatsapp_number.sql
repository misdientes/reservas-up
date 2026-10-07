-- Sesión 5: número de WhatsApp público del sitio (encabezado/pie y estado
-- vacío del inicio), editable sin tocar código.
-- Queda vacío hasta que René entregue el número público: no se inventa.
-- El frontend oculta el enlace de WhatsApp mientras el valor esté vacío.
-- Formato esperado: solo dígitos con código de país, sin "+" ni espacios
-- (por ejemplo 569XXXXXXXX), como lo pide https://wa.me/<número>.
insert into public.app_settings (key, value, is_public)
values ('whatsapp_number', '', true)
on conflict (key) do nothing;
