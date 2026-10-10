# Guía del panel de administración

El panel está en **https://reservas-up.pages.dev/admin**. Sirve desde el computador o el celular, y solo entra el administrador.

## Entrar

1. Abre `/admin`, escribe tu correo y toca **Enviar enlace**.
2. Abre el correo **en el mismo navegador** y toca el enlace. Quedas dentro.
3. Para salir, toca **Salir**.

Arriba están las secciones: **Pagos y llegadas · Propiedades · Dueños · Cuentas de cobro · Tarifas · Simulador · Cambios**.

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
- **Dueño y tarifa:** la tarifa se elige entre las de **ese** dueño (los precios se editan en **Tarifas**).
- **Calendario, bloqueos e iCal:** ver más abajo.
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

## Tarifas

**Tarifas → Nueva tarifa** (o **Editar**). Una tarifa puede servir a varias propiedades del mismo dueño (los 2 departamentos de Iquique comparten una).

- **Precio base por noche:** lo que paga el huésped, todo incluido. Escríbelo como `40.000` o `40000`. Mínimo $1.000.
- **Precio por día de la semana:** opcional. Vacío = precio base. Cuenta la noche en que se duerme: **viernes = noche del viernes al sábado**. Viernes y sábado pueden tener precios distintos.
- **Aseo** (una vez por estadía), **huéspedes incluidos** y **huésped adicional** (por noche).
- **Noches mínimas:** vacío = 1. Una temporada con mínimo propio lo reemplaza; el mínimo de la propiedad siempre se respeta.

> **Cambiar una tarifa nunca cambia las reservas ya hechas**: las pagadas y las que están en proceso de pago mantienen el precio con que se crearon.

### Descuentos por estadía larga

En la ficha de la tarifa: **Desde (noches)** y **Descuento (%)** → **Agregar tramo**. Por ejemplo, desde 7 noches −10 % y desde 28 noches −20 %. Se aplica **un solo tramo, el mayor que alcance la estadía**, sobre las noches y los huéspedes adicionales (no sobre el aseo). El huésped lo ve como "Descuento por estadía larga (10 %)".

### Temporadas

**Nueva temporada:** nombre (lo ve el huésped), primera noche, **salida** (el día después de la última noche), precio, precios por día (opcional), noches mínimas al llegar en esa temporada y **prioridad**:

- **Normal, Alta o Máxima.** Si dos temporadas se cruzan, manda la de mayor prioridad. Ejemplo: "Verano" (Normal) de enero a febrero y "Año Nuevo" (Máxima) del 30 de diciembre al 2 de enero → esas noches cobran Año Nuevo.
- Dos temporadas con la **misma** prioridad no pueden cruzarse: el panel lo avisa.
- Las fechas deben terminar dentro de los próximos 2 años.

**Sugerir feriados de Chile:** muestra los fines de semana largos del año y del siguiente, calculados según la ley (Semana Santa, Fiestas Patrias, Navidad, Año Nuevo, traslados al lunes…). Marca los que quieras, escribe el precio y **Crear**: quedan con prioridad Alta. Revísalos: no incluye elecciones ni feriados regionales.

## Calendario, bloqueos e iCal (en la ficha de la propiedad)

- **Calendario:** precio de cada noche, temporada, mínimo de noches y estado (Libre, Reservada, Pago en curso, Bloqueada, Airbnb/Booking), mes a mes por 12 meses. En el celular se ve como lista por semanas.
- **Bloquear fechas:** primera noche, salida, motivo (mantención, uso del dueño, otro) y nota → **Bloquear**. No se puede bloquear sobre una reserva ni un pago en curso: el panel dice con qué choca y en qué fechas. **Quitar bloqueo** libera las noches. Los bloqueos también se informan a Airbnb y Booking.
- **Calendarios de Airbnb y Booking:**
  1. **Agregar calendario:** canal y la dirección iCal que copias desde Airbnb o Booking ("Exportar calendario"). Es privada: después solo se ve enmascarada (`https://www.airbnb.cl/••••9876`). Para cambiarla, **Editar** y pegar la nueva (vacío = no cambiar).
  2. **Copiar URL de exportación** y pégala en el canal ("Importar calendario"). Cada canal tiene la suya.
  3. **Estado:** "Sincronizado · hace 4 min", "Error en la última sincronización" (con el motivo) o "Atrasado" (más de 1 hora; también llega un correo).
  4. **Sincronizar ahora:** importa en el momento (se puede repetir cada 60 segundos). Igual se sincroniza solo cada 10 minutos.
  5. **Choques detectados:** si un canal trae noches que ya estaban ocupadas, aparecen aquí con qué hacer. Lo grave es "Choca con una reserva pagada": la reserva queda en conflicto y hay que resolverla con el huésped.
  6. **Desactivar** deja de importar ese calendario sin borrarlo.

## Simulador

**Simulador:** elige propiedad, fechas y huéspedes → **Cotizar**. A la izquierda, **lo mismo que verá el huésped** (también para propiedades en borrador, para probar precios antes de publicar). A la derecha, solo para ti: abono, saldo, neto e IVA.

## Seguridad

- **Validación en la base:** todo lo que el panel guarda se valida también en la base de datos. Aunque alguien se saltara el formulario, las reglas se cumplen igual: RUT válido, slug fijo, fotos mínimas, dueño solo con "Cambiar dueño", publicación solo con "Publicar", límites de precios, prioridad de temporadas, bloqueos que nunca pisan una reserva.
- **Sin acceso para el encargado:** no ve nada del panel.
- **Fuera de Google:** el panel no se indexa en buscadores (`noindex`) ni se guarda en cachés intermedias (`no-store`).
