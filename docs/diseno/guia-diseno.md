# Costa y Pampa

Sistema de diseño del sitio de reservas directas Reservas UP: departamentos en Iquique y Santiago y, a futuro, cabañas en La Huayca. La idea visual une la costa (el Pacífico) y la pampa (el desierto de Tarapacá): arena como suelo, azul profundo como mar, terracota como atardecer.

## Principios
1. Cálido y luminoso, nunca rústico. Mucho fondo arena, poco ornamento.
2. Una acción principal por pantalla. El botón terracota es para reservar o buscar disponibilidad.
3. Bordes, no sombras. Separar con líneas finas (line) y bloques de color. Sombra solo donde algo flota (barra de reserva fija).
4. Las fotos mandan. La interfaz es sobria para que las fotos sean protagonistas.

## Voz y contenido
- Español de Chile, cercano y directo, de tú: "Despierta frente al Pacífico", "Escríbenos por WhatsApp".
- Frases cortas. Beneficios concretos y verdaderos. Nunca cifras ni testimonios inventados.
- Precios siempre con IVA incluido y desglosados antes de pagar. Mostrar "Sin cargos por servicio de plataforma".
- La dirección exacta nunca se muestra en público: "La dirección exacta se envía al confirmar tu reserva".
- Etiquetas en mayúsculas con espaciado amplio: estilo label en color earth, ej. "IQUIQUE · CAVANCHA".

## Color
- Fondo sand-100. Campos sand-50. Tarjetas elevadas surface.
- Texto ink; secundario ink-muted; etiquetas earth.
- Acción principal terracotta con texto blanco.
- Bloques de marca pacific con texto sand-100 e íconos dawn.
- dawn solo sobre pacific o ink.
- Bordes de controles border-control (3:1). line es solo decorativa.
- Calendario: días no disponibles en unavailable Y tachados; el color nunca es la única señal.

## Tipografía
- Instrument Serif (display) para títulos: hero display-l en celular y display-xl en escritorio; secciones heading / heading-s. Itálica en terracotta para la palabra destacada ("frente al Pacífico.").
- Manrope (sans) para todo lo demás: body, body-s, title para nombres de propiedades, label para etiquetas, button para botones.
- Ambas desde Google Fonts.

## Espaciado y forma
- Margen lateral en celular space-5; contenedor máximo 1200px en escritorio con 24px de margen.
- Entre secciones space-10; entre tarjetas space-7.
- Botones y chips radius-pill, alto mínimo 44px.
- Inputs radius-m, fotos y tarjetas radius-l, bloques destacados y buscador radius-xl.

## Iconografía
Íconos de trazo (stroke 1.8, puntas redondeadas, 20–26px), nunca emojis. Botones solo con ícono llevan aria-label. Sin logo por ahora: la marca es tipográfica, "Reservas" en Instrument Serif + "UP" en Manrope negrita sobre una pastilla terracotta.

## Accesibilidad
Texto 4.5:1 en todas las combinaciones documentadas; formularios con label real; elementos clicables como button o a; la página funciona a 360px de ancho.
