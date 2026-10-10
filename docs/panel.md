# Guía del panel de administración

El panel está en **https://reservas-up.pages.dev/admin**. Sirve desde el computador o el celular, y solo entra el administrador.

## Entrar

1. Abre `/admin`, escribe tu correo y toca **Enviar enlace**.
2. Abre el correo **en el mismo navegador** y toca el enlace. Quedas dentro.
3. Para salir, toca **Salir**.

Arriba están las secciones: **Pagos y llegadas · Propiedades · Dueños · Cuentas de cobro · Cambios**.

> Si dos personas (o dos dispositivos) editan la misma ficha a la vez, el segundo en guardar verá "Esta ficha cambió en otro dispositivo. Recarga para ver la versión actual". Toca **Recargar** y vuelve a hacer tu cambio. Así nadie pisa el trabajo del otro.

## Crear una propiedad

1. **Propiedades → Nueva propiedad.**
2. Escribe el **nombre**, la **ciudad** y elige el **dueño**. La **dirección (slug)** se arma sola a partir del nombre (por ejemplo `cabana-la-huayca`) y puedes ajustarla.
3. **Crear propiedad.** Se crea en **borrador**: todavía no aparece en el sitio.

Ojo: el slug es parte del enlace que compartes. **Queda fijo desde la primera publicación**, para que los enlaces enviados por WhatsApp o publicados en otros sitios nunca se rompan.

## Completar la ficha

La ficha está dividida en secciones. Cada una tiene su botón **Guardar**.

- **Datos públicos:** tipo, ciudad, comuna, región, capacidad, dormitorios, camas, baños, horarios, noches mínimas, anticipación, descripción y reglas.
  - **Lo que incluye:** elige de la lista (Wifi, Estacionamiento, Parrilla…) o escribe algo propio y toca **Agregar**. Si escribes "wifi" o "Wi-Fi", el sistema lo deja como "Wifi" y sin repetirlo.
- **Fotos:** ver más abajo.
- **Datos privados de llegada:** dirección exacta, cómo entrar, wifi (nombre y clave), estacionamiento y notas. **Nunca aparecen en el sitio.** Solo los recibe el huésped en el correo de llegada, cuando su reserva está pagada.
- **Dueño y tarifa:** la tarifa se elige entre las de **ese** dueño (las tarifas se editan en la próxima sesión).
- **Cobro:**
  - qué cuenta recibe los pagos y qué medios se aceptan;
  - el abono, el plazo para pagar, el saldo antes de la llegada y la cancelación;
  - cada ajuste tiene la casilla **"Usar valor global"**, que aplica el valor general del sitio (se muestra debajo). Desmárcala para fijar uno propio para esta propiedad.
- **Cambios recientes:** quién cambió qué y cuándo. Muestra solo los nombres de los campos, nunca los valores.

## Fotos

1. En **Fotos → Agregar fotos**, elige una o varias. En el celular se abre la cámara o la galería.
2. Antes de subirlas, el sistema las prepara **en tu navegador**:
   - **les quita la ubicación (GPS)** y todos los demás datos ocultos;
   - las endereza si quedaron giradas;
   - las achica (lado mayor de 2400 px) y las comprime (normalmente quedan bajo 400 KB).
3. Escribe una **descripción** para cada foto (por ejemplo, "Living con vista al mar"). Es obligatoria: la leen los lectores de pantalla y Google.
4. Toca **Subir N fotos**.

- **Orden:** arrastra las fotos, o usa **Subir** y **Bajar**. La primera es la que más se ve en la ficha.
- **Portada:** **Usar como portada**. Es la foto de la tarjeta del listado.
- **Eliminar:** borra la foto y su archivo.
- **Fotos del iPhone en formato HEIC:** el sistema avisa "Esta foto está en formato HEIC. Súbela desde el iPhone o conviértela a JPG". En el iPhone, la opción "Más compatible" de la cámara las guarda como JPG. Si subes desde el propio iPhone, Safari las convierte solo.
- **Propiedad publicada:** el sistema no deja quedar con menos de 5 fotos ni sin portada. Para cambiar una foto, primero sube la nueva y después borra la antigua. Para borrar la portada, primero elige otra.

## Publicar

Arriba de la ficha está el recuadro **Publicación**. Muestra, en palabras simples, todo lo que falta. Por ejemplo:
- "Sube al menos 5 fotos (hay 3)."
- "Escribe las instrucciones de llegada (cómo entrar)."
- "Asigna una cuenta de cobro activa (los pagos manuales la necesitan)."

Cuando no falte nada, toca **Publicar** y la propiedad aparece en el sitio. **Ver en el sitio** abre su ficha pública.

**Para publicar se necesita:**
- portada y al menos 5 fotos con descripción;
- descripción;
- horarios de llegada y salida;
- capacidad;
- dirección exacta e instrucciones de llegada;
- una tarifa con precio para las próximas 90 noches;
- una cuenta de cobro activa (si se aceptan transferencia o link), con datos de transferencia si se acepta transferencia;
- la pasarela configurada, si se acepta tarjeta.

**Volver a borrador:** la propiedad deja de verse en el sitio. Si tiene reservas futuras, el panel avisa y pide confirmación. **Las reservas no se cancelan**: siguen su curso.

## Cambiar el dueño de una propiedad

1. Ficha → **Dueño y tarifa → Cambiar dueño.**
2. Elige el **nuevo dueño**, su **tarifa** y escribe el **motivo** (obligatorio).
3. **Cambiar dueño.**

Las reservas ya hechas **mantienen su dueño anterior**, con su desglose de impuestos ya calculado. Las nuevas usan el dueño nuevo. Si quedaron reservas futuras con el dueño anterior, el panel te dice cuántas, para que las revises (liquidación y boletas). El cambio queda en el historial.

## Dueños

**Dueños → Nuevo dueño** (o **Editar**):
- tipo (empresa o persona natural), razón social o nombre;
- **RUT**, que se valida con el dígito verificador;
- email y teléfono;
- **IVA:** afecto, exento o pendiente (consultar al contador);
- rebaja del avalúo fiscal (tasa y modo).

No se puede eliminar un dueño que tenga propiedades, tarifas, cuentas o reservas.

## Cuentas de cobro

**Cuentas de cobro → Nueva cuenta** (o **Editar**):
- **Titular** (puede ser distinto del dueño: por ejemplo, UP cobra por cuenta de otro), nombre para reconocerla y datos de transferencia. Son los que ve el huésped en su página de reserva.
- **Pasarela (TUU):**
  - código de comercio (`x_account_id`) y ambiente (pruebas o producción);
  - **solo el NOMBRE del secreto** donde vive la clave (por ejemplo `TUU_SECRET_UP`).
  - La clave **nunca** se escribe en el panel ni en el chat. Se carga una vez en tu terminal: `npx supabase secrets set --env-file privado/tuu.env`.
- **Activa:** una cuenta inactiva no se ofrece en las propiedades.

En la lista, el número de cuenta aparece enmascarado (`••••1234`), y un indicador dice si la pasarela está lista.

## Seguridad

- **Validación en la base:** todo lo que el panel guarda se valida también en la base de datos. Aunque alguien se saltara el formulario, las reglas se cumplen igual: RUT válido, slug fijo, fotos mínimas, dueño solo con "Cambiar dueño", publicación solo con "Publicar".
- **Sin acceso para el encargado:** no ve nada del panel.
- **Fuera de Google:** el panel no se indexa en buscadores (`noindex`) ni se guarda en cachés intermedias (`no-store`).
